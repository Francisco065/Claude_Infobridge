import { Injectable, ConflictException, Logger, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In }   from 'typeorm';
import * as bcrypt          from 'bcrypt';
import { Usuario }          from '../../database/entities/usuario.entity';
import { Empresa }          from '../../database/entities/empresa.entity';
import { UsuarioPerfil }    from '../../database/entities/enums';
import { TenantAwareRepository } from '../../database/tenant-aware.repository';
import {
  UsuarioNaoEncontradoException,
  EmailJaCadastradoException,
} from '../../common/filters/http-exception.filter';
import { PaginacaoDto, RespostaPaginadaDto } from '../../common/dto/paginacao.dto';
import { CriarUsuarioDto, AtualizarUsuarioDto, RedefinirSenhaAdminDto } from './usuarios.dto';

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private repo(tenantId: string) {
    return new TenantAwareRepository(Usuario, this.db, tenantId);
  }

  async listar(tenantId: string, paginacao: PaginacaoDto): Promise<RespostaPaginadaDto<Omit<Usuario, 'senhaHash'>>> {
    const qb = this.repo(tenantId)
      .createQueryBuilder('u')
      .select(['u.id', 'u.nome', 'u.email', 'u.perfil', 'u.ativo', 'u.ultimoLogin', 'u.criadoEm', 'u.acessoTotal', 'u.telas', 'u.empresaId'])
      .orderBy('u.nome', 'ASC');

    if (paginacao.busca) {
      qb.andWhere('(u.nome ILIKE :b OR u.email ILIKE :b)', { b: `%${paginacao.busca}%` });
    }

    const [dados, total] = await qb.skip(paginacao.skip).take(paginacao.limite).getManyAndCount();

    // Anexa o nome fantasia da empresa vinculada (apenas visual na listagem).
    const empresaIds = [...new Set(dados.map((u) => u.empresaId).filter(Boolean))] as string[];
    if (empresaIds.length) {
      const empresas = await this.db.getRepository(Empresa).find({
        where: { tenantId, id: In(empresaIds) },
        select: ['id', 'nome', 'nomeFantasia'],
      });
      const mapa = new Map(empresas.map((e) => [e.id, e.nomeFantasia || e.nome]));
      for (const u of dados as any[]) {
        if (u.empresaId) u.empresaNomeFantasia = mapa.get(u.empresaId) ?? null;
      }
    }

    return RespostaPaginadaDto.de(dados, total, paginacao);
  }

  async buscarPorId(tenantId: string, id: string) {
    const usuario = await this.repo(tenantId).findById(id);
    if (!usuario) throw new UsuarioNaoEncontradoException(id);
    const { senhaHash, ...semSenha } = usuario;
    return semSenha;
  }

  /** Impede que um não-ADMIN crie/promova ADMIN ou conceda acesso total. */
  private _barrarEscalonamento(dto: { perfil?: UsuarioPerfil; acessoTotal?: boolean }, solicitantePerfil?: string) {
    if (solicitantePerfil === UsuarioPerfil.ADMIN) return;
    if (dto.perfil === UsuarioPerfil.ADMIN) {
      throw new ForbiddenException('Apenas um administrador pode atribuir o perfil de administrador.');
    }
    if (dto.acessoTotal === true) {
      throw new ForbiddenException('Apenas um administrador pode conceder acesso total.');
    }
  }

  async criar(tenantId: string, dto: CriarUsuarioDto, solicitantePerfil?: string) {
    this._barrarEscalonamento(dto, solicitantePerfil);
    const emailExiste = await this.db.getRepository(Usuario).findOne({ where: { email: dto.email.toLowerCase() } });
    if (emailExiste) throw new EmailJaCadastradoException(dto.email);

    const senhaHash = await bcrypt.hash(dto.senha, 12);
    const usuario = await this.repo(tenantId).save({
      nome: dto.nome, email: dto.email.toLowerCase(), senhaHash,
      perfil: dto.perfil ?? UsuarioPerfil.OPERADOR, ativo: true,
      acessoTotal: dto.acessoTotal ?? false,
      telas: dto.acessoTotal ? [] : (dto.telas ?? []),
      empresaId: dto.empresaId ?? null,
    });

    this.logger.log(`Usuário criado: ${usuario.email} [tenant: ${tenantId}]`);
    const { senhaHash: _, ...semSenha } = usuario;
    return semSenha;
  }

  async atualizar(tenantId: string, id: string, dto: AtualizarUsuarioDto, solicitanteId: string, solicitantePerfil?: string) {
    this._barrarEscalonamento(dto, solicitantePerfil);
    const usuario = await this.repo(tenantId).findById(id);
    if (!usuario) throw new UsuarioNaoEncontradoException(id);
    if (id === solicitanteId && dto.ativo === false) {
      throw new ForbiddenException('Você não pode desativar sua própria conta');
    }
    // Ninguém pode alterar o PRÓPRIO perfil ou acesso total (evita auto-promoção).
    if (id === solicitanteId && (dto.perfil !== undefined || dto.acessoTotal !== undefined)) {
      throw new ForbiddenException('Você não pode alterar o próprio perfil ou nível de acesso.');
    }

    // E-mail novo não pode colidir com outro usuário
    if (dto.email && dto.email.toLowerCase() !== usuario.email) {
      const existe = await this.db.getRepository(Usuario)
        .findOne({ where: { email: dto.email.toLowerCase() } });
      if (existe && existe.id !== id) throw new EmailJaCadastradoException(dto.email);
    }

    const acessoTotal = dto.acessoTotal ?? usuario.acessoTotal;
    await this.repo(tenantId).update(id, {
      nome: dto.nome ?? usuario.nome,
      email: dto.email ? dto.email.toLowerCase() : usuario.email,
      perfil: dto.perfil ?? usuario.perfil,
      ativo: dto.ativo ?? usuario.ativo,
      acessoTotal,
      telas: acessoTotal ? [] : (dto.telas ?? usuario.telas ?? []),
      empresaId: dto.empresaId !== undefined ? dto.empresaId : usuario.empresaId,
    });
    return this.buscarPorId(tenantId, id);
  }

  async redefinirSenha(tenantId: string, id: string, dto: RedefinirSenhaAdminDto) {
    const usuario = await this.repo(tenantId).findById(id);
    if (!usuario) throw new UsuarioNaoEncontradoException(id);
    const senhaHash = await bcrypt.hash(dto.novaSenha, 12);
    // Força a troca no próximo login — a senha definida pelo admin é provisória.
    await this.repo(tenantId).update(id, { senhaHash, precisaTrocarSenha: true } as any);
  }

  async desativar(tenantId: string, id: string, solicitanteId: string) {
    if (id === solicitanteId) throw new ForbiddenException('Você não pode desativar sua própria conta');
    const usuario = await this.repo(tenantId).findById(id);
    if (!usuario) throw new UsuarioNaoEncontradoException(id);
    await this.repo(tenantId).update(id, { ativo: false } as any);
  }
}
