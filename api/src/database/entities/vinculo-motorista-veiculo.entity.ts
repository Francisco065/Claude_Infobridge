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
import { Motorista }    from './motorista.entity';
import { Veiculo }      from './veiculo.entity';

@Entity('vinculo_motorista_veiculo')
@Index(['tenantId', 'veiculoId', 'fim'])
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

  /** NULL = vínculo ativo. Fechar antes de criar um novo vínculo para o veículo. */
  @Column({ type: 'timestamptz', nullable: true })
  fim: Date;

  @Column({ type: 'enum', enum: FonteVinculo, default: FonteVinculo.MULTIPORTAL })
  fonte: FonteVinculo;

  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' })
  criadoEm: Date;

  @ManyToOne(() => Motorista, (m) => m.vinculos)
  @JoinColumn({ name: 'motorista_id' })
  motorista: Motorista;

  @ManyToOne(() => Veiculo, (v) => v.vinculos)
  @JoinColumn({ name: 'veiculo_id' })
  veiculo: Veiculo;
}
