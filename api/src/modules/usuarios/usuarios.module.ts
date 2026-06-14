// ── usuarios.dto.ts ───────────────────────────────────────────
import {
  IsString, IsEmail, IsEnum, IsOptional, IsBoolean,
  IsNotEmpty, MinLength, MaxLength, Matches, Length,
} from 'class-validator';
import { PartialType, OmitType, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UsuarioPerfil } from '../../database/entities/enums';

export class CriarUsuarioDto {
  @ApiProperty({ example: 'Maria Souza' })
  @IsString() @IsNotEmpty() @Length(2, 200)
  nome: string;

  @ApiProperty({ example: 'maria@empresa.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ enum: UsuarioPerfil, default: UsuarioPerfil.OPERADOR })
  @IsOptional() @IsEnum(UsuarioPerfil)
  perfil?: UsuarioPerfil;

  @ApiProperty({ description: 'Senha temporária — usuário deve trocar no 1º acesso' })
  @IsString()
  @MinLength(8) @MaxLength(50)
  @Matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/, {
    message: 'Senha deve conter maiúscula, número e caractere especial',
  })
  senha: string;
}

export class AtualizarUsuarioDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(2, 200)
  nome?: string;

  @ApiPropertyOptional({ enum: UsuarioPerfil })
  @IsOptional() @IsEnum(UsuarioPerfil)
  perfil?: UsuarioPerfil;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  ativo?: boolean;
}

export class RedefinirSenhaAdminDto {
  @ApiProperty({ description: 'Nova senha temporária definida pelo admin' })
  @IsString() @MinLength(8) @MaxLength(50)
  @Matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/, {
    message: 'Senha deve conter maiúscula, número e caractere especial',
  })
  novaSenha: string;
}


// ── usuarios.service.ts ───────────────────────────────────────
import { Injectable, ConflictException, Logger, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import * as bcrypt          from 'bcrypt';
import { Usuario }          from '../../database/entities/usuario.entity';
import { TenantAwareRepository } from '../../database/tenant-aware.repository';
import {
  UsuarioNaoEncontradoException,
  EmailJaCadastradoException,
} from '../../common/filters/http-exception.filter';
import { PaginacaoDto, RespostaPaginadaDto } from '../../common/dto/paginacao.dto';

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  private repo(tenantId: string) {
    return new TenantAwareRepository(Usuario, this.db, tenantId);
  }

  // ── Listar ────────────────────────────────────────────────

  async listar(
    tenantId: string,
    paginacao: PaginacaoDto,
  ): Promise<RespostaPaginadaDto<Omit<Usuario, 'senhaHash'>>> {
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

  // ── Buscar por ID ──────────────────────────────────────────

  async buscarPorId(tenantId: string, id: string) {
    const usuario = await this.repo(tenantId).findById(id);
    if (!usuario) throw new UsuarioNaoEncontradoException(id);
    const { senhaHash, ...semSenha } = usuario;
    return semSenha;
  }

  // ── Criar ─────────────────────────────────────────────────

  async criar(tenantId: string, dto: CriarUsuarioDto) {
    // Verificar e-mail único (globalmente — e-mail é chave de login)
    const emailExiste = await this.db
      .getRepository(Usuario)
      .findOne({ where: { email: dto.email.toLowerCase() } });

    if (emailExiste) throw new EmailJaCadastradoException(dto.email);

    const senhaHash = await bcrypt.hash(dto.senha, 12);
    const usuario = await this.repo(tenantId).save({
      nome:      dto.nome,
      email:     dto.email.toLowerCase(),
      senhaHash,
      perfil:    dto.perfil ?? UsuarioPerfil.OPERADOR,
      ativo:     true,
    });

    this.logger.log(`Usuário criado: ${usuario.email} [tenant: ${tenantId}]`);
    const { senhaHash: _, ...semSenha } = usuario;
    return semSenha;
  }

  // ── Atualizar ─────────────────────────────────────────────

  async atualizar(tenantId: string, id: string, dto: AtualizarUsuarioDto, solicitanteId: string) {
    const usuario = await this.repo(tenantId).findById(id);
    if (!usuario) throw new UsuarioNaoEncontradoException(id);

    // Um usuário não pode desativar a si mesmo
    if (id === solicitanteId && dto.ativo === false) {
      throw new ForbiddenException('Você não pode desativar sua própria conta');
    }

    await this.repo(tenantId).update(id, {
      nome:   dto.nome   ?? usuario.nome,
      perfil: dto.perfil ?? usuario.perfil,
      ativo:  dto.ativo  ?? usuario.ativo,
    });

    return this.buscarPorId(tenantId, id);
  }

  // ── Admin redefine senha de outro usuário ─────────────────

  async redefinirSenha(tenantId: string, id: string, dto: RedefinirSenhaAdminDto) {
    const usuario = await this.repo(tenantId).findById(id);
    if (!usuario) throw new UsuarioNaoEncontradoException(id);

    const senhaHash = await bcrypt.hash(dto.novaSenha, 12);
    await this.repo(tenantId).update(id, { senhaHash } as any);
    this.logger.log(`Senha redefinida pelo admin: userId=${id} [tenant: ${tenantId}]`);
  }

  // ── Desativar (soft delete) ───────────────────────────────

  async desativar(tenantId: string, id: string, solicitanteId: string) {
    if (id === solicitanteId) {
      throw new ForbiddenException('Você não pode desativar sua própria conta');
    }
    const usuario = await this.repo(tenantId).findById(id);
    if (!usuario) throw new UsuarioNaoEncontradoException(id);
    await this.repo(tenantId).update(id, { ativo: false } as any);
    this.logger.log(`Usuário desativado: ${id} [tenant: ${tenantId}]`);
  }
}


// ── usuarios.controller.ts ────────────────────────────────────
import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/guards';
import { TenantId, UserId, CurrentUser, Roles } from '../../common/decorators/decorators';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';

@ApiTags('Usuários')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Get()
  @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
  @ApiOperation({ summary: 'Lista usuários do tenant autenticado' })
  listar(@TenantId() tenantId: string, @Query() paginacao: PaginacaoDto) {
    return this.usuariosService.listar(tenantId, paginacao);
  }

  @Get(':id')
  @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
  @ApiOperation({ summary: 'Detalhe de um usuário' })
  buscar(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.usuariosService.buscarPorId(tenantId, id);
  }

  @Post()
  @Roles(UsuarioPerfil.ADMIN)
  @ApiOperation({ summary: '[Admin] Cria um novo usuário no tenant' })
  criar(@TenantId() tenantId: string, @Body() dto: CriarUsuarioDto) {
    return this.usuariosService.criar(tenantId, dto);
  }

  @Patch(':id')
  @Roles(UsuarioPerfil.ADMIN)
  @ApiOperation({ summary: '[Admin] Atualiza nome, perfil ou status do usuário' })
  atualizar(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: AtualizarUsuarioDto,
    @UserId() solicitanteId: string,
  ) {
    return this.usuariosService.atualizar(tenantId, id, dto, solicitanteId);
  }

  @Patch(':id/redefinir-senha')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UsuarioPerfil.ADMIN)
  @ApiOperation({ summary: '[Admin] Redefine a senha de outro usuário' })
  redefinirSenha(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: RedefinirSenhaAdminDto,
  ) {
    return this.usuariosService.redefinirSenha(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UsuarioPerfil.ADMIN)
  @ApiOperation({ summary: '[Admin] Desativa um usuário (soft delete)' })
  desativar(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @UserId() solicitanteId: string,
  ) {
    return this.usuariosService.desativar(tenantId, id, solicitanteId);
  }
}


// ── usuarios.module.ts ────────────────────────────────────────
import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Usuario }       from '../../database/entities/usuario.entity';

@Module({
  imports:     [TypeOrmModule.forFeature([Usuario])],
  controllers: [UsuariosController],
  providers:   [UsuariosService],
  exports:     [UsuariosService],
})
export class UsuariosModule {}
