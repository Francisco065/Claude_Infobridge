import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Exclude }        from 'class-transformer';
import { UsuarioPerfil }  from './enums';
import { Tenant }         from './tenant.entity';

@Entity('usuarios')
@Index(['tenantId'])
export class Usuario {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Coluna FK armazenada na tabela (tenant_id)
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ length: 200 })
  nome: string;

  @Column({ length: 255, unique: true })
  email: string;

  /**
   * Hash da senha (bcrypt/argon2).
   * @Exclude() impede que o hash vaze em respostas JSON via class-transformer.
   */
  @Exclude()
  @Column({ name: 'senha_hash', type: 'text' })
  senhaHash: string;

  @Column({
    type: 'enum',
    enum: UsuarioPerfil,
    default: UsuarioPerfil.OPERADOR,
  })
  perfil: UsuarioPerfil;

  /** Acesso geral: enxerga todas as telas (atuais e futuras). */
  @Column({ name: 'acesso_total', default: false })
  acessoTotal: boolean;

  /** Telas liberadas quando acessoTotal=false (chaves: info-analise, mapa-ao-vivo, cadastros, usuarios). */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  telas: string[];

  @Column({ default: true })
  ativo: boolean;

  @Column({ name: 'ultimo_login', type: 'timestamptz', nullable: true })
  ultimoLogin: Date;

  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' })
  criadoEm: Date;

  // ── Relacionamento ────────────────────────────────────────
  @ManyToOne(() => Tenant, (t) => t.usuarios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
