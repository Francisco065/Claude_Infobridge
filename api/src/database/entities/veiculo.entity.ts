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
  Unique,
} from 'typeorm';
import { TipoDispositivo }          from './enums';
import { Tenant }                    from './tenant.entity';
import { VinculoMotoristaVeiculo }   from './vinculo-motorista-veiculo.entity';

@Entity('veiculos')
@Unique(['tenantId', 'idMultiportal'])
@Index(['tenantId'])
export class Veiculo {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /**
   * ID do veículo no sistema Multiportal (campo "id" do objeto Veiculo).
   * Usado nas chamadas da API como "veiculoid".
   */
  @Column({ name: 'id_multiportal', type: 'bigint' })
  idMultiportal: number;

  @Column({ length: 10, nullable: true })
  placa: string;

  @Column({ length: 100, nullable: true })
  marca: string;

  @Column({ length: 200, nullable: true })
  modelo: string;

  @Column({ name: 'ano_fabricacao', type: 'smallint', nullable: true })
  anoFabricacao: number;

  @Column({ length: 100, nullable: true })
  frota: string;

  /**
   * Tipo de monitoramento conforme retornado pela Multiportal.
   * Geralmente 'M' (Multiportal).
   */
  @Column({ name: 'tipo_monitoramento', length: 10, nullable: true })
  tipoMonitoramento: string;

  /**
   * Tipo de dispositivo rastreador inferido na primeira ingestão.
   * Lógica: se posição contém comp 9090 → CAN; comp 9182 → OBD2; caso contrário → GPS.
   * Importante para o motor dual-track saber quais fontes de dados esperar.
   */
  @Column({
    name: 'tipo_dispositivo',
    type: 'enum',
    enum: TipoDispositivo,
    default: TipoDispositivo.GPS,
  })
  tipoDispositivo: TipoDispositivo;

  /**
   * Consumo de referência (benchmark da frota) em km/L.
   * Usado para comparar com a média real do motorista.
   */
  @Column({
    name: 'consumo_referencia_kml',
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
  })
  consumoReferenciaKml: number;

  @Column({
    name: 'capacidade_tanque_l',
    type: 'numeric',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  capacidadeTanqueL: number;

  @Column({ default: true })
  ativo: boolean;

  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' })
  atualizadoEm: Date;

  // ── Relacionamentos ───────────────────────────────────────
  @ManyToOne(() => Tenant, (t) => t.veiculos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @OneToMany(() => VinculoMotoristaVeiculo, (v) => v.veiculo)
  vinculos: VinculoMotoristaVeiculo[];
}
