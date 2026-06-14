import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth }     from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard }                 from '../../common/guards/guards';
import { TenantId }                                 from '../../common/decorators/decorators';
import { IndicadoresService }                       from './indicadores.service';
import { FiltroIndicadorDto, RankingFiltroDto }     from './indicadores.dto';

@ApiTags('Indicadores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('indicadores')
export class IndicadoresController {
  constructor(private readonly indicadoresService: IndicadoresService) {}

  @Get()
  @ApiOperation({ summary: 'Lista indicadores de período com filtros' })
  listar(@TenantId() tenantId: string, @Query() filtro: FiltroIndicadorDto) {
    return this.indicadoresService.listar(tenantId, filtro);
  }

  @Get('ranking')
  @ApiOperation({ summary: 'Ranking de motoristas por nota de desempenho' })
  ranking(@TenantId() tenantId: string, @Query() filtro: RankingFiltroDto) {
    return this.indicadoresService.ranking(tenantId, filtro);
  }

  @Get('resumo')
  @ApiOperation({ summary: 'Resumo geral da frota no período' })
  resumo(@TenantId() tenantId: string, @Query() filtro: RankingFiltroDto) {
    return this.indicadoresService.resumoTenant(tenantId, filtro);
  }

  @Get('motorista/:motoristaId')
  @ApiOperation({ summary: 'Histórico de indicadores de um motorista' })
  historicoPorMotorista(
    @TenantId() tenantId: string,
    @Param('motoristaId') motoristaId: string,
    @Query() filtro: FiltroIndicadorDto,
  ) {
    return this.indicadoresService.historicoPorMotorista(tenantId, motoristaId, filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um indicador de período' })
  buscar(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.indicadoresService.buscarPorId(tenantId, id);
  }
}
