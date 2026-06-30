import {
  Controller, Get, Patch, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/guards';
import { TenantId, Roles, EmpresaScope } from '../../common/decorators/decorators';
import { UsuarioPerfil }            from '../../database/entities/enums';
import { VeiculosService }          from './veiculos.service';
import { AtualizarVeiculoDto, FiltroVeiculoDto } from './veiculos.dto';

@ApiTags('Veículos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('veiculos')
export class VeiculosController {
  constructor(private readonly veiculosService: VeiculosService) {}

  @Get()
  @ApiOperation({ summary: 'Lista veículos do tenant com motorista ativo' })
  listar(@TenantId() tenantId: string, @Query() filtro: FiltroVeiculoDto, @EmpresaScope() empresaId?: string) {
    return this.veiculosService.listar(tenantId, filtro, empresaId);
  }

  @Get('ao-vivo')
  @ApiOperation({ summary: 'Última posição/telemetria de cada veículo (mapa ao vivo)' })
  aoVivo(@TenantId() tenantId: string, @EmpresaScope() empresaId?: string) {
    return this.veiculosService.aoVivo(tenantId, empresaId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do veículo com motorista ativo' })
  buscar(@TenantId() tenantId: string, @Param('id') id: string, @EmpresaScope() empresaId?: string) {
    return this.veiculosService.buscarPorId(tenantId, id, empresaId);
  }

  @Patch(':id')
  @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
  @ApiOperation({ summary: 'Atualiza configurações do veículo' })
  atualizar(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: AtualizarVeiculoDto) {
    return this.veiculosService.atualizar(tenantId, id, dto);
  }
}
