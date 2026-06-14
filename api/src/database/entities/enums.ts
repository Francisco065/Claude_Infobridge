/**
 * enums.ts
 * Enums TypeScript que espelham os CHECK constraints definidos no schema SQL.
 * Centralizado aqui para reutilização em entidades, DTOs e serviços.
 */

// ── Tenant ────────────────────────────────────────────────────
export enum TenantPlano {
  STARTER    = 'starter',
  PRO        = 'pro',
  ENTERPRISE = 'enterprise',
}

// ── Usuário ───────────────────────────────────────────────────
export enum UsuarioPerfil {
  ADMIN    = 'admin',
  GESTOR   = 'gestor',
  OPERADOR = 'operador',
  READONLY = 'readonly',
}

// ── Veiculo ───────────────────────────────────────────────────
export enum TipoDispositivo {
  CAN  = 'CAN',
  OBD2 = 'OBD2',
  GPS  = 'GPS',
}

// ── Vínculo Motorista/Veículo ─────────────────────────────────
export enum FonteVinculo {
  MULTIPORTAL = 'multiportal',
  MANUAL      = 'manual',
}

// ── Leitura de Telemetria — Faixa RPM ────────────────────────
export enum FaixaRPM {
  ABAIXO_VERDE           = 'abaixo_verde',           // < 1300 RPM
  VERDE_INICIAL          = 'verde_inicial',           // 1300–1899 RPM ← ideal
  VERDE_FINAL            = 'verde_final',             // 1900–2099 RPM ← atenção
  FREIO_MOTOR_OK         = 'freio_motor_ok',          // 2100–2800 + acel < 7% (positivo)
  FREIO_MOTOR_ACELERANDO = 'freio_motor_acelerando',  // 2100–2800 + acel ≥ 7% (negativo)
  ACIMA                  = 'acima',                   // > 2800 RPM
}

// ── Leitura de Telemetria — Faixa Acelerador ─────────────────
export enum FaixaAcelerador {
  IDEAL   = 'ideal',    // ≤ 60%
  ATENCAO = 'atencao',  // 61–70%
  CRITICO = 'critico',  // ≥ 71%
}

// ── Acumulado e Indicador — Fonte dos dados ───────────────────
export enum FonteAcumulado {
  CALCULADO     = 'calculado',
  ACUMULADOS_API = 'acumulados_api',
  MISTO         = 'misto',
}

// ── Indicador Período — Tipo ──────────────────────────────────
export enum TipoPeriodo {
  MENSAL       = 'mensal',
  SEMANAL      = 'semanal',
  PERSONALIZADO = 'personalizado',
}

// ── Nota Gerada — Gerado por ──────────────────────────────────
export enum GeradoPor {
  TEMPLATE = 'template',
  LLM      = 'llm',
}

// ── Componente Ref — Categoria ────────────────────────────────
export enum CategoriaComponente {
  CAN       = 'CAN',
  OBD2      = 'OBD2',
  UNIVERSAL = 'UNIVERSAL',
  OUTRO     = 'OUTRO',
}
