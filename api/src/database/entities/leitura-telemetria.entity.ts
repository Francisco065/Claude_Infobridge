import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { FaixaRPM, FaixaAcelerador } from './enums';

/**
 * LeituraTelemetria
 *
 * Mapeia a hypertable `leitura_telemetria` do TimescaleDB.
 *
 * ⚠️  ATENÇÃO — cuidados especiais para hypertable:
 *
 *  1. PK COMPOSTA: (tenant_id, veiculo_id, ts)
 *     TypeORM suporta PKs compostas via múltiplos @PrimaryColumn.
 *     Ao usar .findOne() / .findBy(), sempre passe os três campos.
 *
 *  2. NUNCA use synchronize: true ou migrations para esta tabela.
 *     A criação via create_hypertable() precisa ser feita pelo SQL inicial.
 *     O TypeORM só lê os dados — não gerencia o DDL desta tabela.
 *
 *  3. INSERTS em lote: usar QueryBuilder ou DataSource.query() com
 *     INSERT ... ON CONFLICT DO NOTHING para performance.
 *     Evitar repository.save() em loop — lento para telemetria.
 *
 *  4. QUERIES por período: sempre incluir ts no WHERE para usar
 *     o particionamento do TimescaleDB:
 *       WHERE tenant_id = $1 AND veiculo_id = $2
 *         AND ts BETWEEN $3 AND $4
 */
@Entity('leitura_telemetria')
@Index(['tenantId', 'veiculoId', 'ts'])
@Index(['tenantId', 'motoristaId', 'ts'])
@Index(['tenantId', 'eventoId', 'ts'])
export class LeituraTelemetria {

  // ── PK Composta ───────────────────────────────────────────
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @PrimaryColumn({ name: 'veiculo_id', type: 'uuid' })
  veiculoId: string;

  /**
   * Timestamp do equipamento (relógio do rastreador).
   * Uso: dataEquipamento / 1000 (Unix ms → Unix s para JS Date).
   */
  @PrimaryColumn({ type: 'timestamptz' })
  ts: Date;

  // ── Identificação ─────────────────────────────────────────
  @Column({ name: 'motorista_id', type: 'uuid', nullable: true })
  motoristaId: string;

  @Column({ name: 'ts_gateway', type: 'timestamptz', nullable: true })
  tsGateway: Date;

  // ── Evento Multiportal ────────────────────────────────────
  /**
   * eventoId do objeto posição.
   * Eventos críticos para o motor:
   *   13654 = Freada muito brusca
   *   13648 = Motor parado com ignição ligada
   *   13632 = Freio motor acionado
   */
  @Column({ name: 'evento_id', type: 'integer', nullable: true })
  eventoId: number;

  // ── Posição GPS ───────────────────────────────────────────
  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  latitude: number;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  longitude: number;

  @Column({ name: 'altitude_m', type: 'smallint', nullable: true })
  altitudeM: number;

  @Column({ type: 'smallint', nullable: true })
  proa: number;

  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true })
  hdop: number;

  @Column({ type: 'smallint', nullable: true })
  satelites: number;

  @Column({ name: 'gps_valido', default: true })
  gpsValido: boolean;

  @Column({ type: 'text', nullable: true })
  endereco: string;

  // ── Cinemática ────────────────────────────────────────────
  /** Velocidade instantânea em km/h. Campo top-level do objeto posição. */
  @Column({ type: 'smallint', nullable: true })
  velocidade: number;

  // ── Telemetria de Motor / Transmissão ─────────────────────
  /**
   * Estratégia dual-track aplicada pelo worker de ingestão:
   *   rpm: 9090 CAN → 9182 OBD2 → 90 básico
   *   perc_acelerador: 9208 CAN → 9445 OBD2
   */
  @Column({ type: 'smallint', nullable: true })
  rpm: number;

  @Column({
    name: 'perc_acelerador',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  percAcelerador: number;

  @Column({ type: 'smallint', nullable: true })
  marcha: number;

  // ── Consumo ───────────────────────────────────────────────
  /** Consumo total acumulado (litros). Comp 9202 CAN → 9443 OBD2. */
  @Column({
    name: 'consumo_total_l',
    type: 'numeric',
    precision: 12,
    scale: 3,
    nullable: true,
  })
  consumoTotalL: number;

  /** Consumo instantâneo por posição (litros). Comp 9092 CAN. */
  @Column({
    name: 'consumo_inst_l',
    type: 'numeric',
    precision: 8,
    scale: 4,
    nullable: true,
  })
  consumoInstL: number;

  // ── Odômetro ──────────────────────────────────────────────
  /** Comp 9088 CAN → odometroGps top-level → comp 10. */
  @Column({
    name: 'odometro_km',
    type: 'numeric',
    precision: 12,
    scale: 3,
    nullable: true,
  })
  odometroKm: number;

  // ── Estados Binários ─────────────────────────────────────
  /** Comp 1. Crítico para detecção de motor ocioso. */
  @Column({ nullable: true })
  ignicao: boolean;

  /** Comp 9224. Piloto automático ativo. */
  @Column({ name: 'cruise_ctrl', nullable: true })
  cruiseCtrl: boolean;

  /** Comp 9225 ou 9446 > 0. */
  @Column({ name: 'pedal_freio', nullable: true })
  pedalFreio: boolean;

  /** Comp 9226. TRUE = pedal pressionado (embreagem desengrenada). */
  @Column({ nullable: true })
  embreagem: boolean;

  // ── Classificações Derivadas ──────────────────────────────
  /**
   * Calculadas pelo worker Python na ingestão para evitar recálculo em tempo de query.
   * Baseadas nas regras de motor/classificador.py.
   */
  @Column({ name: 'is_embalo', default: false })
  isEmbalo: boolean;

  /** TRUE quando ignicao=true E velocidade=0. */
  @Column({ name: 'is_motor_ocioso', default: false })
  isMotorOcioso: boolean;

  @Column({
    name: 'faixa_rpm',
    type: 'enum',
    enum: FaixaRPM,
    nullable: true,
  })
  faixaRpm: FaixaRPM;

  @Column({
    name: 'faixa_acelerador',
    type: 'enum',
    enum: FaixaAcelerador,
    nullable: true,
  })
  faixaAcelerador: FaixaAcelerador;

  // ── Rastreabilidade da Fonte ──────────────────────────────
  /** 'CAN' | 'OBD2' | 'BASICO' | null */
  @Column({ name: 'fonte_rpm', length: 10, nullable: true })
  fonteRpm: string;

  @Column({ name: 'fonte_acelerador', length: 10, nullable: true })
  fonteAcelerador: string;

  /** Array de componentes CRU como a Multiportal envia (diagnóstico/comparação). */
  @Column({ name: 'componentes_raw', type: 'jsonb', nullable: true })
  componentesRaw: any;

  @Column({ name: 'ingerido_em', type: 'timestamptz', default: () => 'NOW()' })
  ingeridoEm: Date;
}
