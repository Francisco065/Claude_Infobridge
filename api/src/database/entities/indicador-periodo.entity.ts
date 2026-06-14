import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { TipoPeriodo, TipoDispositivo } from './enums';
import { Motorista }                     from './motorista.entity';
import { Veiculo }                       from './veiculo.entity';

@Entity('indicador_periodo')
@Unique(['tenantId', 'motoristaId', 'veiculoId', 'periodoInicio', 'periodoFim'])
@Index(['tenantId', 'motoristaId', 'periodoInicio'])
@Index(['tenantId', 'periodoInicio', 'notaDesempenho'])
export class IndicadorPeriodo {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'motorista_id', type: 'uuid' })
  motoristaId: string;

  @Column({ name: 'veiculo_id', type: 'uuid' })
  veiculoId: string;

  @Column({ name: 'periodo_inicio', type: 'date' })
  periodoInicio: string;

  @Column({ name: 'periodo_fim', type: 'date' })
  periodoFim: string;

  @Column({ name: 'tipo_periodo', type: 'enum', enum: TipoPeriodo, default: TipoPeriodo.MENSAL })
  tipoPeriodo: TipoPeriodo;

  // ── KM e Consumo ──────────────────────────────────────────
  @Column({ name: 'km_total', type: 'numeric', precision: 10, scale: 3, nullable: true })
  kmTotal: number;

  @Column({ name: 'odometro_inicial_km', type: 'numeric', precision: 12, scale: 3, nullable: true })
  odometroInicialKm: number;

  @Column({ name: 'odometro_final_km', type: 'numeric', precision: 12, scale: 3, nullable: true })
  odometroFinalKm: number;

  @Column({ name: 'consumo_total_litros', type: 'numeric', precision: 10, scale: 2, nullable: true })
  consumoTotalLitros: number;

  @Column({ name: 'media_km_l', type: 'numeric', precision: 8, scale: 3, nullable: true })
  mediaKmL: number;

  // ── Velocidade ────────────────────────────────────────────
  @Column({ name: 'velocidade_media_kmh', type: 'numeric', precision: 6, scale: 2, nullable: true })
  velocidadeMediaKmh: number;

  @Column({ name: 'velocidade_max_kmh', type: 'numeric', precision: 6, scale: 2, nullable: true })
  velocidadeMaxKmh: number;

  // ── Frenagens ─────────────────────────────────────────────
  @Column({ name: 'frenagens_totais', type: 'integer', default: 0 })
  frenagensTotais: number;

  @Column({ name: 'frenagens_normais', type: 'integer', default: 0 })
  frenagenNormais: number;

  @Column({ name: 'frenagens_bruscas', type: 'integer', default: 0 })
  frenagensBruscas: number;

  @Column({ name: 'frenagens_alta_velocidade', type: 'integer', default: 0 })
  frenagenAltaVelocidade: number;

  @Column({ name: 'frenagens_por_100km', type: 'numeric', precision: 8, scale: 2, nullable: true })
  frenagensPor100km: number;

  // ── Acelerador (% do tempo) ───────────────────────────────
  @Column({ name: 'perc_acel_ideal', type: 'numeric', precision: 5, scale: 2, nullable: true })
  percAcelIdeal: number;

  @Column({ name: 'perc_acel_atencao', type: 'numeric', precision: 5, scale: 2, nullable: true })
  percAcelAtencao: number;

  @Column({ name: 'perc_acel_critico', type: 'numeric', precision: 5, scale: 2, nullable: true })
  percAcelCritico: number;

  // ── Faixas RPM (% do tempo) ───────────────────────────────
  @Column({ name: 'perc_faixa_verde_inicial', type: 'numeric', precision: 5, scale: 2, nullable: true })
  percFaixaVerdeInicial: number;

  @Column({ name: 'perc_faixa_verde_final', type: 'numeric', precision: 5, scale: 2, nullable: true })
  percFaixaVerdeFinal: number;

  @Column({ name: 'perc_freio_motor_ok', type: 'numeric', precision: 5, scale: 2, nullable: true })
  percFreioMotorOk: number;

  @Column({ name: 'perc_freio_motor_acel', type: 'numeric', precision: 5, scale: 2, nullable: true })
  percFreioMotorAcel: number;

  @Column({ name: 'perc_embalo', type: 'numeric', precision: 5, scale: 2, nullable: true })
  percEmbalo: number;

  // ── Motor Ocioso ──────────────────────────────────────────
  @Column({ name: 'perc_motor_ocioso', type: 'numeric', precision: 5, scale: 2, nullable: true })
  percMotorOcioso: number;

  @Column({ name: 'tempo_motor_ocioso_penalizado_s', type: 'integer', nullable: true })
  tempoMotorOciosoPenalizadoS: number;

  // ── Excesso de Velocidade ─────────────────────────────────
  @Column({ name: 'perc_excesso_velocidade', type: 'numeric', precision: 5, scale: 2, nullable: true })
  percExcessoVelocidade: number;

  // ── Scores individuais (0–100) ────────────────────────────
  @Column({ name: 'score_faixa_verde', type: 'numeric', precision: 5, scale: 2, nullable: true })
  scoreFaixaVerde: number;

  @Column({ name: 'score_embalo', type: 'numeric', precision: 5, scale: 2, nullable: true })
  scoreEmbalo: number;

  @Column({ name: 'score_motor_ocioso', type: 'numeric', precision: 5, scale: 2, nullable: true })
  scoreMotorOcioso: number;

  @Column({ name: 'score_acelerando_critico', type: 'numeric', precision: 5, scale: 2, nullable: true })
  scoreAcelerandoCritico: number;

  @Column({ name: 'score_excesso_velocidade', type: 'numeric', precision: 5, scale: 2, nullable: true })
  scoreExcessoVelocidade: number;

  // ── Nota Final de Desempenho (0–100) ─────────────────────
  @Column({ name: 'nota_desempenho', type: 'numeric', precision: 5, scale: 2, nullable: true })
  notaDesempenho: number;

  // ── Metadados ─────────────────────────────────────────────
  @Column({ name: 'total_posicoes', type: 'integer', nullable: true })
  totalPosicoes: number;

  @Column({
    name: 'tipo_dispositivo',
    type: 'enum',
    enum: TipoDispositivo,
    nullable: true,
  })
  tipoDispositivo: TipoDispositivo;

  @CreateDateColumn({ name: 'calculado_em', type: 'timestamptz' })
  calculadoEm: Date;

  // ── Relacionamentos ───────────────────────────────────────
  @ManyToOne(() => Motorista, (m) => m.indicadores)
  @JoinColumn({ name: 'motorista_id' })
  motorista: Motorista;

  @ManyToOne(() => Veiculo)
  @JoinColumn({ name: 'veiculo_id' })
  veiculo: Veiculo;
}
