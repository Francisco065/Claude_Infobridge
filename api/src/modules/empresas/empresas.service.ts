import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In }   from 'typeorm';
import { Empresa }          from '../../database/entities/empresa.entity';
import { Veiculo }          from '../../database/entities/veiculo.entity';
import { EmpresaTipo }      from '../../database/entities/enums';
import { TenantAwareRepository } from '../../database/tenant-aware.repository';
import { CriarEmpresaDto, AtualizarEmpresaDto } from './empresas.dto';

@Injectable()
export class EmpresasService {
  private readonly logger = new Logger(EmpresasService.name);

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private repo(tenantId: string) {
    return new TenantAwareRepository(Empresa, this.db, tenantId);
  }

  async listar(tenantId: string, busca?: string) {
    const qb = this.repo(tenantId)
      .createQueryBuilder('e')
      .loadRelationCountAndMap('e.totalVeiculos', 'e.veiculos')
      .loadRelationCountAndMap('e.totalMotoristas', 'e.motoristas')
      .orderBy('e.nome', 'ASC');

    if (busca) {
      qb.andWhere('(e.nome ILIKE :b OR e.nome_fantasia ILIKE :b OR e.cnpj ILIKE :b)', { b: `%${busca}%` });
    }

    return qb.getMany();
  }

  async buscarPorId(tenantId: string, id: string) {
    const empresa = await this.repo(tenantId)
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.veiculos', 'v')
      .andWhere('e.id = :id', { id })
      .getOne();
    if (!empresa) throw new NotFoundException(`Empresa ${id} não encontrada`);
    return empresa;
  }

  async criar(tenantId: string, dto: CriarEmpresaDto) {
    if (dto.cnpj) {
      const existe = await this.db.getRepository(Empresa).findOne({ where: { tenantId, cnpj: dto.cnpj } });
      if (existe) throw new ConflictException(`CNPJ '${dto.cnpj}' já cadastrado`);
    }

    const empresa = await this.repo(tenantId).save({
      cnpj:                   dto.cnpj,
      nome:                   dto.nome,
      nomeFantasia:           dto.nomeFantasia,
      endereco:               dto.endereco,
      cep:                    dto.cep,
      logradouro:             dto.logradouro,
      numero:                 dto.numero,
      bairro:                 dto.bairro,
      cidade:                 dto.cidade,
      uf:                     dto.uf?.toUpperCase(),
      representanteComercial: dto.representanteComercial,
      tipo:                   dto.tipo ?? EmpresaTipo.OUTROS,
      responsaveis:           dto.responsaveis ?? [],
      ativo:                  true,
    });

    if (dto.veiculoIds) await this.sincronizarVeiculos(tenantId, empresa.id, dto.veiculoIds);

    this.logger.log(`Empresa criada: ${empresa.nome} [tenant: ${tenantId}]`);
    return this.buscarPorId(tenantId, empresa.id);
  }

  async atualizar(tenantId: string, id: string, dto: AtualizarEmpresaDto) {
    const empresa = await this.repo(tenantId).findById(id);
    if (!empresa) throw new NotFoundException(`Empresa ${id} não encontrada`);

    // CNPJ é imutável após o cadastro — não é alterado na edição.
    await this.repo(tenantId).update(id, {
      nome:                   dto.nome ?? empresa.nome,
      nomeFantasia:           dto.nomeFantasia ?? empresa.nomeFantasia,
      endereco:               dto.endereco ?? empresa.endereco,
      cep:                    dto.cep ?? empresa.cep,
      logradouro:             dto.logradouro ?? empresa.logradouro,
      numero:                 dto.numero ?? empresa.numero,
      bairro:                 dto.bairro ?? empresa.bairro,
      cidade:                 dto.cidade ?? empresa.cidade,
      uf:                     dto.uf ? dto.uf.toUpperCase() : empresa.uf,
      representanteComercial: dto.representanteComercial ?? empresa.representanteComercial,
      tipo:                   dto.tipo ?? empresa.tipo,
      responsaveis:           dto.responsaveis ?? empresa.responsaveis,
      ativo:                  dto.ativo ?? empresa.ativo,
    });

    if (dto.veiculoIds) await this.sincronizarVeiculos(tenantId, id, dto.veiculoIds);

    return this.buscarPorId(tenantId, id);
  }

  async desativar(tenantId: string, id: string) {
    const empresa = await this.repo(tenantId).findById(id);
    if (!empresa) throw new NotFoundException(`Empresa ${id} não encontrada`);
    await this.repo(tenantId).update(id, { ativo: false } as any);
  }

  /**
   * Define exatamente quais veículos pertencem à empresa: vincula os informados
   * e desvincula (empresa_id = NULL) os que antes eram da empresa e saíram da lista.
   */
  private async sincronizarVeiculos(tenantId: string, empresaId: string, veiculoIds: string[]) {
    // Atômico: se o 2º UPDATE falhar, o 1º (desvínculo) é revertido — senão os
    // veículos ficariam "órfãos" (sem empresa) por uma falha parcial.
    await this.db.transaction(async (manager) => {
      await manager.createQueryBuilder()
        .update(Veiculo)
        .set({ empresaId: null as any })
        .where('tenant_id = :tenantId AND empresa_id = :empresaId', { tenantId, empresaId })
        .andWhere(veiculoIds.length ? 'id NOT IN (:...ids)' : '1=1', veiculoIds.length ? { ids: veiculoIds } : {})
        .execute();

      if (veiculoIds.length) {
        await manager.createQueryBuilder()
          .update(Veiculo)
          .set({ empresaId })
          .where('tenant_id = :tenantId AND id IN (:...ids)', { tenantId, ids: veiculoIds })
          .execute();
      }
    });
  }
}
