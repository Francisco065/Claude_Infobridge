// ============================================================
// pontuacao-periodo.entity.ts
// ============================================================
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn, Index, Unique,
} from 'typeorm';
import { TipoPeriodo } from './enums';
import { Motorista }   from './motorista.entity';

@Entity('pontuacao_periodo')
@Unique(['tenantId', 'motoristaId', 'periodoInicio', 'periodoFim'])
@Index(['tenantId', 'periodoInicio', 'pontuacaoFinal'])  // para ranking
export class PontuacaoPeriodo {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'motorista_id', type: 'uuid' })
  motoristaId: string;

  @Column({ name: 'periodo_inicio', type: 'date' })
  periodoInicio: string;

  @Column({ name: 'periodo_fim', type: 'date' })
  periodoFim: string;

  @Column({ name: 'tipo_periodo', type: 'enum', enum: TipoPeriodo, default: TipoPeriodo.MENSAL })
  tipoPeriodo: TipoPeriodo;

  // ── Base para cálculo ─────────────────────────────────────
  @Column({ name: 'nota_desempenho', type: 'numeric', precision: 5, scale: 2, nullable: true })
  notaDesempenho: number;

  @Column({ name: 'km_total', type: 'numeric', precision: 10, scale: 3, nullable: true })
  kmTotal: number;

  // ── Referências do grupo (normalização) ───────────────────
  /** Maior nota_desempenho do tenant no período → equivale a 600 pts. */
  @Column({ name: 'nota_max_grupo', type: 'numeric', precision: 5, scale: 2, nullable: true })
  notaMaxGrupo: number;

  /** Maior km_total do tenant no período → equivale a 400 pts. */
  @Column({ name: 'km_max_grupo', type: 'numeric', precision: 10, scale: 3, nullable: true })
  kmMaxGrupo: number;

  // ── Pontuação calculada ───────────────────────────────────
  /** (nota_desempenho / nota_max_grupo) × 600 */
  @Column({ name: 'pontos_performance', type: 'numeric', precision: 8, scale: 2, nullable: true })
  pontosPerformance: number;

  /** (km_total / km_max_grupo) × 400 */
  @Column({ name: 'pontos_km', type: 'numeric', precision: 8, scale: 2, nullable: true })
  pontosKm: number;

  /** pontos_performance + pontos_km → máximo 1000 */
  @Column({ name: 'pontuacao_final', type: 'numeric', precision: 8, scale: 2, nullable: true })
  pontuacaoFinal: number;

  // ── Ranking ───────────────────────────────────────────────
  @Column({ name: 'posicao_ranking', type: 'integer', nullable: true })
  posicaoRanking: number;

  @Column({ name: 'total_motoristas_grupo', type: 'integer', nullable: true })
  totalMotoristasGrupo: number;

  @CreateDateColumn({ name: 'calculado_em', type: 'timestamptz' })
  calculadoEm: Date;

  // ── Relacionamento ────────────────────────────────────────
  @ManyToOne(() => Motorista, (m) => m.pontuacoes)
  @JoinColumn({ name: 'motorista_id' })
  motorista: Motorista;
}
