import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard }        from '../../common/guards/guards';
import { TenantId, EmpresaScope }          from '../../common/decorators/decorators';
import { PerformanceService }              from './performance.service';

@ApiTags('Performance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('performance')
export class PerformanceController {
  constructor(private readonly perf: PerformanceService) {}

  @Get('veiculos')
  @ApiOperation({ summary: 'Veículos ativos (placa, modelo, motorista, cor) para o relatório' })
  veiculos(@TenantId() tenantId: string, @EmpresaScope() empresaId?: string) {
    return this.perf.veiculos(tenantId, empresaId);
  }

  @Get('diario')
  @ApiOperation({ summary: 'Métricas por veículo por dia no período (de/ate = YYYY-MM-DD)' })
  diario(
    @TenantId() tenantId: string,
    @Query('de') de: string,
    @Query('ate') ate: string,
    @EmpresaScope() empresaId?: string,
  ) {
    return this.perf.metricasDiarias(tenantId, de, ate, empresaId);
  }

  @Get('rota')
  @ApiOperation({ summary: 'Rota + eventos de um veículo no período (para o mapa)' })
  rota(
    @TenantId() tenantId: string,
    @Query('placa') placa: string,
    @Query('de') de: string,
    @Query('ate') ate: string,
    @EmpresaScope() empresaId?: string,
  ) {
    return this.perf.rota(tenantId, placa, de, ate, empresaId);
  }
}
