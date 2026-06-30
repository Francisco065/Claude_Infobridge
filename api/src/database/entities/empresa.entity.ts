// ============================================================
// empresa.entity.ts — Cliente final cadastrado pela equipe Infobridge
// ============================================================
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { EmpresaTipo } from './enums';
import { Tenant }      from './tenant.entity';
import { Veiculo }     from './veiculo.entity';
import { Motorista }   from './motorista.entity';

/** Responsável (contato) de uma empresa. Armazenado como item de array jsonb. */
export interface ResponsavelEmpresa {
  nome: string;
  email?: string;
  telefone?: string;
}

@Entity('empresas')
@Index(['tenantId'])
export class Empresa {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ length: 14, nullable: true })
  cnpj: string;

  /** Razão social / nome do cliente. */
  @Column({ length: 200 })
  nome: string;

  @Column({ name: 'nome_fantasia', length: 200, nullable: true })
  nomeFantasia: string;

  /** Endereço (legado / livre). Mantido para compatibilidade. */
  @Column({ type: 'text', nullable: true })
  endereco: string;

  // ── Endereço segregado ────────────────────────────────────
  @Column({ length: 8, nullable: true })
  cep: string;

  @Column({ length: 200, nullable: true })
  logradouro: string;

  @Column({ length: 20, nullable: true })
  numero: string;

  @Column({ length: 120, nullable: true })
  bairro: string;

  @Column({ length: 120, nullable: true })
  cidade: string;

  @Column({ length: 2, nullable: true })
  uf: string;

  @Column({ name: 'representante_comercial', length: 200, nullable: true })
  representanteComercial: string;

  @Column({
    type: 'enum',
    enum: EmpresaTipo,
    default: EmpresaTipo.OUTROS,
  })
  tipo: EmpresaTipo;

  /** Lista de responsáveis: [{ nome, email, telefone }]. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  responsaveis: ResponsavelEmpresa[];

  @Column({ default: true })
  ativo: boolean;

  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' })
  atualizadoEm: Date;

  // ── Relacionamentos ───────────────────────────────────────
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @OneToMany(() => Veiculo, (v) => v.empresa)
  veiculos: Veiculo[];

  @OneToMany(() => Motorista, (m) => m.empresa)
  motoristas: Motorista[];
}
