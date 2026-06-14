import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/guards';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { TenantsService } from './tenants.service';
import { CriarTenantDto, AtualizarTenantDto, ConfigurarCredencialDto } from './tenants.dto';

@ApiTags('Tenants (SuperAdmin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @ApiOperation({ summary: '[SuperAdmin] Lista todos os clientes' })
  listar(@Query() paginacao: PaginacaoDto) {
    return this.tenantsService.listar(paginacao);
  }

  @Get(':id')
  @ApiOperation({ summary: '[SuperAdmin] Detalhe de um cliente' })
  buscar(@Param('id') id: string) {
    return this.tenantsService.buscarPorId(id);
  }

  @Post()
  @ApiOperation({ summary: '[SuperAdmin] Onboarding completo de novo cliente' })
  criar(@Body() dto: CriarTenantDto) {
    return this.tenantsService.criar(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '[SuperAdmin] Atualizar dados do cliente' })
  atualizar(@Param('id') id: string, @Body() dto: AtualizarTenantDto) {
    return this.tenantsService.atualizar(id, dto);
  }

  @Patch(':id/ativar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[SuperAdmin] Ativar cliente' })
  ativar(@Param('id') id: string) {
    return this.tenantsService.alterarStatus(id, true);
  }

  @Patch(':id/desativar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[SuperAdmin] Desativar cliente' })
  desativar(@Param('id') id: string) {
    return this.tenantsService.alterarStatus(id, false);
  }

  @Post(':id/credencial-multiportal')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[SuperAdmin] Configurar credencial da Multiportal' })
  configurarCredencial(@Param('id') id: string, @Body() dto: ConfigurarCredencialDto) {
    return this.tenantsService.configurarCredencial(id, dto);
  }
}
