import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource }   from '@nestjs/typeorm';
import { DataSource }         from 'typeorm';
import { Veiculo }            from '../../database/entities/veiculo.entity';
import { TenantAwareRepository }        from '../../database/tenant-aware.repository';
import { VeiculoNaoEncontradoException } from '../../common/filters/http-exception.filter';
import { RespostaPaginadaDto }          from '../../common/dto/paginacao.dto';
import { AtualizarVeiculoDto, FiltroVeiculoDto } from './veiculos.dto';

@Injectable()
export class VeiculosService {
  private readonly logger = new Logger(VeiculosService.name);

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private repo(tenantId: string) {
    return new TenantAwareRepository(Veiculo, this.db, tenantId);
  }

  async listar(tenantId: string, filtro: FiltroVeiculoDto) {
    const paginacao = { pagina: filtro.pagina ?? 1, limite: filtro.limite ?? 20, skip: filtro.skip };
    const qb = this.repo(tenantId)
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.vinculos', 'vmv', 'vmv.fim IS NULL')
      .leftJoinAndSelect('vmv.motorista', 'm')
      .where('v.ativo = true')
      .orderBy('v.placa', 'ASC');

    if (filtro.busca) {
      qb.andWhere('(v.placa ILIKE :b OR v.modelo ILIKE :b OR v.frota ILIKE :b)', { b: `%${filtro.busca}%` });
    }
    if (filtro.tipoDispositivo) {
      qb.andWhere('v.tipo_dispositivo = :td', { td: filtro.tipoDispositivo });
    }

    const [dados, total] = await qb.skip(paginacao.skip).take(paginacao.limite).getManyAndCount();
    return RespostaPaginadaDto.de(dados, total, paginacao as any);
  }

  async buscarPorId(tenantId: string, id: string) {
    const veiculo = await this.repo(tenantId)
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.vinculos', 'vmv', 'vmv.fim IS NULL')
      .leftJoinAndSelect('vmv.motorista', 'm')
      .andWhere('v.id = :id', { id })
      .getOne();

    if (!veiculo) throw new VeiculoNaoEncontradoException(id);
    return veiculo;
  }

  async atualizar(tenantId: string, id: string, dto: AtualizarVeiculoDto) {
    const veiculo = await this.repo(tenantId).findById(id);
    if (!veiculo) throw new VeiculoNaoEncontradoException(id);

    await this.repo(tenantId).update(id, {
      placa:               dto.placa               ?? veiculo.placa,
      consumoReferenciaKml: dto.consumoReferenciaKml ?? veiculo.consumoReferenciaKml,
      capacidadeTanqueL:   dto.capacidadeTanqueL   ?? veiculo.capacidadeTanqueL,
      tipoDispositivo:     dto.tipoDispositivo      ?? veiculo.tipoDispositivo,
    });

    return this.buscarPorId(tenantId, id);
  }

  async sincronizarDaMultiportal(tenantId: string, veiculosMultiportal: any[]) {
    let novos = 0, atualizados = 0;
    const repo = this.db.getRepository(Veiculo);

    for (const v of veiculosMultiportal) {
      const existente = await repo.findOne({ where: { tenantId, idMultiportal: v.id } });
      const dados = {
        tenantId, idMultiportal: v.id, placa: v.placa ?? undefined,
        marca: v.marca ?? undefined, modelo: v.modelo ?? undefined,
        frota: v.frota ?? undefined, tipoMonitoramento: v.tipoMonitoramento ?? undefined, ativo: true,
      };
      if (existente) { await repo.update(existente.id, dados); atualizados++; }
      else { await repo.save(repo.create(dados)); novos++; }
    }

    return { novos, atualizados };
  }
}
