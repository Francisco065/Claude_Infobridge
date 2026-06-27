# fix(info-analise): polaridade de cores por métrica + status acessível

## Contexto
No painel **Info Análise**, a régua de cores tratava **todo** indicador como "quanto maior, melhor". Isso fazia comportamentos onde **menos é melhor** (excesso de velocidade, motor ligado parado, acelerando acima do verde) aparecerem em **vermelho/crítico** mesmo quando o desempenho era ótimo — por exemplo, `3%` de excesso de velocidade era exibido como crítico. Além disso, o estado bom/atenção/crítico era comunicado **apenas pela cor**, o que exclui usuários daltônicos e impressões em tons de cinza.

## O que muda

### 1. Polaridade por métrica
- Novo tipo `Polaridade = "maior" | "menor" | "fixo"` e função única `statusDe(pct, pol)`.
- Cada `CardComportamento` declara sua polaridade:
  - **maior é melhor:** Faixa verde, Aproveitamento de embalo, Faixa verde total, Faixa verde final, Freio motor.
  - **menor é melhor:** Excesso de velocidade, Motor ligado parado, Acelerando acima do verde.
  - **fixo:** Em movimento.
- Cortes centralizados num único ponto, fáceis de calibrar com a operação:
  - `CORTE_MAIOR = { bom: 70, atencao: 40 }`
  - `CORTE_MENOR = { bom: 15, atencao: 35 }`

### 2. Sinal de status não-cromático (acessibilidade)
- Cada card passa a exibir, além da cor: um **ícone de forma** (✓ círculo / ! triângulo / ✕ octógono) e uma **pílula de rótulo** ("Bom" / "Atenção" / "Crítico").
- A legenda do tooltip do card "Pressão do Acelerador" troca os **emojis** por ícones de forma com texto.

### Ajustes de acessibilidade que acompanham as duas mudanças
- Tooltip da legenda virou `<button>` real: focável por teclado, `aria-label`, `aria-expanded`, abre no foco e fecha com `Esc`.
- `<label htmlFor>` associado ao seletor de período e aos campos de login; `autoComplete="email"`/`current-password`; erro de login com `role="alert" aria-live`.
- Medidor (SVG) com `role="img"` + `aria-label` ("Nota de desempenho: N de 100 — Ótimo/Regular/Crítico").
- Ícones decorativos marcados com `aria-hidden`.
- Contraste de textos auxiliares ajustado de `#8A8D96` → `#6B6E76` (atende WCAG AA).

## Fora de escopo (sugestões para PRs futuros)
- Rota raiz `/` ainda é o boilerplate do Next.js.
- Self-host de fontes/ícones (hoje via CDN; Google Fonts via CDN tem implicação de LGPD).
- Remoção do `Geist` (importado e não usado) e limpeza do dark-mode latente em `globals.css`.
- Estado de "dados insuficientes" quando não há viagens processadas no período.

## Como testar
1. Subir o ambiente (`make up`) e logar no painel.
2. Selecionar um motorista com bom desempenho e confirmar que:
   - "Excesso de velocidade" e "Motor ligado parado" baixos aparecem **verdes/Bom** (antes: vermelhos).
   - Cada card mostra ícone de forma + rótulo coerentes com a cor.
3. Em tons de cinza (print P&B ou simulação de daltonismo), confirmar que o estado ainda é distinguível.
4. Teclado: `Tab` até o ícone de legenda do acelerador, abrir/fechar com `Enter`/`Esc`.

## Arquivos
- `infobridge/src/app/info-analise/page.tsx`

## Risco
Baixo — alteração isolada de apresentação/UX, sem mudanças de API, dados ou rotas.
