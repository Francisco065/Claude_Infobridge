import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { TenantPlano }             from './enums';
import { Usuario }                  from './usuario.entity';
import { CredencialIntegracao }     from './credencial-integracao.entity';
import { Veiculo }                  from './veiculo.entity';
import { Motorista }                from './motorista.entity';

@Entity('tenants')
export class Tenant {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  nome: string;

  @Column({ length: 14, nullable: true, unique: true })
  cnpj: string;

  @Column({
    type: 'enum',
    enum: TenantPlano,
    default: TenantPlano.STARTER,
  })
  plano: TenantPlano;

  @Column({ default: true })
  ativo: boolean;

  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' })
  atualizadoEm: Date;

  // ── Relacionamentos ───────────────────────────────────────
  @OneToMany(() => Usuario, (u) => u.tenant)
  usuarios: Usuario[];

  @OneToOne(() => CredencialIntegracao, (c) => c.tenant)
  credencial: CredencialIntegracao;

  @OneToMany(() => Veiculo, (v) => v.tenant)
  veiculos: Veiculo[];

  @OneToMany(() => Motorista, (m) => m.tenant)
  motoristas: Motorista[];
}
