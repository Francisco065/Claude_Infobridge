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
import { NotaGerada }              from './nota-gerada.entity';

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

  @OneToMany(() => NotaGerada, (n) => n.motorista)
  notas: NotaGerada[];
}


// ============================================================
// vinculo-motorista-veiculo.entity.ts
// ============================================================
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { FonteVinculo } from './enums';
import { Veiculo }      from './veiculo.entity';

@Entity('vinculo_motorista_veiculo')
@Index(['tenantId', 'veiculoId', 'fim'])   // busca de vínculo ativo
@Index(['tenantId', 'motoristaId'])
export class VinculoMotoristaVeiculo {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'motorista_id', type: 'uuid' })
  motoristaId: string;

  @Column({ name: 'veiculo_id', type: 'uuid' })
  veiculoId: string;

  @Column({ type: 'timestamptz' })
  inicio: Date;

  /**
   * NULL = vínculo ativo no momento.
   * Quando um novo motorista assume o veículo, setar fim=NOW() aqui
   * e criar um novo registro com inicio=NOW().
   */
  @Column({ type: 'timestamptz', nullable: true })
  fim: Date;

  @Column({
    type: 'enum',
    enum: FonteVinculo,
    default: FonteVinculo.MULTIPORTAL,
  })
  fonte: FonteVinculo;

  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' })
  criadoEm: Date;

  // ── Relacionamentos ───────────────────────────────────────
  @ManyToOne(() => Motorista, (m) => m.vinculos)
  @JoinColumn({ name: 'motorista_id' })
  motorista: Motorista;

  @ManyToOne(() => Veiculo, (v) => v.vinculos)
  @JoinColumn({ name: 'veiculo_id' })
  veiculo: Veiculo;
}
