import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { FonteAcumulado } from './enums';
import { Veiculo }        from './veiculo.entity';
import { Motorista }      from './motorista.entity';

@Entity('acumulado_diario')
@Unique(['tenantId', 'veiculoId', 'data'])
@Index(['tenantId', 'motoristaId', 'data'])
@Index(['tenantId', 'veiculoId', 'data'])
export class AcumuladoDiario {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'veiculo_id', type: 'uuid' })
  veiculoId: string;

  @Column({ name: 'motorista_id', type: 'uuid', nullable: true })
  motoristaId: string;

  @Column({ type: 'date' })
  data: string;   // 'yyyy-MM-dd'

  // ── KM e Consumo ──────────────────────────────────────────
  @Column({ name: 'odometro_inicial_km', type: 'numeric', precision: 12, scale: 3, nullable: true })
  odometroInicialKm: number;

  @Column({ name: 'odometro_final_km', type: 'numeric', precision: 12, scale: 3, nullable: true })
  odometroFinalKm: number;

  @Column({ name: 'km_rodado', type: 'numeric', precision: 10, scale: 3, nullable: true })
  kmRodado: number;

  @Column({ name: 'consumo_litros', type: 'numeric', precision: 10, scale: 2, nullable: true })
  consumoLitros: number;

  // ── Velocidade ────────────────────────────────────────────
  @Column({ name: 'velocidade_media_kmh', type: 'numeric', precision: 6, scale: 2, nullable: true })
  velocidadeMediaKmh: number;

  @Column({ name: 'velocidade_max_kmh', type: 'numeric', precision: 6, scale: 2, nullable: true })
  velocidadeMaxKmh: number;

  // ── Tempos em segundos ────────────────────────────────────
  @Column({ name: 'tempo_ignicao_ligada_s', type: 'integer', nullable: true })
  tempoIgnicaoLigadaS: number;

  @Column({ name: 'tempo_em_movimento_s', type: 'integer', nullable: true })
  tempoEmMovimentoS: number;

  @Column({ name: 'tempo_motor_ocioso_s', type: 'integer', nullable: true })
  tempoMotorOciosoS: number;

  @Column({ name: 'tempo_motor_ocioso_penalizado_s', type: 'integer', nullable: true })
  tempoMotorOciosoPenalizadoS: number;

  // ── Faixas RPM (segundos) ─────────────────────────────────
  @Column({ name: 'tempo_abaixo_verde_s', type: 'integer', default: 0 })
  tempoAbaixoVerdeS: number;

  @Column({ name: 'tempo_faixa_verde_inicial_s', type: 'integer', default: 0 })
  tempoFaixaVerdeInicialS: number;

  @Column({ name: 'tempo_faixa_verde_final_s', type: 'integer', default: 0 })
  tempoFaixaVerdeFinalS: number;

  @Column({ name: 'tempo_freio_motor_ok_s', type: 'integer', default: 0 })
  tempoFreioMotorOkS: number;

  @Column({ name: 'tempo_freio_motor_acel_s', type: 'integer', default: 0 })
  tempoFreioMotorAcelS: number;

  @Column({ name: 'tempo_acima_verde_s', type: 'integer', default: 0 })
  tempoAcimaVerdeS: number;

  @Column({ name: 'tempo_embalo_s', type: 'integer', default: 0 })
  tempoEmbaloS: number;

  // ── Faixas Acelerador (segundos) ──────────────────────────
  @Column({ name: 'tempo_acel_ideal_s', type: 'integer', default: 0 })
  tempoAcelIdealS: number;

  @Column({ name: 'tempo_acel_atencao_s', type: 'integer', default: 0 })
  tempoAcelAtencaoS: number;

  @Column({ name: 'tempo_acel_critico_s', type: 'integer', default: 0 })
  tempoAcelCriticoS: number;

  // ── Frenagens ─────────────────────────────────────────────
  @Column({ name: 'frenagens_totais', type: 'integer', default: 0 })
  frenagensTotais: number;

  @Column({ name: 'frenagens_normais', type: 'integer', default: 0 })
  frenagenNormais: number;

  @Column({ name: 'frenagens_bruscas', type: 'integer', default: 0 })
  frenagensBruscas: number;

  @Column({ name: 'frenagens_alta_velocidade', type: 'integer', default: 0 })
  frenagenAltaVelocidade: number;

  // ── Excesso de Velocidade ────────────────────────────────
  @Column({ name: 'total_posicoes', type: 'integer', default: 0 })
  totalPosicoes: number;

  @Column({ name: 'posicoes_acima_90kmh', type: 'integer', default: 0 })
  posicoesAcima90Kmh: number;

  // ── Metadados ─────────────────────────────────────────────
  @Column({ type: 'enum', enum: FonteAcumulado, default: FonteAcumulado.CALCULADO })
  fonte: FonteAcumulado;

  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' })
  atualizadoEm: Date;

  // ── Relacionamentos ───────────────────────────────────────
  @ManyToOne(() => Veiculo)
  @JoinColumn({ name: 'veiculo_id' })
  veiculo: Veiculo;

  @ManyToOne(() => Motorista, { nullable: true })
  @JoinColumn({ name: 'motorista_id' })
  motorista: Motorista;
}
