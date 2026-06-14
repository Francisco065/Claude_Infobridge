import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/guards';
import { TenantId, UserId, Roles } from '../../common/decorators/decorators';
import { UsuarioPerfil }           from '../../database/entities/enums';
import { PaginacaoDto }            from '../../common/dto/paginacao.dto';
import { UsuariosService }         from './usuarios.service';
import { CriarUsuarioDto, AtualizarUsuarioDto, RedefinirSenhaAdminDto } from './usuarios.dto';

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
  redefinirSenha(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: RedefinirSenhaAdminDto) {
    return this.usuariosService.redefinirSenha(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UsuarioPerfil.ADMIN)
  @ApiOperation({ summary: '[Admin] Desativa um usuário (soft delete)' })
  desativar(@TenantId() tenantId: string, @Param('id') id: string, @UserId() solicitanteId: string) {
    return this.usuariosService.desativar(tenantId, id, solicitanteId);
  }
}
