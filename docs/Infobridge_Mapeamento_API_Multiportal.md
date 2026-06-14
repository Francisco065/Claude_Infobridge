# Infobridge — Mapeamento Completo da API Multiportal
## Resultado da Análise dos Arquivos JSON (v1)

---

## 1. Estrutura do Objeto de Posição (dados_novos / ultimaPosicao)

Cada posição retornada tem **dois níveis** de dados:

### 1.1 Campos top-level do objeto posição
```json
{
  "eventoId":           18,
  "evento":             "Posição em Sleep",
  "dataEquipamento":    1781382313000,
  "dataEquipamentoFmt": "13/06/2026 17:25:13",
  "dataGPS":            1781382279000,
  "validade":           true,
  "latitude":           -23.553789,
  "longitude":          -46.938614,
  "velocidade":         17,
  "proa":               250,
  "altitude":           705,
  "hdop":               2,
  "satelites":          4,
  "motorista":          "NOME DO MOTORISTA",
  "odometroGps":        28644
}
```

| Campo | Uso no Motor | Obs |
|---|---|---|
| `velocidade` | Velocidade instantânea (km/h) | Principal campo de velocidade |
| `odometroGps` | Odômetro (km) | Disponível no nível raiz em alguns registros |
| `eventoId` | Classificação do evento | Chave para detecção de eventos prontos |
| `dataEquipamento` | Timestamp da leitura (Unix ms) | Usar para calcular delta_t entre posições |
| `latitude` / `longitude` | Posição geográfica | Para trajeto do mapa |
| `motorista` | Nome do motorista vinculado | Confirmar com `/motoristas` para ID |
| `validade` | GPS válido? | Filtrar posições inválidas antes de processar |

---

### 1.2 Array `componentes` — IDs Mapeados

Os componentes vêm como `{"id": N, "nome": null, "valor": "X"}` nos dados_novos
(o campo nome é null; usar a tabela abaixo para identificar pelo id).

#### Componentes Universais (presentes em todos os dispositivos)
| ID | Nome | Nosso uso |
|---|---|---|
| `1` | Ignição | 0=off, 1=on → **Motor Ligado Parado** |
| `2` | Bloqueador | — |
| `3` | Sirene | — |
| `10` | Odômetro GPS (km) | **Odômetro** (alternativa ao campo top-level) |
| `11` | Tensão da Bateria (V) | — |
| `13` | Veloax (vel. máx. do intervalo) | Validação |
| `14` | Velomédia (vel. média do intervalo) | Velocidade média parcial |
| `43` | Bateria Principal | — |
| `45` | Trava de Baú | — |
| `90` | RPM Média | **RPM** em dispositivos sem CAN/OBD2 |
| `101` | ID de Motorista | Identificação do condutor |

#### Componentes via Rede CAN (J1939)
| ID | Nome | Nosso uso |
|---|---|---|
| `9088` | Odômetro via Rede CAN | **Odômetro CAN** (preferir sobre GPS) |
| `9089` | Velocidade via Rede CAN | Velocidade CAN |
| `9090` | RPM via Rede CAN | **RPM** ← fonte primária |
| `9092` | Consumo de Combustível via Rede CAN | **Consumo instantâneo** |
| `9093` | Marcha via Rede CAN | **Marcha atual** |
| `9202` | Consumo de Combustível Total CAN | **Consumo acumulado** |
| `9205` | Nível de Combustível em Litros CAN | Nível do tanque |
| `9208` | Pressão no Pedal do Acelerador CAN | **% Acelerador** ← fonte primária |
| `9210` | Tempo de Motor Ocioso CAN | **Motor Ligado Parado** (acumulado) |
| `9211` | Consumo do Motor Ocioso CAN | Consumo em idle |
| `9224` | Indicador de Cruise Control CAN | **Piloto Automático** |
| `9225` | Indicador de Pedal do Freio CAN | Freio acionado |
| `9226` | Indicador de Pedal de Embreagem CAN | **Embreagem** → detectar Embalo |

#### Componentes via OBD2
| ID | Nome | Nosso uso |
|---|---|---|
| `9182` | OBD2: RPM do motor | **RPM** (alternativa ao CAN) |
| `9183` | OBD2: Velocidade do Veículo | Velocidade OBD2 |
| `9443` | OBD2: Combustível total usado do motor | **Consumo total** |
| `9444` | OBD2: Eco instantâneo de combustão | Consumo instantâneo eco |
| `9445` | OBD2: Posição do pedal do acelerador | **% Acelerador** (alternativa CAN) |
| `9446` | OBD2: Posição do pedal de freio | Freio |
| `9447` | OBD2: Torque atual do motor | Torque |
| `9448` | OBD2: Marcha atual da transmissão | Marcha OBD2 |
| `9372` | RPM OBD2 (Média) | RPM médio do intervalo |
| `9373` | RPM OBD2 (Mínimo) | RPM mínimo |
| `9374` | RPM OBD2 (Máximo) | RPM máximo |

> **Nota sobre id 9914:** Cruzando os dados de uma posição com `velocidade: 17` e `altitude: 792`,
> o componente 9914 retornou `valor: "792"` — coincidindo com altitude. Para outro dispositivo
> (hardware 225) retornou valores variáveis (32-73). O id 9914 não está na Lista de Componentes
> — provavelmente é específico de um modelo de hardware e deve ser ignorado até confirmação.

---

## 2. Eventos Relevantes para o Motor (Lista de Eventos)

A API já processa e **dispara eventos automáticos** para vários comportamentos que
precisamos detectar. Isso é uma fonte de dados complementar importantíssima —
especialmente para dispositivos que NÃO têm CAN/OBD2.

| eventoId | Nome do Evento | Nosso uso |
|---|---|---|
| `13648` | Veículo (motor) parado com ignição ligada | **Motor Ligado Parado** — evento disparado |
| `13649` | Veículo (motor) parado com ignição ligada totalizado | Total acumulado idle |
| `13632` | Freio motor acionado | Início do Freio Motor |
| `13633` | Freio motor liberado | Fim do Freio Motor |
| `13636` | Limite de RPM excedido | RPM acima do configurado |
| `13637` | Limite de RPM excedido e totalizado | Total tempo acima do RPM |
| `13640` | Limite de RPM com freio motor acionado excedido | Freio motor + RPM alto |
| `13642` | Limite velocidade baixa rotação (banguela) | Acelerador em baixo RPM |
| `13643` | Banguela totalizado | Total acumulado banguela |
| `13648` | Motor parado com ignição ligada | **Motor Ligado Parado** |
| `13650` | Excesso de marcha-lenta atingido | Idle excessivo |
| `13652` | Pé no acelerador em neutro atingido | Acelerador em neutro |
| `13654` | Freada muito brusca | **Frenagem Brusca** — evento direto! |
| `13576` | Telemetria J1939 Frenagem | Frenagem J1939 |
| `13579` | Telemetria J1939 Fora Faixa Verde | Fora da faixa verde J1939 |
| `13580` | Telemetria J1939 RPM Excessiva | RPM excessiva J1939 |

---

## 3. Arquitetura Dual-Track — Impacto no Motor de Raciocínio

### Descoberta crítica: Os dados disponíveis dependem do tipo de dispositivo instalado

Os arquivos revelam que a Multiportal suporta dois tipos principais de rastreadores:

**Track A — Dispositivos com CAN/OBD2** (caminhões modernos, integração J1939):
- Entregam RPM, % acelerador, consumo, marcha, embreagem, freio por posição
- Motor calcula tudo com precisão a partir da série temporal

**Track B — Dispositivos GPS básicos** (rastreadores simples sem telemetria):
- Entregam apenas velocidade, odômetro, ignição, lat/long
- Motor usa **eventos** (eventoId) + **acumulados** como fonte principal

### Estratégia: prioridade de fontes por campo

| Dado | Fonte Primária | Fonte Secundária | Fallback |
|---|---|---|---|
| Velocidade | `velocidade` (top-level) | comp `9089` ou `9183` | — |
| Odômetro | comp `9088` (CAN) | `odometroGps` (top-level) | comp `10` |
| RPM | comp `9090` (CAN) | comp `9182` (OBD2) | comp `90` / eventos |
| % Acelerador | comp `9208` (CAN) | comp `9445` (OBD2) | somente eventos |
| Consumo instant. | comp `9092` (CAN) | comp `9444` (OBD2) | acumulados |
| Consumo total | comp `9202` (CAN) | comp `9443` (OBD2) | acumulados |
| Ignição | comp `1` | — | — |
| Marcha | comp `9093` (CAN) | comp `9448` (OBD2) | — |
| Embreagem | comp `9226` (CAN) | — | somente eventos |
| Frenagem brusca | calc via Δv/Δt (se CAN) | eventoId `13654` | — |
| Motor idle | comp `9210` (CAN) | eventoId `13648` | comp `1` + vel=0 |
| Embalo | comp `9226`=0 + acel=0 + vel>0 | Eco-Roll/I-Roll (marca) | a definir |

### Hierarquia de resolução no Worker de Ingestão
```python
def extrair_componente(componentes: list, *ids_por_prioridade) -> str | None:
    """Tenta cada id em ordem, retorna o primeiro valor encontrado."""
    comp_index = {c["id"]: c["valor"] for c in componentes}
    for id in ids_por_prioridade:
        if id in comp_index and comp_index[id] not in (None, "0", ""):
            return comp_index[id]
    return None

# Uso:
rpm         = extrair_componente(componentes, 9090, 9182, 90)
acelerador  = extrair_componente(componentes, 9208, 9445)
consumo     = extrair_componente(componentes, 9202, 9443)
odometro    = extrair_componente(componentes, 9088, 10) or leitura.odometroGps
```

---

## 4. Detecção de Embalo — Estratégia Final

Embalo (Eco-Roll/I-Roll) não tem componente direto para dispositivos CAN básicos.
A detecção será por inferência:

```python
def is_embalo(leitura) -> bool:
    """
    Embalo = veículo em movimento com motor "livre" (sem acelerar, embreagem
    desengrenada ou relação de tração nula).
    Condições detectáveis pela API:
    """
    velocidade   = leitura.velocidade                                    # > 0 (em movimento)
    acelerador   = extrair_componente(leitura.componentes, 9208, 9445)  # = 0%
    embreagem    = extrair_componente(leitura.componentes, 9226)         # = 0 (desengrenada)
    cruise_ctrl  = extrair_componente(leitura.componentes, 9224)         # = 0 (sem piloto)
    rpm          = extrair_componente(leitura.componentes, 9090, 9182)  # < 900 (quase ralenti)

    if velocidade > 0 and acelerador == "0" and embreagem == "0":
        return True   # embreagem detectada via CAN — caso mais confiável

    # Fallback sem embreagem CAN: velocidade em queda + acelerador zero + RPM em queda
    # (implementar análise de tendência da série temporal)
    return False
```

> Para veículos Scania (I-Roll) e Volvo (Eco-Roll), as marcas reportam o estado
> diretamente via J1939. Se o Multiportal capturar esse PGN específico, ele
> provavelmente estará num componente CAN adicional — a confirmar com teste real.

---

## 5. Pendências Remanescentes

1. **id 9914** — confirmar o que representa para o hardware modelo 225
   (pode ser componente proprietário de um fabricante específico).
2. **Embalo/Eco-Roll** — verificar se existe componente ou evento CAN específico
   retornado por veículos Scania/Volvo nas chamadas reais de produção.
3. **Confirmação do consumo acumulado** — validar se `id: 9202` ou `id: 9443`
   entregam o consumo em litros e se o valor é acumulado desde o início da viagem
   ou diferencial por posição.
4. **Calibração do acelerador** — confirmar se `id: 9208` retorna valores de 0-100
   (percentual) ou 0-1 (decimal), a partir de dados reais.

---
*Gerado a partir da análise de: Dados_Novos__online__, Última_Posição, Lista_de_Componentes, Lista_de_Eventos*
