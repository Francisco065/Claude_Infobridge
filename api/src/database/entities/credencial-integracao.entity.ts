import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Tenant }  from './tenant.entity';

@Entity('credencial_integracao')
export class CredencialIntegracao {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid', unique: true })
  tenantId: string;

  @Column({ length: 200 })
  username: string;

  /**
   * Senha da Multiportal criptografada com AES-256 (Fernet) pela camada Python.
   * Nunca exposta em respostas da API — @Exclude() garante isso.
   */
  @Exclude()
  @Column({ name: 'password_enc', type: 'text' })
  passwordEnc: string;

  @Column({ type: 'integer' })
  appid: number;

  /**
   * Token da sessão Multiportal (gerenciado pelo worker via Redis).
   * Persistido como backup caso o Redis seja reiniciado.
   */
  @Exclude()
  @Column({ name: 'token_cache', type: 'text', nullable: true })
  tokenCache: string;

  /**
   * Unix timestamp (ms) de expiração do token atual.
   * Equivale ao campo "expiration" do objeto Handshake da Multiportal.
   */
  @Column({ name: 'token_expiracao', type: 'bigint', nullable: true })
  tokenExpiracao: number;

  @Column({ default: true })
  ativo: boolean;

  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' })
  criadoEm: Date;

  // ── Relacionamento ────────────────────────────────────────
  @OneToOne(() => Tenant, (t) => t.credencial, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
