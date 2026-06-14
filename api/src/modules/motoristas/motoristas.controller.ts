import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/guards';
import { TenantId, Roles }          from '../../common/decorators/decorators';
import { UsuarioPerfil }            from '../../database/entities/enums';
import { MotoristasService }        from './motoristas.service';
import {
  CriarMotoristaDto, AtualizarMotoristaDto,
  VincularVeiculoDto, FiltroMotoristaDto,
} from './motoristas.dto';

@ApiTags('Motoristas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('motoristas')
export class MotoristasController {
  constructor(private readonly motoService: MotoristasService) {}

  @Get()
  @ApiOperation({ summary: 'Lista motoristas do tenant com veículo ativo' })
  listar(@TenantId() t: string, @Query() f: FiltroMotoristaDto) {
    return this.motoService.listar(t, f);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do motorista com histórico de veículos' })
  buscar(@TenantId() t: string, @Param('id') id: string) {
    return this.motoService.buscarPorId(t, id);
  }

  @Get(':id/historico')
  @ApiOperation({ summary: 'Histórico completo de vínculos motorista ↔ veículo' })
  historico(@TenantId() t: string, @Param('id') id: string) {
    return this.motoService.historico(t, id);
  }

  @Post()
  @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
  @ApiOperation({ summary: 'Cadastra motorista manualmente' })
  criar(@TenantId() t: string, @Body() dto: CriarMotoristaDto) {
    return this.motoService.criar(t, dto);
  }

  @Patch(':id')
  @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
  @ApiOperation({ summary: 'Atualiza dados do motorista' })
  atualizar(@TenantId() t: string, @Param('id') id: string, @Body() dto: AtualizarMotoristaDto) {
    return this.motoService.atualizar(t, id, dto);
  }

  @Post(':id/vincular')
  @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
  @ApiOperation({ summary: 'Vincula o motorista a um veículo' })
  vincular(@TenantId() t: string, @Param('id') id: string, @Body() dto: VincularVeiculoDto) {
    return this.motoService.vincularVeiculo(t, id, dto);
  }

  @Delete(':id/vincular')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
  @ApiOperation({ summary: 'Remove o vínculo ativo do motorista com o veículo' })
  desvincular(@TenantId() t: string, @Param('id') id: string) {
    return this.motoService.desvincularVeiculo(t, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UsuarioPerfil.ADMIN)
  @ApiOperation({ summary: '[Admin] Desativa motorista (soft delete)' })
  async desativar(@TenantId() t: string, @Param('id') id: string) {
    await this.motoService.atualizar(t, id, { ativo: false });
  }
}
