-- ============================================================
--  INFOBRIDGE — Seed de Desenvolvimento
--  Dados iniciais para testar todos os fluxos da API
-- ============================================================

-- ── Tenant de teste ───────────────────────────────────────────
INSERT INTO tenants (id, nome, cnpj, plano, ativo)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Inova Logística Integrada',
  '02572512000158',
  'pro',
  true
)
ON CONFLICT (id) DO NOTHING;

-- ── Credencial Multiportal do tenant ──────────────────────────
-- (password_enc é base64 de "1234" — placeholder para dev)
INSERT INTO credencial_integracao (id, tenant_id, username, password_enc, appid, ativo)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'administrador',
  'MTIzNA==',   -- base64("1234")
  1720,
  true
)
ON CONFLICT (id) DO NOTHING;

-- ── Usuários ──────────────────────────────────────────────────
-- Senha de todos: Infobridge@2026
-- hash bcrypt rounds=12: $2b$12$K7xTJlvPJXoP2sSmLCkXgu7dNGt3gC6xL6Mvz/0I2JM5iJ5mI9qVO
-- Para gerar: node -e "const b=require('bcrypt');b.hash('Infobridge@2026',12).then(console.log)"

INSERT INTO usuarios (id, tenant_id, nome, email, senha_hash, perfil, ativo)
VALUES
  -- Admin do tenant
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   'Admin Teste',
   'admin@inovalogistica.com.br',
   '$2b$12$K7xTJlvPJXoP2sSmLCkXgu7dNGt3gC6xL6Mvz/0I2JM5iJ5mI9qVO',
   'admin', true),
  -- Gestor
  ('44444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111',
   'Gestor Frota',
   'gestor@inovalogistica.com.br',
   '$2b$12$K7xTJlvPJXoP2sSmLCkXgu7dNGt3gC6xL6Mvz/0I2JM5iJ5mI9qVO',
   'gestor', true),
  -- Operador
  ('55555555-5555-5555-5555-555555555555',
   '11111111-1111-1111-1111-111111111111',
   'Operador 01',
   'operador@inovalogistica.com.br',
   '$2b$12$K7xTJlvPJXoP2sSmLCkXgu7dNGt3gC6xL6Mvz/0I2JM5iJ5mI9qVO',
   'operador', true)
ON CONFLICT (id) DO NOTHING;

-- ── Veículos ──────────────────────────────────────────────────
INSERT INTO veiculos (id, tenant_id, id_multiportal, placa, marca, modelo, frota, tipo_dispositivo, consumo_referencia_kml, ativo)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   8001941, 'ABC1D23', 'Volvo', 'FH 460', 'Frota SP', 'CAN', 2.8, true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '11111111-1111-1111-1111-111111111111',
   8001939, 'DEF4G56', 'Scania', 'R 450', 'Frota SP', 'CAN', 2.6, true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111',
   8002166, 'GHI7J89', 'Mercedes', 'Actros 2651', 'Frota RJ', 'GPS', 2.4, true)
ON CONFLICT (id) DO NOTHING;

-- ── Motoristas ────────────────────────────────────────────────
INSERT INTO motoristas (id, tenant_id, id_multiportal, nome, cpf, cnh, categoria_cnh, ativo)
VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111',
   1001, 'Carlos Andrade Silva', '11122233344', '12345678901', 'E', true),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '11111111-1111-1111-1111-111111111111',
   1002, 'José Ferreira Santos', '55566677788', '98765432101', 'E', true),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',
   '11111111-1111-1111-1111-111111111111',
   1003, 'Maria Aparecida Lima', '99988877766', '11223344556', 'D', true)
ON CONFLICT (id) DO NOTHING;

-- ── Vínculos Motorista ↔ Veículo ─────────────────────────────
INSERT INTO vinculo_motorista_veiculo (id, tenant_id, motorista_id, veiculo_id, inicio, fim, fonte)
VALUES
  ('11111111-aaaa-aaaa-aaaa-111111111111',
   '11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '2026-01-01 00:00:00+00', NULL, 'manual'),
  ('22222222-bbbb-bbbb-bbbb-222222222222',
   '11111111-1111-1111-1111-111111111111',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '2026-01-01 00:00:00+00', NULL, 'manual')
ON CONFLICT (id) DO NOTHING;

-- ── Leituras de telemetria de exemplo ─────────────────────────
-- (Carlos Andrade, veículo ABC1D23, 13/Jun/2026)
INSERT INTO leitura_telemetria (
  tenant_id, veiculo_id, motorista_id, ts,
  latitude, longitude, velocidade, rpm, perc_acelerador,
  odometro_km, ignicao, gps_valido,
  faixa_rpm, faixa_acelerador, is_motor_ocioso, is_embalo,
  fonte_rpm, fonte_acelerador
) VALUES
  ('11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '2026-06-13 06:00:00+00',
   -18.9186, -48.2772, 0, 750, 0,
   28500.0, true, true,
   'abaixo_verde', 'ideal', true, false, 'CAN', 'CAN'),
  ('11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '2026-06-13 06:30:00+00',
   -18.8500, -48.1900, 75, 1650, 45.0,
   28558.5, true, true,
   'verde_inicial', 'ideal', false, false, 'CAN', 'CAN'),
  ('11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '2026-06-13 07:00:00+00',
   -18.7200, -48.0500, 90, 1850, 62.0,
   28625.0, true, true,
   'verde_inicial', 'atencao', false, false, 'CAN', 'CAN'),
  ('11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '2026-06-13 07:30:00+00',
   -18.5800, -47.9100, 65, 2200, 4.0,
   28689.0, true, true,
   'freio_motor_ok', 'ideal', false, true, 'CAN', 'CAN'),
  ('11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '2026-06-13 07:45:00+00',
   -18.5200, -47.8800, 95, 2350, 80.0,
   28707.5, true, true,
   'freio_motor_acelerando', 'critico', false, false, 'CAN', 'CAN')
ON CONFLICT (tenant_id, veiculo_id, ts) DO NOTHING;

-- ── Mensagem de confirmação ───────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE '✅ Seed carregado com sucesso!';
  RAISE NOTICE '   Tenant: Inova Logística (11111111-1111-...)';
  RAISE NOTICE '   Usuários: admin/gestor/operador@inovalogistica.com.br';
  RAISE NOTICE '   Senha: Infobridge@2026';
  RAISE NOTICE '   Veículos: 3 | Motoristas: 3 | Vínculos: 2';
END $$;
