import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import * as bcrypt          from 'bcrypt';
import { Tenant }                 from '../../database/entities/tenant.entity';
import { Usuario }                from '../../database/entities/usuario.entity';
import { CredencialIntegracao }   from '../../database/entities/credencial-integracao.entity';
import { UsuarioPerfil, TenantPlano } from '../../database/entities/enums';
import { TenantNaoEncontradoException } from '../../common/filters/http-exception.filter';
import { PaginacaoDto, RespostaPaginadaDto } from '../../common/dto/paginacao.dto';
import { CriarTenantDto, AtualizarTenantDto, ConfigurarCredencialDto } from './tenants.dto';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async listar(paginacao: PaginacaoDto): Promise<RespostaPaginadaDto<Tenant>> {
    const repo = this.db.getRepository(Tenant);
    const qb   = repo.createQueryBuilder('t').orderBy('t.criadoEm', 'DESC');

    if (paginacao.busca) {
      qb.where('t.nome ILIKE :busca OR t.cnpj LIKE :cnpj', {
        busca: `%${paginacao.busca}%`, cnpj: `%${paginacao.busca}%`,
      });
    }

    const [dados, total] = await qb.skip(paginacao.skip).take(paginacao.limite).getManyAndCount();
    return RespostaPaginadaDto.de(dados, total, paginacao);
  }

  async buscarPorId(id: string): Promise<Tenant> {
    const tenant = await this.db.getRepository(Tenant).findOne({ where: { id }, relations: ['credencial'] });
    if (!tenant) throw new TenantNaoEncontradoException(id);
    return tenant;
  }

  async criar(dto: CriarTenantDto): Promise<Tenant> {
    return this.db.transaction(async (manager) => {
      if (dto.cnpj) {
        const existe = await manager.findOne(Tenant, { where: { cnpj: dto.cnpj } });
        if (existe) throw new ConflictException(`CNPJ '${dto.cnpj}' já cadastrado`);
      }

      const tenant = manager.create(Tenant, {
        nome: dto.nome, cnpj: dto.cnpj, plano: dto.plano ?? TenantPlano.STARTER, ativo: true,
      });
      await manager.save(tenant);

      const senhaHash = await bcrypt.hash(dto.adminSenha, 12);
      const admin = manager.create(Usuario, {
        tenantId: tenant.id, nome: dto.adminNome, email: dto.adminEmail.toLowerCase(),
        senhaHash, perfil: UsuarioPerfil.ADMIN, ativo: true,
      });
      await manager.save(admin);

      if (dto.multiportalUsername && dto.multiportalPassword && dto.multiportalAppid) {
        const passwordEnc = this._encryptarSenha(dto.multiportalPassword);
        const credencial = manager.create(CredencialIntegracao, {
          tenantId: tenant.id, username: dto.multiportalUsername, passwordEnc, appid: dto.multiportalAppid, ativo: true,
        });
        await manager.save(credencial);
      }

      this.logger.log(`Tenant criado: ${tenant.nome} [${tenant.id}]`);
      return tenant;
    });
  }

  async atualizar(id: string, dto: AtualizarTenantDto): Promise<Tenant> {
    const tenant = await this.buscarPorId(id);
    Object.assign(tenant, { nome: dto.nome ?? tenant.nome, plano: dto.plano ?? tenant.plano });
    return this.db.getRepository(Tenant).save(tenant);
  }

  async alterarStatus(id: string, ativo: boolean): Promise<void> {
    await this.buscarPorId(id);
    await this.db.getRepository(Tenant).update(id, { ativo });
  }

  async configurarCredencial(tenantId: string, dto: ConfigurarCredencialDto): Promise<void> {
    await this.buscarPorId(tenantId);
    const passwordEnc = this._encryptarSenha(dto.password);
    const repo = this.db.getRepository(CredencialIntegracao);
    const existente = await repo.findOne({ where: { tenantId } });

    if (existente) {
      await repo.update(existente.id, {
        username: dto.username, passwordEnc, appid: dto.appid,
        tokenCache: null, tokenExpiracao: null,
      });
    } else {
      await repo.save(repo.create({ tenantId, username: dto.username, passwordEnc, appid: dto.appid }));
    }
  }

  private _encryptarSenha(senha: string): string {
    return Buffer.from(senha).toString('base64');
  }
}
