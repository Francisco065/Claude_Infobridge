# Infobridge — Telemetria SaaS
## Definição de Stack + Pseudocódigo do Motor de Raciocínio (v1)

---

## 1. Recomendação de Stack (SaaS multi-tenant, larga escala)

Considerando que a Infobridge vai (a) integrar continuamente com APIs externas de telemetria (Multiportal), (b) processar séries temporais pesadas (posição, RPM, acelerador a cada poucos segundos por veículo), (c) atender múltiplos clientes com login individual e isolamento de dados, e (d) crescer em volume de veículos/empresas, a recomendação é:

### Backend
- **Linguagem principal da API/SaaS:** Node.js com **NestJS** (TypeScript)
  - Ótimo para multi-tenancy, autenticação (JWT/OAuth), módulos bem organizados, fácil de escalar horizontalmente.
  - Ecossistema maduro para SaaS B2B (RBAC, guards, interceptors por tenant).
- **Worker de Ingestão e Motor de Cálculo:** Python (com **FastAPI** para expor o serviço internamente)
  - Pandas/Numpy são ideais para processar séries temporais (RPM, % acelerador, velocidade) e calcular médias, faixas, frenagens.
  - Python lida muito bem com regras de classificação (faixas de RPM, acelerador) e geração de texto (notas ao condutor), inclusive futura integração com LLM para gerar a "nota" em linguagem natural.

> Resumindo: **NestJS = camada SaaS (auth, multi-tenant, API pública, billing)**; **Python = motor de ingestão + motor de raciocínio/cálculo**, comunicando-se via fila de mensagens (assíncrono) ou API interna.

### Banco de Dados
- **PostgreSQL** como banco principal (dados de tenants, usuários, veículos, motoristas, pontuações, notas geradas).
- Extensão **TimescaleDB** (sobre o Postgres) para a tabela de leituras de telemetria (posição/RPM/acelerador/velocidade) — feita para séries temporais em larga escala, com agregações eficientes (médias por hora/dia/mês).
- Estratégia de multi-tenancy: **schema único + coluna `tenant_id`** com Row Level Security (RLS) do Postgres. É o padrão que escala melhor para "muitos clientes pequenos/médios" (schema-per-tenant não escala bem além de algumas centenas de tenants).

### Fila / Cache
- **Redis** para:
  - Cache do token da Multiportal (respeitando expiração e o cache de 3 min do "última posição").
  - Fila de jobs (via BullMQ no Node ou Celery/RQ no Python) para os workers de ingestão e cálculo.

### Frontend
- **React + Next.js** — dashboard multi-tenant, SSR para performance, fácil de hospedar.

### Infra
- Containers (Docker) desde o início; Docker Compose para o MVP, com caminho natural para Kubernetes quando o volume de clientes/veículos crescer.

---

## 2. Modelo de Dados (resumo das entidades centrais)

```
Tenant (empresa cliente da Infobridge)
  └── Usuario (login individual, vinculado a um Tenant)
  └── CredencialIntegracao (login/senha/appid da Multiportal por Tenant)
  └── Veiculo (id_multiportal, placa, modelo, tenant_id)
  └── Motorista (id_multiportal, nome, tenant_id)
  └── VinculoMotoristaVeiculo (motorista_id, veiculo_id, inicio, fim)
  └── LeituraTelemetria (timeseries: veiculo_id, timestamp, odometro, velocidade,
        rpm, perc_acelerador, ignicao, lat, lng)
  └── AcumuladoDiario (veiculo_id, data, km_dia, consumo_dia, tempo_ignicao)
  └── IndicadorPeriodo (resultado processado: km_total, media_kml, velocidade_media,
        frenagens_totais, frenagens_alta_vel, frenagens_por_100km,
        perc_acelerador_ideal/atencao/critico,
        perc_rpm_faixa_verde/faixa_verde_final/freio_motor,
        nota_desempenho)
  └── PontuacaoPeriodo (motorista_id, pontos_performance, pontos_km, pontuacao_final, ranking)
  └── NotaGerada (motorista_id, periodo, texto_nota, indicadores_resumo)
```

---

## 3. Pseudocódigo do Motor de Raciocínio

### 3.1 Worker de Ingestão

```python
def autenticar_multiportal(tenant):
    if redis.get(f"token:{tenant.id}") existe e nao expirado:
        return token

    resposta = POST /seguranca/logon {
        username: tenant.credencial.username,
        password: tenant.credencial.password,
        appid: tenant.credencial.appid,
        token: null,
        expiration: null
    }
    salvar resposta.token e resposta.expiration no Redis
    return resposta.token


def job_ingestao_online(tenant):
    token = autenticar_multiportal(tenant)
    dados = POST /integracao/dados_novos  (header: token)

    for veiculo_dado in dados.object:
        salvar_leitura_telemetria(
            veiculo_id      = veiculo_dado.id,
            timestamp       = veiculo_dado.dataPosicao,
            odometro        = veiculo_dado.odometroGps,
            velocidade      = veiculo_dado.velocidade,
            rpm             = veiculo_dado.rpm,            # confirmar nome exato do campo
            perc_acelerador = veiculo_dado.percAcelerador, # confirmar nome exato do campo
            ignicao         = veiculo_dado.ignicao,
            lat = veiculo_dado.latitude, lng = veiculo_dado.longitude
        )
    # job recorrente (ex: a cada 1-3 min), respeitando o limite de cache da API


def job_acumulados_mensais(tenant, mes_ano):
    token = autenticar_multiportal(tenant)
    for veiculo in listar_veiculos(tenant):
        odometro = POST /acumulados/odometromensal {veiculoid, mesAno}
        conducao = POST /acumulados/conducao        {veiculoid, mesAno}
        paradas  = POST /acumulados/paradas          {veiculoid, mesAno}
        velocidade = POST /acumulados/velocidade     {veiculoid, mesAno}
        salvar_acumulado_diario(veiculo, odometro, conducao, paradas, velocidade)
    # job recorrente (ex: 1x por dia, ou ao final de cada mês)
```

> **Pendência:** preciso validar com você (ou com um payload real de `/integracao/dados_novos`) os nomes exatos dos campos de RPM, % do acelerador e consumo instantâneo/litros — a documentação que tenho não detalha esse JSON especificamente. Quando tiver acesso de teste, um exemplo de retorno real resolve isso rapidamente.

---

### 3.2 Motor de Cálculo (Processamento por Período)

```python
def calcular_indicadores(veiculo_id, data_inicio, data_fim):
    leituras = buscar_leituras_telemetria(veiculo_id, data_inicio, data_fim)
    leituras = ordenar_por_timestamp(leituras)

    # --- KM e Consumo ---
    odometro_inicial = leituras[0].odometro
    odometro_final   = leituras[-1].odometro
    km_total = odometro_final - odometro_inicial

    consumo_total_litros = obter_consumo_periodo(veiculo_id, data_inicio, data_fim)
    # via acumulado mensal ou soma de consumo instantâneo, se disponível

    media_km_l = km_total / consumo_total_litros if consumo_total_litros > 0 else None

    # --- Velocidade Média ---
    velocidade_media = media_ponderada_por_tempo(leituras, campo="velocidade")

    # --- Classificação de Faixas de RPM ---
    tempo_total = soma_tempo_entre_leituras(leituras)
    tempo_faixa_verde_inicial = 0   # 1300-1899
    tempo_faixa_verde_final   = 0   # 1900-2099
    tempo_freio_motor         = 0   # 2100-2800 (com acelerador < 7%)
    tempo_acelerando_critico  = 0   # RPM 2100-2800 com acelerador >= 7% -> uso indevido do freio motor

    for leitura, delta_t in pares_consecutivos(leituras):
        rpm  = leitura.rpm
        acel = leitura.perc_acelerador

        if 1300 <= rpm <= 1899:
            tempo_faixa_verde_inicial += delta_t
        elif 1900 <= rpm <= 2099:
            tempo_faixa_verde_final += delta_t
        elif 2100 <= rpm <= 2800:
            if acel < 7:
                tempo_freio_motor += delta_t          # uso correto do freio motor
            else:
                tempo_acelerando_critico += delta_t    # motorista acelerando na faixa crítica (negativo)

    perc_faixa_verde_inicial = tempo_faixa_verde_inicial / tempo_total * 100
    perc_faixa_verde_final   = tempo_faixa_verde_final   / tempo_total * 100
    perc_freio_motor         = tempo_freio_motor         / tempo_total * 100
    perc_acelerando_critico  = tempo_acelerando_critico  / tempo_total * 100

    # --- Classificação de Pressão do Acelerador ---
    tempo_acelerador_ideal   = 0  # <= 60%
    tempo_acelerador_atencao = 0  # 61% - 70%
    tempo_acelerador_critico = 0  # >= 71%

    for leitura, delta_t in pares_consecutivos(leituras):
        acel = leitura.perc_acelerador
        if acel <= 60:
            tempo_acelerador_ideal += delta_t
        elif acel <= 70:
            tempo_acelerador_atencao += delta_t
        else:
            tempo_acelerador_critico += delta_t

    perc_acel_ideal   = tempo_acelerador_ideal   / tempo_total * 100
    perc_acel_atencao = tempo_acelerador_atencao / tempo_total * 100
    perc_acel_critico = tempo_acelerador_critico / tempo_total * 100

    # --- Detecção de Frenagens ---
    # Limiares definidos (em m/s²; velocidade da API normalmente vem em km/h,
    # por isso a conversão delta_v_kmh / 3.6 abaixo):
    LIMIAR_FRENAGEM_MIN    = 2.00  # m/s² -> abaixo disso é variação normal de velocidade, não conta como frenagem
    LIMIAR_FRENAGEM_BRUSCA = 2.94  # m/s² (0,30 g) -> a partir disso é "frenagem brusca"
    # Faixa entre 2.00 e 2.94 m/s² => "frenagem normal" (classificação intermediária,
    # análoga ao padrão ideal/atenção/crítico usado nos demais indicadores -- CONFIRMAR com o cliente)

    frenagens_totais          = 0  # qualquer frenagem >= LIMIAR_FRENAGEM_MIN
    frenagens_normais         = 0  # entre LIMIAR_FRENAGEM_MIN e LIMIAR_FRENAGEM_BRUSCA
    frenagens_bruscas         = 0  # >= LIMIAR_FRENAGEM_BRUSCA
    frenagens_alta_velocidade = 0  # qualquer frenagem (>= LIMIAR_FRENAGEM_MIN) ocorrida com
                                    # velocidade ANTES da frenagem > 70 km/h

    for leitura_anterior, leitura_atual, delta_t in pares_consecutivos(leituras):
        delta_v_kmh = leitura_anterior.velocidade - leitura_atual.velocidade
        delta_v_ms  = delta_v_kmh / 3.6
        desaceleracao_ms2 = delta_v_ms / delta_t  # m/s²

        if desaceleracao_ms2 >= LIMIAR_FRENAGEM_MIN:
            frenagens_totais += 1

            if desaceleracao_ms2 >= LIMIAR_FRENAGEM_BRUSCA:
                frenagens_bruscas += 1
            else:
                frenagens_normais += 1

            if leitura_anterior.velocidade > 70:
                frenagens_alta_velocidade += 1

    frenagens_por_100km = (frenagens_totais / km_total) * 100 if km_total > 0 else 0

    return IndicadorPeriodo(
        km_total=km_total,
        consumo_total_litros=consumo_total_litros,
        media_km_l=media_km_l,
        velocidade_media=velocidade_media,
        odometro_final=odometro_final,
        frenagens_totais=frenagens_totais,
        frenagens_normais=frenagens_normais,
        frenagens_bruscas=frenagens_bruscas,
        frenagens_alta_velocidade=frenagens_alta_velocidade,
        frenagens_por_100km=frenagens_por_100km,
        perc_acel_ideal=perc_acel_ideal,
        perc_acel_atencao=perc_acel_atencao,
        perc_acel_critico=perc_acel_critico,
        perc_faixa_verde_inicial=perc_faixa_verde_inicial,
        perc_faixa_verde_final=perc_faixa_verde_final,
        perc_freio_motor=perc_freio_motor,
        perc_acelerando_critico=perc_acelerando_critico,
    )
```

> **Pendências/assunções a confirmar:**
> - A faixa entre 2,00 m/s² e 2,94 m/s² foi assumida como "frenagem normal" (intermediária), seguindo o mesmo padrão ideal/atenção/crítico usado para acelerador e RPM. Confirmar se essa é a leitura correta.
> - "Frenagens em alta velocidade" foi modelada como qualquer frenagem (>= 2,00 m/s²) ocorrida com velocidade anterior > 70 km/h. Confirmar.

---

### 3.3 Cálculo da Nota de Desempenho (0-100)

Com base nos pesos definidos:

| Componente | Peso | Regra |
|---|---|---|
| Aproveitamento da Faixa Verde | 25% | quanto mais tempo na faixa verde, melhor |
| Aproveitamento de Embalo | 10% | quanto mais tempo em embalo (Eco-Roll/I-Roll), melhor |
| Motor Ligado Parado | 20% | quanto menos tempo, melhor — tolerância de 5 min por parada |
| Acelerando acima do verde (RPM > 2100 e acelerador > 7%) | 25% | quanto menos tempo, melhor |
| Excesso de velocidade (> 90 km/h) | 10% | tolerância de 10% das posições por janela de 1h, antes de pontuar |
| **Soma dos pesos** | **90%** | normalizado para 0-100 (dividindo a nota bruta por 0,90) |

```python
def calcular_nota_desempenho(veiculo_id, leituras, indicador, tempo_total):

    # 1) Aproveitamento da Faixa Verde (peso 25%)
    #    soma das duas faixas verdes já calculadas em 3.2
    score_faixa_verde = indicador.perc_faixa_verde_inicial + indicador.perc_faixa_verde_final
    score_faixa_verde = min(score_faixa_verde, 100)

    # 2) Aproveitamento de Embalo (peso 10%)
    #    PENDÊNCIA: precisa de um indicador/flag de "embalo" (Eco-Roll/I-Roll) vindo da API.
    tempo_embalo = somar_tempo_embalo(leituras)   # a definir como identificar
    score_embalo = (tempo_embalo / tempo_total) * 100

    # 3) Motor Ligado Parado (peso 20%)
    #    Definição confirmada: ignição ligada + motor funcionando + velocidade = 0.
    #    Tolerância de até 5 minutos por parada (não penaliza dentro desse tempo).
    TOLERANCIA_PARADA_SEGUNDOS = 5 * 60
    paradas = identificar_paradas(leituras)  # agrupa sequências com ignição=ligada, motor=ligado, velocidade=0
    tempo_penalizado = 0
    for parada in paradas:
        if parada.duracao_segundos > TOLERANCIA_PARADA_SEGUNDOS:
            tempo_penalizado += (parada.duracao_segundos - TOLERANCIA_PARADA_SEGUNDOS)

    perc_penalizado_parado = (tempo_penalizado / tempo_total) * 100
    score_motor_parado = max(0, 100 - perc_penalizado_parado)

    # 4) Acelerando acima do verde / faixa crítica (peso 25%)
    #    já calculado em 3.2 como perc_acelerando_critico (RPM 2100-2800 com acelerador > 7%)
    score_acelerando_critico = max(0, 100 - indicador.perc_acelerando_critico)

    # 5) Excesso de velocidade > 90 km/h (peso 10%) — tolerância de 10% por janela de 1h
    TOLERANCIA_EXCESSO_PERC = 10
    janelas = agrupar_leituras_por_janela(leituras, janela="1h")
    excessos = []
    for janela in janelas:
        total_posicoes = len(janela.leituras)
        posicoes_acima_90 = contar(janela.leituras, lambda l: l.velocidade > 90)
        perc_acima_90 = (posicoes_acima_90 / total_posicoes) * 100

        excedente = max(0, perc_acima_90 - TOLERANCIA_EXCESSO_PERC)
        excessos.append(excedente)

    media_excedente_velocidade = media(excessos) if excessos else 0
    score_excesso_velocidade = max(0, 100 - media_excedente_velocidade)

    # --- Composição final ---
    soma_pesos = 0.25 + 0.10 + 0.20 + 0.25 + 0.10  # = 0.90

    nota_bruta = (
        score_faixa_verde        * 0.25 +
        score_embalo             * 0.10 +
        score_motor_parado       * 0.20 +
        score_acelerando_critico * 0.25 +
        score_excesso_velocidade * 0.10
    )

    # normalização para escala 0-100, já que os pesos somam 90% (confirmado: sem 6º critério)
    nota_desempenho = nota_bruta / soma_pesos

    return nota_desempenho
```

> **Pendência da Nota de Desempenho:**
> - **"Aproveitamento de Embalo"** — aguardando teste da API da Multiportal para identificar o campo/flag correspondente (ex: Eco-Roll/I-Roll). Os pesos (90% → normalizados para 100%) e a definição de "Motor Ligado Parado" (ignição ligada + motor funcionando + velocidade = 0, tolerância de 5 min por parada) já estão confirmados e aplicados acima.

---

### 3.4 Motor de Pontuação

```python
def calcular_pontuacao(indicadores_motoristas):
    # indicadores_motoristas: lista de IndicadorPeriodo, um por motorista, já com nota_desempenho calculada

    nota_max = max(m.nota_desempenho for m in indicadores_motoristas)
    km_max   = max(m.km_total for m in indicadores_motoristas)

    resultado = []
    for m in indicadores_motoristas:
        pontos_performance = (m.nota_desempenho / nota_max) * 600
        pontos_km          = (m.km_total / km_max) * 400
        pontuacao_final    = pontos_performance + pontos_km

        resultado.append(PontuacaoPeriodo(
            motorista_id=m.motorista_id,
            pontos_performance=pontos_performance,
            pontos_km=pontos_km,
            pontuacao_final=pontuacao_final
        ))

    resultado.sort(by=pontuacao_final, desc=True)  # gera ranking
    return resultado
```

---

### 3.5 Motor de Geração de Nota ao Condutor

```python
def gerar_nota(motorista_id, indicador_atual, indicador_periodo_anterior, pontuacao):
    insights = []

    # Comparativo de período
    if indicador_periodo_anterior:
        delta_kml = indicador_atual.media_km_l - indicador_periodo_anterior.media_km_l
        if delta_kml > 0:
            insights.append(f"Sua média subiu de {indicador_periodo_anterior.media_km_l:.2f} "
                             f"para {indicador_atual.media_km_l:.2f} km/L.")
        elif delta_kml < 0:
            insights.append(f"Sua média caiu de {indicador_periodo_anterior.media_km_l:.2f} "
                             f"para {indicador_atual.media_km_l:.2f} km/L.")

    # Uso do acelerador
    if indicador_atual.perc_acel_critico > 10:
        insights.append(f"Você passou {indicador_atual.perc_acel_critico:.1f}% do tempo "
                         f"com o acelerador na faixa crítica (>=71%), o que impacta "
                         f"diretamente seu consumo.")

    # Freio motor mal utilizado
    if indicador_atual.perc_acelerando_critico > 0:
        insights.append(f"Em {indicador_atual.perc_acelerando_critico:.1f}% do tempo você "
                         f"acelerou enquanto o motor estava na faixa de freio motor "
                         f"(2100-2800 RPM) — nessa faixa o ideal é não acelerar.")

    # Frenagens
    if indicador_atual.frenagens_alta_velocidade > 0:
        insights.append(f"Foram registradas {indicador_atual.frenagens_alta_velocidade} "
                         f"frenagens em velocidade acima de 70 km/h.")

    insights.append(f"Sua pontuação no período foi de {pontuacao.pontuacao_final:.0f} pontos "
                     f"({pontuacao.pontos_performance:.0f} de desempenho + "
                     f"{pontuacao.pontos_km:.0f} de km rodado).")

    texto_final = montar_texto_legivel(insights)  # template ou, futuramente, LLM
    return NotaGerada(motorista_id=motorista_id, texto=texto_final, indicadores=indicador_atual)
```

---

## 4. Próximos Passos Sugeridos

1. **Testar a API da Multiportal** e compartilhar aqui o payload real de `/integracao/dados_novos` — isso resolve duas pendências de uma vez: (a) confirmar os nomes dos campos de RPM, % acelerador e consumo, e (b) identificar como vem a informação de "Embalo" (Eco-Roll/I-Roll) para fechar o último critério da Nota de Desempenho.
2. **Confirmar a classificação intermediária de frenagens** (entre 2,00 e 2,94 m/s² — seção 3.2), se possível também validada com dados reais.
3. Desenhar o schema SQL (DDL) das tabelas descritas na seção 2.
4. Estruturar o esqueleto dos dois serviços (NestJS + Python) com Docker Compose para começarmos a prototipar.

---

*Documento gerado como referência viva — será atualizado conforme o projeto evolui.*
