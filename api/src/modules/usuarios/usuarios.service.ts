import { Injectable, ConflictException, Logger, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import * as bcrypt          from 'bcrypt';
import { Usuario }          from '../../database/entities/usuario.entity';
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
      .select(['u.id', 'u.nome', 'u.email', 'u.perfil', 'u.ativo', 'u.ultimoLogin', 'u.criadoEm'])
      .orderBy('u.nome', 'ASC');

    if (paginacao.busca) {
      qb.andWhere('(u.nome ILIKE :b OR u.email ILIKE :b)', { b: `%${paginacao.busca}%` });
    }

    const [dados, total] = await qb.skip(paginacao.skip).take(paginacao.limite).getManyAndCount();
    return RespostaPaginadaDto.de(dados, total, paginacao);
  }

  async buscarPorId(tenantId: string, id: string) {
    const usuario = await this.repo(tenantId).findById(id);
    if (!usuario) throw new UsuarioNaoEncontradoException(id);
    const { senhaHash, ...semSenha } = usuario;
    return semSenha;
  }

  async criar(tenantId: string, dto: CriarUsuarioDto) {
    const emailExiste = await this.db.getRepository(Usuario).findOne({ where: { email: dto.email.toLowerCase() } });
    if (emailExiste) throw new EmailJaCadastradoException(dto.email);

    const senhaHash = await bcrypt.hash(dto.senha, 12);
    const usuario = await this.repo(tenantId).save({
      nome: dto.nome, email: dto.email.toLowerCase(), senhaHash,
      perfil: dto.perfil ?? UsuarioPerfil.OPERADOR, ativo: true,
    });

    this.logger.log(`Usuário criado: ${usuario.email} [tenant: ${tenantId}]`);
    const { senhaHash: _, ...semSenha } = usuario;
    return semSenha;
  }

  async atualizar(tenantId: string, id: string, dto: AtualizarUsuarioDto, solicitanteId: string) {
    const usuario = await this.repo(tenantId).findById(id);
    if (!usuario) throw new UsuarioNaoEncontradoException(id);
    if (id === solicitanteId && dto.ativo === false) {
      throw new ForbiddenException('Você não pode desativar sua própria conta');
    }
    await this.repo(tenantId).update(id, {
      nome: dto.nome ?? usuario.nome, perfil: dto.perfil ?? usuario.perfil, ativo: dto.ativo ?? usuario.ativo,
    });
    return this.buscarPorId(tenantId, id);
  }

  async redefinirSenha(tenantId: string, id: string, dto: RedefinirSenhaAdminDto) {
    const usuario = await this.repo(tenantId).findById(id);
    if (!usuario) throw new UsuarioNaoEncontradoException(id);
    const senhaHash = await bcrypt.hash(dto.novaSenha, 12);
    await this.repo(tenantId).update(id, { senhaHash } as any);
  }

  async desativar(tenantId: string, id: string, solicitanteId: string) {
    if (id === solicitanteId) throw new ForbiddenException('Você não pode desativar sua própria conta');
    const usuario = await this.repo(tenantId).findById(id);
    if (!usuario) throw new UsuarioNaoEncontradoException(id);
    await this.repo(tenantId).update(id, { ativo: false } as any);
  }
}
