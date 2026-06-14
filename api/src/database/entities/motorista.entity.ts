// ============================================================
// motorista.entity.ts
// ============================================================
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Tenant }                  from './tenant.entity';
import { VinculoMotoristaVeiculo } from './vinculo-motorista-veiculo.entity';
import { IndicadorPeriodo }        from './indicador-periodo.entity';
import { PontuacaoPeriodo }        from './pontuacao-periodo.entity';

@Entity('motoristas')
@Unique(['tenantId', 'idMultiportal'])
@Index(['tenantId'])
export class Motorista {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /**
   * ID do motorista no sistema Multiportal.
   * Nullable pois motoristas podem ser cadastrados manualmente.
   */
  @Column({ name: 'id_multiportal', type: 'bigint', nullable: true })
  idMultiportal: number;

  @Column({ length: 200 })
  nome: string;

  @Column({ length: 11, nullable: true, unique: true })
  cpf: string;

  @Column({ length: 20, nullable: true })
  cnh: string;

  @Column({ name: 'categoria_cnh', length: 5, nullable: true })
  categoriaCnh: string;

  @Column({ default: true })
  ativo: boolean;

  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' })
  criadoEm: Date;

  // ── Relacionamentos ───────────────────────────────────────
  @ManyToOne(() => Tenant, (t) => t.motoristas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @OneToMany(() => VinculoMotoristaVeiculo, (v) => v.motorista)
  vinculos: VinculoMotoristaVeiculo[];

  @OneToMany(() => IndicadorPeriodo, (i) => i.motorista)
  indicadores: IndicadorPeriodo[];

  @OneToMany(() => PontuacaoPeriodo, (p) => p.motorista)
  pontuacoes: PontuacaoPeriodo[];

}
