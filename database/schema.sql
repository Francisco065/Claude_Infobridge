-- ============================================================
--  INFOBRIDGE — Schema SQL Completo
--  Banco: PostgreSQL 15+ com extensão TimescaleDB
--  Versão: 1.0
--
--  Estratégia multi-tenant:
--    • Schema único + coluna tenant_id em todas as tabelas
--    • Row Level Security (RLS) para isolamento de dados
--    • TimescaleDB hypertable para a tabela de telemetria (leitura_telemetria)
--
--  Ordem de criação:
--    1. Extensões
--    2. Tabelas de suporte / referência
--    3. Tenants e Usuários
--    4. Integração / Credenciais
--    5. Veículos e Motoristas
--    6. Telemetria (hypertable)
--    7. Acumulados e Indicadores
--    8. Pontuação e Notas
--    9. Índices
--   10. Row Level Security
-- ============================================================


-- ============================================================
-- 1. EXTENSÕES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS "timescaledb";  -- hypertable séries temporais
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- busca fuzzy em nomes/placas


-- ============================================================
-- 2. TABELAS DE REFERÊNCIA / SUPORTE
-- ============================================================

-- Tabela de mapeamento de componentes Multiportal
-- (popula-se com a chamada GET /info/componentes)
CREATE TABLE componente_ref (
    id          INTEGER      PRIMARY KEY,  -- id da Multiportal
    nome        VARCHAR(200) NOT NULL,
    categoria   VARCHAR(20)  NOT NULL      -- 'CAN', 'OBD2', 'UNIVERSAL', 'OUTRO'
        CHECK (categoria IN ('CAN','OBD2','UNIVERSAL','OUTRO')),
    unidade     VARCHAR(30),               -- 'km/h', 'RPM', '%', 'L', 'bool' …
    descricao   TEXT,
    ativo       BOOLEAN      NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE componente_ref IS
    'Catálogo de IDs de componentes da API Multiportal. '
    'Fonte: GET /info/componentes. Atualizar quando a Multiportal adicionar novos IDs.';

-- Pré-populando os IDs mapeados na análise dos JSONs
INSERT INTO componente_ref (id, nome, categoria, unidade) VALUES
    (1,    'Ignicao',                              'UNIVERSAL', 'bool'),
    (2,    'Bloqueador',                           'UNIVERSAL', 'bool'),
    (3,    'Sirene',                               'UNIVERSAL', 'bool'),
    (10,   'Odômetro GPS',                         'UNIVERSAL', 'km'),
    (11,   'Tensão da Bateria',                    'UNIVERSAL', 'V'),
    (12,   'Tensão da Bateria Backup',             'UNIVERSAL', 'V'),
    (13,   'Veloax (vel. máx. do intervalo)',      'UNIVERSAL', 'km/h'),
    (14,   'Velomédia (vel. média do intervalo)',  'UNIVERSAL', 'km/h'),
    (43,   'Bateria Principal',                    'UNIVERSAL', 'bool'),
    (45,   'Trava de Baú',                         'UNIVERSAL', 'bool'),
    (70,   'Modulo Antifurto',                     'UNIVERSAL', 'bool'),
    (90,   'RPM Média',                            'UNIVERSAL', 'RPM'),
    (101,  'ID de Motorista',                      'UNIVERSAL', NULL),
    (9088, 'Odômetro via Rede CAN',               'CAN',       'km'),
    (9089, 'Velocidade via Rede CAN',              'CAN',       'km/h'),
    (9090, 'RPM via Rede CAN',                     'CAN',       'RPM'),
    (9091, 'Temperatura via Rede CAN',             'CAN',       '°C'),
    (9092, 'Consumo de Combustível via Rede CAN',  'CAN',       'L'),
    (9093, 'Marcha via Rede CAN',                  'CAN',       NULL),
    (9182, 'OBD2: RPM do motor',                   'OBD2',      'RPM'),
    (9183, 'OBD2: Velocidade do Veículo',          'OBD2',      'km/h'),
    (9202, 'Consumo de Combustível Total CAN',     'CAN',       'L'),
    (9205, 'Nível de Combustível em Litros CAN',   'CAN',       'L'),
    (9206, 'Nível de Combustível em % CAN',        'CAN',       '%'),
    (9208, 'Pressão no Pedal do Acelerador CAN',   'CAN',       '%'),
    (9209, 'Tempo de Direção CAN',                 'CAN',       's'),
    (9210, 'Tempo de Motor Ocioso CAN',            'CAN',       's'),
    (9211, 'Consumo do Motor Ocioso CAN',          'CAN',       'L'),
    (9224, 'Indicador de Cruise Control CAN',      'CAN',       'bool'),
    (9225, 'Indicador de Pedal do Freio CAN',      'CAN',       'bool'),
    (9226, 'Indicador de Pedal de Embreagem CAN',  'CAN',       'bool'),
    (9372, 'RPM OBD2 (Média)',                     'OBD2',      'RPM'),
    (9373, 'RPM OBD2 (Mínimo)',                    'OBD2',      'RPM'),
    (9374, 'RPM OBD2 (Máximo)',                    'OBD2',      'RPM'),
    (9443, 'OBD2: Combustível total usado do motor','OBD2',     'L'),
    (9444, 'OBD2: Eco instantâneo de combustão',   'OBD2',      'L/100km'),
    (9445, 'OBD2: Posição do pedal do acelerador', 'OBD2',      '%'),
    (9446, 'OBD2: Posição do pedal de freio',      'OBD2',      '%'),
    (9447, 'OBD2: Torque atual do motor',          'OBD2',      'Nm'),
    (9448, 'OBD2: Marcha atual da transmissão',    'OBD2',      NULL);

-- Tabela de eventos Multiportal relevantes para o motor
CREATE TABLE evento_ref (
    id    INTEGER      PRIMARY KEY,  -- eventoId da Multiportal
    nome  VARCHAR(200) NOT NULL,
    categoria VARCHAR(50)            -- 'FRENAGEM', 'RPM', 'IDLE', 'VELOCIDADE', 'FREIO_MOTOR'
);

INSERT INTO evento_ref (id, nome, categoria) VALUES
    (13576, 'Telemetria J1939 Frenagem',                        'FRENAGEM'),
    (13579, 'Telemetria J1939 Fora Faixa Verde',                'RPM'),
    (13580, 'Telemetria J1939 RPM Excessiva',                   'RPM'),
    (13632, 'Freio motor acionado',                             'FREIO_MOTOR'),
    (13633, 'Freio motor liberado',                             'FREIO_MOTOR'),
    (13634, 'Freio de serviço acionado',                        'FRENAGEM'),
    (13635, 'Freio de serviço liberado',                        'FRENAGEM'),
    (13636, 'Limite de RPM excedido',                           'RPM'),
    (13637, 'Limite de RPM excedido e totalizado',              'RPM'),
    (13640, 'Limite de RPM com freio motor acionado excedido',  'RPM'),
    (13642, 'Limite velocidade baixa rotação (banguela)',        'RPM'),
    (13643, 'Banguela totalizado',                              'RPM'),
    (13648, 'Veículo (motor) parado com ignição ligada',        'IDLE'),
    (13649, 'Motor parado com ignição ligada totalizado',       'IDLE'),
    (13650, 'Excesso de marcha-lenta atingido',                 'IDLE'),
    (13652, 'Pé no acelerador em neutro atingido',              'ACELERADOR'),
    (13654, 'Freada muito brusca',                              'FRENAGEM');


-- ============================================================
-- 3. TENANTS E USUÁRIOS
-- ============================================================

CREATE TABLE tenants (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    nome          VARCHAR(200) NOT NULL,
    cnpj          VARCHAR(14)  UNIQUE,
    plano         VARCHAR(30)  NOT NULL DEFAULT 'starter'
        CHECK (plano IN ('starter','pro','enterprise')),
    ativo         BOOLEAN      NOT NULL DEFAULT TRUE,
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tenants IS
    'Empresas clientes do Infobridge (unidade de multi-tenancy).';

-- ----------------------------------------------------------------

CREATE TABLE usuarios (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nome          VARCHAR(200) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    senha_hash    TEXT         NOT NULL,    -- bcrypt / argon2
    perfil        VARCHAR(20)  NOT NULL DEFAULT 'operador'
        CHECK (perfil IN ('admin','gestor','operador','readonly')),
    ativo         BOOLEAN      NOT NULL DEFAULT TRUE,
    ultimo_login  TIMESTAMPTZ,
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE usuarios IS
    'Usuários individuais por tenant. '
    'perfil admin = acesso total; gestor = visualiza todos os veículos; '
    'operador = acesso ao próprio veículo/motorista; readonly = somente leitura.';


-- ============================================================
-- 4. CREDENCIAIS DE INTEGRAÇÃO MULTIPORTAL
-- ============================================================

CREATE TABLE credencial_integracao (
    id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    username         VARCHAR(200) NOT NULL,
    -- senha armazenada criptografada (AES-256 via aplicação, nunca em claro)
    password_enc     TEXT    NOT NULL,
    appid            INTEGER NOT NULL,
    -- cache do token em uso (renovado automaticamente pelo worker)
    token_cache      TEXT,
    token_expiracao  BIGINT,  -- Unix timestamp ms (campo "expiration" do Handshake)
    ativo            BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id)   -- um tenant = uma credencial Multiportal (por ora)
);

COMMENT ON TABLE credencial_integracao IS
    'Credenciais da API Multiportal por tenant. '
    'password_enc deve ser criptografado pela camada de aplicação antes de persistir. '
    'token_cache e token_expiracao são gerenciados pelo worker de ingestão via Redis.';


-- ============================================================
-- 5. VEÍCULOS E MOTORISTAS
-- ============================================================

CREATE TABLE veiculos (
    id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    id_multiportal         BIGINT       NOT NULL,
    placa                  VARCHAR(10),
    marca                  VARCHAR(100),
    modelo                 VARCHAR(200),
    ano_fabricacao         SMALLINT,
    frota                  VARCHAR(100),          -- código/nome da frota
    tipo_monitoramento     VARCHAR(10),           -- 'M' (Multiportal)
    -- Tipo de dispositivo: inferido na ingestão pelo conjunto de componentes presentes
    tipo_dispositivo       VARCHAR(10)  DEFAULT 'GPS'
        CHECK (tipo_dispositivo IN ('CAN','OBD2','GPS')),
    -- Parâmetros de referência para o motor de cálculo
    consumo_referencia_kml NUMERIC(6,2),          -- consumo esperado (benchmark da frota)
    capacidade_tanque_l    NUMERIC(8,2),
    ativo                  BOOLEAN      NOT NULL DEFAULT TRUE,
    criado_em              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    atualizado_em          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, id_multiportal)
);

COMMENT ON TABLE veiculos IS
    'Espelha os veículos da Multiportal. '
    'tipo_dispositivo é inferido na primeira ingestão: se a posição '
    'contiver componente 9090 → CAN; 9182 → OBD2; caso contrário → GPS.';

-- ----------------------------------------------------------------

CREATE TABLE motoristas (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    id_multiportal  BIGINT,                       -- id no sistema Multiportal (pode ser null se cadastro manual)
    nome            VARCHAR(200) NOT NULL,
    cpf             VARCHAR(11)  UNIQUE,
    cnh             VARCHAR(20),
    categoria_cnh   VARCHAR(5),                   -- A, B, C, D, E, AB…
    ativo           BOOLEAN      NOT NULL DEFAULT TRUE,
    criado_em       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, id_multiportal)
);

-- ----------------------------------------------------------------

CREATE TABLE vinculo_motorista_veiculo (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL REFERENCES tenants(id),
    motorista_id UUID        NOT NULL REFERENCES motoristas(id),
    veiculo_id   UUID        NOT NULL REFERENCES veiculos(id),
    inicio       TIMESTAMPTZ NOT NULL,
    fim          TIMESTAMPTZ,              -- NULL = vínculo ativo
    fonte        VARCHAR(30) NOT NULL DEFAULT 'multiportal'
        CHECK (fonte IN ('multiportal','manual')),
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE vinculo_motorista_veiculo IS
    'Histórico de quem dirigiu qual veículo. '
    'fim=NULL indica o vínculo corrente. '
    'Um veículo pode ter apenas um vínculo ativo por vez.';


-- ============================================================
-- 6. TELEMETRIA (HYPERTABLE TIMESCALEDB)
-- ============================================================

CREATE TABLE leitura_telemetria (
    -- ── identificação ────────────────────────────────────────
    tenant_id    UUID        NOT NULL,
    veiculo_id   UUID        NOT NULL,
    motorista_id UUID,                        -- pode ser NULL se não identificado

    -- ── timestamps ───────────────────────────────────────────
    ts           TIMESTAMPTZ NOT NULL,         -- dataEquipamento (relógio do rastreador)
    ts_gateway   TIMESTAMPTZ,                  -- dataGateway (chegada no servidor)

    -- ── evento Multiportal ───────────────────────────────────
    evento_id    INTEGER,                      -- eventoId do objeto posição
    -- (nome do evento não armazenado; usar JOIN com evento_ref)

    -- ── posição ──────────────────────────────────────────────
    latitude     NUMERIC(10,7),
    longitude    NUMERIC(10,7),
    altitude_m   SMALLINT,
    proa         SMALLINT,                     -- heading (graus)
    hdop         NUMERIC(4,1),
    satelites    SMALLINT,
    gps_valido   BOOLEAN      NOT NULL DEFAULT TRUE,
    endereco     TEXT,

    -- ── cinemática ───────────────────────────────────────────
    velocidade   SMALLINT,                     -- km/h (campo top-level do objeto posição)

    -- ── telemetria de motor / transmissão ────────────────────
    -- Estratégia de leitura: worker tenta CAN primeiro, depois OBD2, depois básico
    -- (ver função extrair_componente no pseudocódigo)
    rpm          SMALLINT,                     -- 9090 > 9182 > 90
    perc_acelerador NUMERIC(5,2),             -- 9208 > 9445  (0.00–100.00 %)
    marcha       SMALLINT,                     -- 9093 > 9448

    -- ── consumo ──────────────────────────────────────────────
    consumo_total_l   NUMERIC(12,3),           -- 9202 > 9443  (acumulado desde o início)
    consumo_inst_l    NUMERIC(8,4),            -- 9092 > 9444  (instantâneo por posição)

    -- ── odômetro ─────────────────────────────────────────────
    odometro_km  NUMERIC(12,3),               -- 9088 > odometroGps(top) > comp 10

    -- ── estados binários ─────────────────────────────────────
    ignicao      BOOLEAN,                      -- comp 1
    cruise_ctrl  BOOLEAN,                      -- comp 9224
    pedal_freio  BOOLEAN,                      -- comp 9225 ou comp 9446 > 0
    embreagem    BOOLEAN,                      -- comp 9226 (TRUE = pressionada)

    -- ── classificações derivadas (calculadas pelo worker) ────
    is_embalo        BOOLEAN   DEFAULT FALSE,  -- vel>0 + acel=0 + embreagem=FALSE
    is_motor_ocioso  BOOLEAN   DEFAULT FALSE,  -- ignicao=TRUE + vel=0

    faixa_rpm    VARCHAR(20)                   -- 'abaixo_verde'|'verde_inicial'|
        CHECK (faixa_rpm IN (                  --  'verde_final'|'freio_motor_ok'|
            'abaixo_verde',                    --  'freio_motor_acelerando'|'acima'
            'verde_inicial',
            'verde_final',
            'freio_motor_ok',
            'freio_motor_acelerando',
            'acima'
        )),

    faixa_acelerador VARCHAR(10)               -- 'ideal'|'atencao'|'critico'
        CHECK (faixa_acelerador IN ('ideal','atencao','critico')),

    -- ── metadados da ingestão ────────────────────────────────
    fonte_rpm        VARCHAR(10),              -- 'CAN'|'OBD2'|'BASICO'|NULL
    fonte_acelerador VARCHAR(10),             -- 'CAN'|'OBD2'|NULL
    ingerido_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, veiculo_id, ts)
);

COMMENT ON TABLE leitura_telemetria IS
    'Série temporal de telemetria. Convertida em hypertable pelo TimescaleDB '
    '(particionamento por ts, 7 dias por chunk). '
    'Campos derivados (faixa_rpm, faixa_acelerador, is_embalo, is_motor_ocioso) '
    'são preenchidos pelo worker de ingestão Python para evitar recálculo na consulta. '
    'Posições com gps_valido=FALSE são armazenadas mas excluídas dos cálculos de km.';

-- Converter em hypertable TimescaleDB (particionar por ts, chunks de 7 dias)
SELECT create_hypertable(
    'leitura_telemetria',
    'ts',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Compressão automática para chunks com mais de 30 dias (economiza ~90% de espaço)
ALTER TABLE leitura_telemetria SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'tenant_id, veiculo_id',
    timescaledb.compress_orderby = 'ts ASC'
);

SELECT add_compression_policy('leitura_telemetria', INTERVAL '30 days');


-- ============================================================
-- 7. ACUMULADOS DIÁRIOS
-- ============================================================

CREATE TABLE acumulado_diario (
    id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID  NOT NULL REFERENCES tenants(id),
    veiculo_id   UUID  NOT NULL REFERENCES veiculos(id),
    motorista_id UUID  REFERENCES motoristas(id),
    data         DATE  NOT NULL,

    -- km e consumo
    odometro_inicial_km  NUMERIC(12,3),
    odometro_final_km    NUMERIC(12,3),
    km_rodado            NUMERIC(10,3),
    consumo_litros       NUMERIC(10,2),

    -- velocidade
    velocidade_media_kmh NUMERIC(6,2),
    velocidade_max_kmh   NUMERIC(6,2),

    -- tempos em segundos
    tempo_ignicao_ligada_s  INTEGER,           -- total ignição ON
    tempo_em_movimento_s    INTEGER,
    tempo_motor_ocioso_s    INTEGER,           -- ignicao=TRUE + vel=0 (bruto, antes da tolerância)
    tempo_motor_ocioso_penalizado_s INTEGER,   -- após descontar os 5 min de tolerância por parada

    -- faixas RPM (segundos)
    tempo_abaixo_verde_s        INTEGER DEFAULT 0,
    tempo_faixa_verde_inicial_s INTEGER DEFAULT 0,  -- 1300-1899 RPM
    tempo_faixa_verde_final_s   INTEGER DEFAULT 0,  -- 1900-2099 RPM
    tempo_freio_motor_ok_s      INTEGER DEFAULT 0,  -- 2100-2800 + acel<7% (positivo)
    tempo_freio_motor_acel_s    INTEGER DEFAULT 0,  -- 2100-2800 + acel≥7% (negativo)
    tempo_acima_verde_s         INTEGER DEFAULT 0,  -- >2800 RPM
    tempo_embalo_s              INTEGER DEFAULT 0,

    -- acelerador (segundos)
    tempo_acel_ideal_s   INTEGER DEFAULT 0,   -- ≤60%
    tempo_acel_atencao_s INTEGER DEFAULT 0,   -- 61-70%
    tempo_acel_critico_s INTEGER DEFAULT 0,   -- ≥71%

    -- frenagens
    frenagens_totais          INTEGER DEFAULT 0,
    frenagens_normais         INTEGER DEFAULT 0,   -- 2,00–2,94 m/s²
    frenagens_bruscas         INTEGER DEFAULT 0,   -- ≥2,94 m/s² (0,30g)
    frenagens_alta_velocidade INTEGER DEFAULT 0,   -- qualquer frenagem com vel>70 km/h antes

    -- excesso de velocidade (posições >90 km/h)
    total_posicoes            INTEGER DEFAULT 0,
    posicoes_acima_90kmh      INTEGER DEFAULT 0,

    -- metadados
    fonte          VARCHAR(20) NOT NULL DEFAULT 'calculado'
        CHECK (fonte IN ('calculado','acumulados_api','misto')),
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, veiculo_id, data)
);

COMMENT ON TABLE acumulado_diario IS
    'Consolidação diária dos indicadores por veículo/motorista. '
    'Alimentada tanto pelo motor de cálculo (a partir de leitura_telemetria) '
    'quanto pelos endpoints /acumulados/* da API Multiportal para dias anteriores.';


-- ============================================================
-- 8. INDICADORES POR PERÍODO
-- ============================================================

CREATE TABLE indicador_periodo (
    id             UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID  NOT NULL REFERENCES tenants(id),
    motorista_id   UUID  NOT NULL REFERENCES motoristas(id),
    veiculo_id     UUID  NOT NULL REFERENCES veiculos(id),

    periodo_inicio DATE  NOT NULL,
    periodo_fim    DATE  NOT NULL,
    tipo_periodo   VARCHAR(20) NOT NULL DEFAULT 'mensal'
        CHECK (tipo_periodo IN ('mensal','semanal','personalizado')),

    -- km e consumo
    km_total             NUMERIC(10,3),
    odometro_inicial_km  NUMERIC(12,3),
    odometro_final_km    NUMERIC(12,3),
    consumo_total_litros NUMERIC(10,2),
    media_km_l           NUMERIC(8,3),

    -- velocidade
    velocidade_media_kmh NUMERIC(6,2),
    velocidade_max_kmh   NUMERIC(6,2),

    -- frenagens
    frenagens_totais          INTEGER DEFAULT 0,
    frenagens_normais         INTEGER DEFAULT 0,
    frenagens_bruscas         INTEGER DEFAULT 0,
    frenagens_alta_velocidade INTEGER DEFAULT 0,
    frenagens_por_100km       NUMERIC(8,2),

    -- acelerador (% do tempo em movimento)
    perc_acel_ideal   NUMERIC(5,2),
    perc_acel_atencao NUMERIC(5,2),
    perc_acel_critico NUMERIC(5,2),

    -- faixas RPM (% do tempo com ignicao=TRUE)
    perc_faixa_verde_inicial  NUMERIC(5,2),  -- 1300-1899 RPM
    perc_faixa_verde_final    NUMERIC(5,2),  -- 1900-2099 RPM
    perc_freio_motor_ok       NUMERIC(5,2),  -- 2100-2800 + acel<7%
    perc_freio_motor_acel     NUMERIC(5,2),  -- 2100-2800 + acel≥7%
    perc_embalo               NUMERIC(5,2),

    -- motor ocioso
    perc_motor_ocioso               NUMERIC(5,2),
    tempo_motor_ocioso_penalizado_s INTEGER,

    -- excesso de velocidade (média das janelas de 1h)
    perc_excesso_velocidade   NUMERIC(5,2),

    -- ── scores individuais (0–100) ───────────────────────────
    -- Cada score representa quão bem o motorista se saiu naquele critério
    score_faixa_verde        NUMERIC(5,2),  -- (perc_verde_inicial + perc_verde_final)  — peso 25%
    score_embalo             NUMERIC(5,2),  -- perc_embalo                              — peso 10%
    score_motor_ocioso       NUMERIC(5,2),  -- 100 − perc_motor_ocioso                  — peso 20%
    score_acelerando_critico NUMERIC(5,2),  -- 100 − perc_freio_motor_acel              — peso 25%
    score_excesso_velocidade NUMERIC(5,2),  -- baseado em janelas de 1h                 — peso 10%

    -- ── nota de desempenho final (0–100) ────────────────────
    -- = (scores × pesos) / 0,90  (pesos somam 90%, normalizado)
    nota_desempenho          NUMERIC(5,2),

    -- metadados
    total_posicoes   INTEGER,              -- leituras processadas no período
    tipo_dispositivo VARCHAR(10),          -- 'CAN'|'OBD2'|'GPS'
    calculado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, motorista_id, veiculo_id, periodo_inicio, periodo_fim)
);

COMMENT ON TABLE indicador_periodo IS
    'Resultado consolidado do motor de raciocínio por motorista/veículo/período. '
    'Gerado pelo worker Python a partir de acumulado_diario (ou leitura_telemetria). '
    'nota_desempenho alimenta pontuacao_periodo.';


-- ============================================================
-- 9. PONTUAÇÃO E RANKING
-- ============================================================

CREATE TABLE pontuacao_periodo (
    id             UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID  NOT NULL REFERENCES tenants(id),
    motorista_id   UUID  NOT NULL REFERENCES motoristas(id),

    periodo_inicio DATE  NOT NULL,
    periodo_fim    DATE  NOT NULL,
    tipo_periodo   VARCHAR(20) NOT NULL DEFAULT 'mensal',

    -- base para cálculo
    nota_desempenho NUMERIC(5,2),
    km_total        NUMERIC(10,3),

    -- referências do grupo (calculadas comparando todos os motoristas do tenant no período)
    nota_max_grupo  NUMERIC(5,2),   -- maior nota_desempenho do tenant no período
    km_max_grupo    NUMERIC(10,3),  -- maior km_total do tenant no período

    -- pontuação calculada
    -- pontos_performance = (nota_desempenho / nota_max_grupo) × 600
    pontos_performance NUMERIC(8,2),
    -- pontos_km = (km_total / km_max_grupo) × 400
    pontos_km          NUMERIC(8,2),
    -- pontuacao_final = pontos_performance + pontos_km  (máx: 1000)
    pontuacao_final    NUMERIC(8,2),

    -- ranking
    posicao_ranking        INTEGER,
    total_motoristas_grupo INTEGER,

    calculado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, motorista_id, periodo_inicio, periodo_fim)
);

COMMENT ON TABLE pontuacao_periodo IS
    'Pontuação gamificada (máx 1000 pts) por motorista por período. '
    'Calculada APÓS todos os indicador_periodo do grupo (tenant) estarem prontos, '
    'pois depende de nota_max_grupo e km_max_grupo para normalização. '
    'posicao_ranking = posição do motorista no ranking do tenant naquele período.';


-- ============================================================
-- 10. NOTAS GERADAS AO CONDUTOR
-- ============================================================

CREATE TABLE nota_gerada (
    id                    UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID  NOT NULL REFERENCES tenants(id),
    motorista_id          UUID  NOT NULL REFERENCES motoristas(id),
    indicador_periodo_id  UUID  REFERENCES indicador_periodo(id),
    pontuacao_periodo_id  UUID  REFERENCES pontuacao_periodo(id),

    periodo_inicio DATE NOT NULL,
    periodo_fim    DATE NOT NULL,

    -- conteúdo
    texto_nota  TEXT    NOT NULL,    -- nota legível gerada pelo motor (template ou LLM)
    insights    JSONB,               -- lista estruturada dos insights detectados
    -- Exemplo de insights JSONB:
    -- [
    --   {"tipo": "acelerador_critico", "valor": 12.3, "mensagem": "Você passou 12,3% ..."},
    --   {"tipo": "frenagem_brusca",    "valor": 5,    "mensagem": "5 frenagens bruscas ..."},
    --   {"tipo": "consumo_kml",        "valor": 3.21, "delta": 0.15, "mensagem": "Média subiu ..."}
    -- ]

    -- comparativo com período anterior
    nota_desempenho_anterior NUMERIC(5,2),
    pontuacao_anterior       NUMERIC(8,2),
    media_kml_anterior       NUMERIC(8,3),
    delta_kml                NUMERIC(6,3),   -- variação positiva = melhora

    -- metadados
    gerado_por    VARCHAR(20) NOT NULL DEFAULT 'template'
        CHECK (gerado_por IN ('template','llm')),
    visualizado   BOOLEAN NOT NULL DEFAULT FALSE,
    visualizado_em TIMESTAMPTZ,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE nota_gerada IS
    'Nota/feedback gerado automaticamente para o condutor ao final de cada período. '
    'insights (JSONB) armazena a lista estruturada de pontos de atenção detectados. '
    'gerado_por="llm" indica que o texto foi gerado por IA (Claude API) em vez de template.';


-- ============================================================
-- 11. ÍNDICES
-- ============================================================

-- ── leitura_telemetria ─────────────────────────────────────
-- TimescaleDB cria índice em (ts) automaticamente.
-- Precisamos de índices adicionais para os padrões de consulta do motor:

-- Consultar todas as leituras de um veículo num intervalo (padrão principal)
CREATE INDEX idx_telemetria_veiculo_ts
    ON leitura_telemetria (tenant_id, veiculo_id, ts DESC);

-- Consultar leituras de um motorista num intervalo
CREATE INDEX idx_telemetria_motorista_ts
    ON leitura_telemetria (tenant_id, motorista_id, ts DESC)
    WHERE motorista_id IS NOT NULL;

-- Filtrar por evento (detecção de frenagem brusca, motor idle via eventoId)
CREATE INDEX idx_telemetria_evento
    ON leitura_telemetria (tenant_id, evento_id, ts DESC)
    WHERE evento_id IS NOT NULL;

-- Motor de cálculo: filtrar posições com ignição ligada e parado
CREATE INDEX idx_telemetria_motor_ocioso
    ON leitura_telemetria (tenant_id, veiculo_id, ts)
    WHERE is_motor_ocioso = TRUE;

-- Motor de cálculo: filtrar por faixa RPM
CREATE INDEX idx_telemetria_faixa_rpm
    ON leitura_telemetria (tenant_id, veiculo_id, faixa_rpm, ts)
    WHERE faixa_rpm IS NOT NULL;

-- ── acumulado_diario ───────────────────────────────────────
CREATE INDEX idx_acumulado_motorista_data
    ON acumulado_diario (tenant_id, motorista_id, data DESC);

CREATE INDEX idx_acumulado_veiculo_data
    ON acumulado_diario (tenant_id, veiculo_id, data DESC);

-- ── indicador_periodo ──────────────────────────────────────
CREATE INDEX idx_indicador_motorista_periodo
    ON indicador_periodo (tenant_id, motorista_id, periodo_inicio DESC);

CREATE INDEX idx_indicador_periodo_nota
    ON indicador_periodo (tenant_id, periodo_inicio, nota_desempenho DESC);

-- ── pontuacao_periodo ──────────────────────────────────────
-- Ranking: ordenar motoristas por pontuação final
CREATE INDEX idx_pontuacao_ranking
    ON pontuacao_periodo (tenant_id, periodo_inicio, pontuacao_final DESC);

-- ── veiculos e motoristas ──────────────────────────────────
CREATE INDEX idx_veiculos_tenant
    ON veiculos (tenant_id) WHERE ativo = TRUE;

CREATE INDEX idx_veiculos_multiportal
    ON veiculos (tenant_id, id_multiportal);

CREATE INDEX idx_motoristas_tenant
    ON motoristas (tenant_id) WHERE ativo = TRUE;

-- Busca por nome (pg_trgm para busca parcial)
CREATE INDEX idx_motoristas_nome_trgm
    ON motoristas USING GIN (nome gin_trgm_ops);

-- ── vinculo ────────────────────────────────────────────────
CREATE INDEX idx_vinculo_veiculo_ativo
    ON vinculo_motorista_veiculo (tenant_id, veiculo_id, inicio DESC)
    WHERE fim IS NULL;


-- ============================================================
-- 12. ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Habilitar RLS em todas as tabelas com tenant_id
ALTER TABLE usuarios                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE credencial_integracao      ENABLE ROW LEVEL SECURITY;
ALTER TABLE veiculos                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE motoristas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinculo_motorista_veiculo  ENABLE ROW LEVEL SECURITY;
ALTER TABLE leitura_telemetria         ENABLE ROW LEVEL SECURITY;
ALTER TABLE acumulado_diario           ENABLE ROW LEVEL SECURITY;
ALTER TABLE indicador_periodo          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pontuacao_periodo          ENABLE ROW LEVEL SECURITY;
ALTER TABLE nota_gerada                ENABLE ROW LEVEL SECURITY;

-- ── Role de aplicação ──────────────────────────────────────
-- A aplicação conecta como 'infobridge_app' e seta o tenant_id
-- via parâmetro de sessão antes de executar queries:
--   SET app.current_tenant = '<uuid-do-tenant>';

CREATE ROLE infobridge_app LOGIN PASSWORD 'trocar_em_producao';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO infobridge_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO infobridge_app;

-- ── Políticas RLS — padrão: cada role vê apenas seu tenant ─
-- (as policies abaixo usam current_setting para ler o tenant_id da sessão)

CREATE POLICY tenant_isolation ON usuarios
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON credencial_integracao
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON veiculos
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON motoristas
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON vinculo_motorista_veiculo
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON leitura_telemetria
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON acumulado_diario
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON indicador_periodo
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON pontuacao_periodo
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON nota_gerada
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- ── Role de superadmin Infobridge (acesso cross-tenant) ────
-- Usado pela equipe de suporte e pelo worker de ingestão
CREATE ROLE infobridge_admin LOGIN PASSWORD 'trocar_em_producao';
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO infobridge_admin;
ALTER ROLE infobridge_admin BYPASS ROW LEVEL SECURITY;

-- ── Role read-only para relatórios/BI ──────────────────────
CREATE ROLE infobridge_readonly LOGIN PASSWORD 'trocar_em_producao';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO infobridge_readonly;


-- ============================================================
-- 13. FUNÇÕES UTILITÁRIAS
-- ============================================================

-- Atualiza automaticamente o campo atualizado_em
CREATE OR REPLACE FUNCTION fn_set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_veiculos_atualizado_em
    BEFORE UPDATE ON veiculos
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

CREATE TRIGGER trg_acumulado_atualizado_em
    BEFORE UPDATE ON acumulado_diario
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- ─────────────────────────────────────────────────────────────
-- Função auxiliar: retorna o motorista ativo de um veículo
-- num dado timestamp (usado pelo worker de ingestão)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_motorista_em(
    p_tenant_id  UUID,
    p_veiculo_id UUID,
    p_ts         TIMESTAMPTZ
)
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT motorista_id
    FROM   vinculo_motorista_veiculo
    WHERE  tenant_id  = p_tenant_id
      AND  veiculo_id = p_veiculo_id
      AND  inicio    <= p_ts
      AND  (fim IS NULL OR fim > p_ts)
    ORDER BY inicio DESC
    LIMIT 1;
$$;

COMMENT ON FUNCTION fn_motorista_em IS
    'Retorna o UUID do motorista vinculado a um veículo em determinado momento. '
    'Usado pelo worker de ingestão para preencher motorista_id em leitura_telemetria.';

-- ─────────────────────────────────────────────────────────────
-- View: leituras agregadas por hora (base para cálculo de
-- excesso de velocidade em janelas de 1h)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_telemetria_por_hora AS
SELECT
    tenant_id,
    veiculo_id,
    motorista_id,
    time_bucket('1 hour', ts) AS hora,
    COUNT(*)                              AS total_posicoes,
    COUNT(*) FILTER (WHERE velocidade > 90) AS posicoes_acima_90,
    ROUND(
        COUNT(*) FILTER (WHERE velocidade > 90)::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 2
    )                                     AS perc_acima_90,
    AVG(velocidade)                       AS velocidade_media,
    MAX(velocidade)                       AS velocidade_max,
    SUM(CASE WHEN rpm BETWEEN 1300 AND 1899 THEN 1 ELSE 0 END) AS posicoes_verde_inicial,
    SUM(CASE WHEN rpm BETWEEN 1900 AND 2099 THEN 1 ELSE 0 END) AS posicoes_verde_final,
    SUM(CASE WHEN is_motor_ocioso = TRUE    THEN 1 ELSE 0 END) AS posicoes_motor_ocioso
FROM leitura_telemetria
WHERE gps_valido = TRUE
GROUP BY tenant_id, veiculo_id, motorista_id, hora;

COMMENT ON VIEW vw_telemetria_por_hora IS
    'Agrega leituras em janelas de 1 hora usando time_bucket do TimescaleDB. '
    'Usada pelo motor de cálculo para o critério de excesso de velocidade (tolerância de 10% por janela).';


-- ============================================================
-- FIM DO SCHEMA
-- ============================================================
-- Próximo passo: popular componente_ref com todos os IDs via
--   GET http://apiv1.multiportal.com.br:9870/info/componentes
-- e popular evento_ref via
--   GET http://apiv1.multiportal.com.br:9870/info/eventos
-- ============================================================
