import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { GeradoPor }        from './enums';
import { IndicadorPeriodo } from './indicador-periodo.entity';

@Entity('nota_gerada')
@Index(['tenantId', 'motoristaId', 'periodoInicio'])
export class NotaGerada {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'motorista_id', type: 'uuid' })
  motoristaId: string;

  @Column({ name: 'indicador_periodo_id', type: 'uuid', nullable: true })
  indicadorPeriodoId: string;

  @Column({ name: 'pontuacao_periodo_id', type: 'uuid', nullable: true })
  pontuacaoPeriodoId: string;

  @Column({ name: 'periodo_inicio', type: 'date' })
  periodoInicio: string;

  @Column({ name: 'periodo_fim', type: 'date' })
  periodoFim: string;

  @Column({ name: 'texto_nota', type: 'text' })
  textoNota: string;

  @Column({ type: 'jsonb', nullable: true })
  insights: Record<string, any>[];

  @Column({ name: 'nota_desempenho_anterior', type: 'numeric', precision: 5, scale: 2, nullable: true })
  notaDesempenhoAnterior: number;

  @Column({ name: 'pontuacao_anterior', type: 'numeric', precision: 8, scale: 2, nullable: true })
  pontuacaoAnterior: number;

  @Column({ name: 'media_kml_anterior', type: 'numeric', precision: 8, scale: 3, nullable: true })
  mediaKmlAnterior: number;

  @Column({ name: 'delta_kml', type: 'numeric', precision: 6, scale: 3, nullable: true })
  deltaKml: number;

  @Column({ name: 'gerado_por', type: 'enum', enum: GeradoPor, default: GeradoPor.TEMPLATE })
  geradoPor: GeradoPor;

  @Column({ default: false })
  visualizado: boolean;

  @Column({ name: 'visualizado_em', type: 'timestamptz', nullable: true })
  visualizadoEm: Date;

  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' })
  criadoEm: Date;

  @ManyToOne(() => IndicadorPeriodo, { nullable: true })
  @JoinColumn({ name: 'indicador_periodo_id' })
  indicadorPeriodo: IndicadorPeriodo;
}
