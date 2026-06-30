import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/guards';
import { TenantId, Roles }          from '../../common/decorators/decorators';
import { UsuarioPerfil }            from '../../database/entities/enums';
import { EmpresasService }          from './empresas.service';
import { CriarEmpresaDto, AtualizarEmpresaDto } from './empresas.dto';

@ApiTags('Empresas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UsuarioPerfil.ADMIN)
@Controller('empresas')
export class EmpresasController {
  constructor(private readonly empresasService: EmpresasService) {}

  @Get()
  @ApiOperation({ summary: '[Admin] Lista empresas (clientes) do tenant' })
  listar(@TenantId() tenantId: string, @Query('busca') busca?: string) {
    return this.empresasService.listar(tenantId, busca);
  }

  @Get(':id')
  @ApiOperation({ summary: '[Admin] Detalhe de uma empresa com veículos vinculados' })
  buscar(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.empresasService.buscarPorId(tenantId, id);
  }

  @Post()
  @ApiOperation({ summary: '[Admin] Cadastra uma nova empresa (cliente)' })
  criar(@TenantId() tenantId: string, @Body() dto: CriarEmpresaDto) {
    return this.empresasService.criar(tenantId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '[Admin] Atualiza dados da empresa e veículos vinculados' })
  atualizar(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: AtualizarEmpresaDto) {
    return this.empresasService.atualizar(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[Admin] Desativa a empresa (soft delete)' })
  desativar(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.empresasService.desativar(tenantId, id);
  }
}
