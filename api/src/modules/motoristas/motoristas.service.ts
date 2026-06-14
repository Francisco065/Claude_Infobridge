import { Injectable, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import { Motorista }        from '../../database/entities/motorista.entity';
import { Veiculo }          from '../../database/entities/veiculo.entity';
import { VinculoMotoristaVeiculo } from '../../database/entities/vinculo-motorista-veiculo.entity';
import { TenantAwareRepository }   from '../../database/tenant-aware.repository';
import {
  MotoristaNaoEncontradoException,
  VeiculoNaoEncontradoException,
} from '../../common/filters/http-exception.filter';
import { RespostaPaginadaDto } from '../../common/dto/paginacao.dto';
import { FonteVinculo }        from '../../database/entities/enums';
import {
  CriarMotoristaDto, AtualizarMotoristaDto,
  VincularVeiculoDto, FiltroMotoristaDto,
} from './motoristas.dto';

@Injectable()
export class MotoristasService {
  private readonly logger = new Logger(MotoristasService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  private repo(tenantId: string) {
    return new TenantAwareRepository(Motorista, this.db, tenantId);
  }

  async listar(tenantId: string, filtro: FiltroMotoristaDto) {
    const paginacao = { pagina: filtro.pagina ?? 1, limite: filtro.limite ?? 20, skip: filtro.skip };
    const qb = this.repo(tenantId)
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.vinculos', 'vmv', 'vmv.fim IS NULL')
      .leftJoinAndSelect('vmv.veiculo', 'v')
      .where('m.ativo = true')
      .orderBy('m.nome', 'ASC');

    if (filtro.busca) {
      qb.andWhere('(m.nome ILIKE :b OR m.cpf LIKE :b)', { b: `%${filtro.busca}%` });
    }

    const [dados, total] = await qb.skip(paginacao.skip).take(paginacao.limite).getManyAndCount();
    return RespostaPaginadaDto.de(dados, total, paginacao as any);
  }

  async buscarPorId(tenantId: string, id: string) {
    const motorista = await this.repo(tenantId)
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.vinculos', 'vmv')
      .leftJoinAndSelect('vmv.veiculo', 'v')
      .andWhere('m.id = :id', { id })
      .orderBy('vmv.inicio', 'DESC')
      .getOne();

    if (!motorista) throw new MotoristaNaoEncontradoException(id);
    return motorista;
  }

  async criar(tenantId: string, dto: CriarMotoristaDto) {
    if (dto.cpf) {
      const cpfExiste = await this.db
        .getRepository(Motorista)
        .findOne({ where: { cpf: dto.cpf, tenantId } });
      if (cpfExiste) throw new ConflictException(`CPF '${dto.cpf}' já cadastrado no tenant`);
    }

    const motorista = await this.repo(tenantId).save({
      nome:        dto.nome,
      cpf:         dto.cpf,
      cnh:         dto.cnh,
      categoriaCnh: dto.categoriaCnh,
      ativo:       true,
    });

    this.logger.log(`Motorista criado: ${motorista.nome} [tenant: ${tenantId}]`);
    return motorista;
  }

  async atualizar(tenantId: string, id: string, dto: AtualizarMotoristaDto) {
    const motorista = await this.repo(tenantId).findById(id);
    if (!motorista) throw new MotoristaNaoEncontradoException(id);
    await this.repo(tenantId).update(id, dto as any);
    return this.buscarPorId(tenantId, id);
  }

  async vincularVeiculo(tenantId: string, motoristaId: string, dto: VincularVeiculoDto) {
    const motorista = await this.repo(tenantId).findById(motoristaId);
    if (!motorista) throw new MotoristaNaoEncontradoException(motoristaId);

    const veiculoRepo = new TenantAwareRepository(Veiculo, this.db, tenantId);
    const veiculo = await veiculoRepo.findById(dto.veiculoId);
    if (!veiculo) throw new VeiculoNaoEncontradoException(dto.veiculoId);

    const inicio = dto.inicio ? new Date(dto.inicio) : new Date();

    return this.db.transaction(async (manager) => {
      await manager.createQueryBuilder()
        .update(VinculoMotoristaVeiculo)
        .set({ fim: inicio })
        .where('tenant_id = :tenantId AND motorista_id = :motoristaId AND fim IS NULL', { tenantId, motoristaId })
        .execute();

      await manager.createQueryBuilder()
        .update(VinculoMotoristaVeiculo)
        .set({ fim: inicio })
        .where('tenant_id = :tenantId AND veiculo_id = :veiculoId AND fim IS NULL', { tenantId, veiculoId: dto.veiculoId })
        .execute();

      const vinculo = manager.create(VinculoMotoristaVeiculo, {
        tenantId, motoristaId, veiculoId: dto.veiculoId, inicio, fim: null, fonte: FonteVinculo.MANUAL,
      });
      await manager.save(vinculo);
      return vinculo;
    });
  }

  async desvincularVeiculo(tenantId: string, motoristaId: string) {
    const motorista = await this.repo(tenantId).findById(motoristaId);
    if (!motorista) throw new MotoristaNaoEncontradoException(motoristaId);

    const agora = new Date();
    const resultado = await this.db.createQueryBuilder()
      .update(VinculoMotoristaVeiculo)
      .set({ fim: agora })
      .where('tenant_id = :tenantId AND motorista_id = :motoristaId AND fim IS NULL', { tenantId, motoristaId })
      .execute();

    if (resultado.affected === 0) {
      throw new BadRequestException('Motorista não possui vínculo ativo com nenhum veículo');
    }
  }

  async historico(tenantId: string, motoristaId: string) {
    const motorista = await this.repo(tenantId).findById(motoristaId);
    if (!motorista) throw new MotoristaNaoEncontradoException(motoristaId);

    return this.db.getRepository(VinculoMotoristaVeiculo)
      .createQueryBuilder('vmv')
      .leftJoinAndSelect('vmv.veiculo', 'v')
      .where('vmv.tenant_id = :tenantId AND vmv.motorista_id = :motoristaId', { tenantId, motoristaId })
      .orderBy('vmv.inicio', 'DESC')
      .getMany();
  }

  async sincronizarDaMultiportal(tenantId: string, motoristasMultiportal: any[]) {
    let novos = 0, atualizados = 0;
    const repo = this.db.getRepository(Motorista);

    for (const m of motoristasMultiportal) {
      const existente = await repo.findOne({ where: { tenantId, idMultiportal: m.id } });
      const dados = { tenantId, idMultiportal: m.id, nome: m.nome ?? m.name ?? 'Sem nome', cpf: m.cpf ?? undefined, ativo: true };
      if (existente) { await repo.update(existente.id, dados); atualizados++; }
      else { await repo.save(repo.create(dados)); novos++; }
    }

    return { novos, atualizados };
  }
}
