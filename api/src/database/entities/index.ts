/**
 * index.ts — Barrel de entidades TypeORM
 *
 * Importar assim nos módulos:
 *   import { Tenant, Veiculo, Motorista } from '../database/entities';
 *
 * Registrar no TypeOrmModule.forFeature([...entidades]) de cada módulo.
 * A lista completa (ALL_ENTITIES) é usada no app.module.ts global.
 */

export * from './enums';

export { Tenant }                  from './tenant.entity';
export { Usuario }                 from './usuario.entity';
export { CredencialIntegracao }    from './credencial-integracao.entity';
export { Veiculo }                 from './veiculo.entity';
export { Motorista }               from './motorista.entity';
export { VinculoMotoristaVeiculo } from './vinculo-motorista-veiculo.entity';
export { LeituraTelemetria }       from './leitura-telemetria.entity';
export { AcumuladoDiario }         from './acumulado-diario.entity';
export { IndicadorPeriodo }        from './indicador-periodo.entity';
export { PontuacaoPeriodo }        from './pontuacao-periodo.entity';
export { NotaGerada }              from './nota-gerada.entity';

// ── Lista para TypeOrmModule.forFeature() ─────────────────────────
import { Tenant }                  from './tenant.entity';
import { Usuario }                 from './usuario.entity';
import { CredencialIntegracao }    from './credencial-integracao.entity';
import { Veiculo }                 from './veiculo.entity';
import { Motorista }               from './motorista.entity';
import { VinculoMotoristaVeiculo } from './vinculo-motorista-veiculo.entity';
import { LeituraTelemetria }       from './leitura-telemetria.entity';
import { AcumuladoDiario }         from './acumulado-diario.entity';
import { IndicadorPeriodo }        from './indicador-periodo.entity';
import { PontuacaoPeriodo }        from './pontuacao-periodo.entity';
import { NotaGerada }              from './nota-gerada.entity';

export const ALL_ENTITIES = [
  Tenant,
  Usuario,
  CredencialIntegracao,
  Veiculo,
  Motorista,
  VinculoMotoristaVeiculo,
  LeituraTelemetria,
  AcumuladoDiario,
  IndicadorPeriodo,
  PontuacaoPeriodo,
  NotaGerada,
];
