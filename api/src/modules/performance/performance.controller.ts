import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard, TelaGuard, RequerTela } from '../../common/guards/guards';
import { TenantId, EmpresaScope }          from '../../common/decorators/decorators';
import { PerformanceService }              from './performance.service';

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_MES  = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_DIAS = 62; // telas diárias: no máximo ~2 meses por consulta

/** Valida de/ate (YYYY-MM-DD, de ≤ ate, intervalo limitado) — evita 500 do
 *  Postgres com datas malformadas e varreduras de anos de telemetria. */
function validarPeriodo(de: string, ate: string, maxDias = MAX_DIAS) {
  if (!RE_DATA.test(de ?? '') || !RE_DATA.test(ate ?? ''))
    throw new BadRequestException('Parâmetros de/ate devem estar no formato YYYY-MM-DD');
  const d1 = Date.parse(`${de}T00:00:00Z`), d2 = Date.parse(`${ate}T00:00:00Z`);
  if (Number.isNaN(d1) || Number.isNaN(d2))
    throw new BadRequestException('Data inválida em de/ate');
  if (d1 > d2) throw new BadRequestException('"de" deve ser anterior ou igual a "ate"');
  if ((d2 - d1) / 86_400_000 > maxDias)
    throw new BadRequestException(`Período máximo por consulta: ${maxDias} dias`);
}

@ApiTags('Performance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, TelaGuard)
@RequerTela('info-analise')
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
    validarPeriodo(de, ate);
    return this.perf.metricasDiarias(tenantId, de, ate, empresaId);
  }

  @Get('nota')
  @ApiOperation({ summary: 'Nota de desempenho oficial (mesma da Info Análise) do veículo no mês (mes=YYYY-MM)' })
  nota(
    @TenantId() tenantId: string,
    @Query('placa') placa: string,
    @Query('mes') mes: string,
    @EmpresaScope() empresaId?: string,
  ) {
    if (!placa?.trim()) throw new BadRequestException('Parâmetro placa é obrigatório');
    if (!RE_MES.test(mes ?? '')) throw new BadRequestException('Parâmetro mes deve estar no formato YYYY-MM');
    return this.perf.notaMes(tenantId, placa, mes, empresaId);
  }

  @Get('resumo')
  @ApiOperation({ summary: 'Resumo oficial do período (mesma fonte da Info Análise: indicador_periodo)' })
  resumo(
    @TenantId() tenantId: string,
    @Query('de') de: string,
    @Query('ate') ate: string,
    @Query('placa') placa: string | undefined,
    @EmpresaScope() empresaId?: string,
  ) {
    validarPeriodo(de, ate, 366); // só toca indicador_periodo (linhas mensais)
    return this.perf.resumoIndicador(tenantId, de, ate, placa || undefined, empresaId);
  }

  @Get('status')
  @ApiOperation({ summary: 'Saúde dos dados: última telemetria ingerida e último recálculo de indicadores' })
  status(@TenantId() tenantId: string, @EmpresaScope() empresaId?: string) {
    return this.perf.statusDados(tenantId, empresaId);
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
    if (!placa?.trim()) throw new BadRequestException('Parâmetro placa é obrigatório');
    validarPeriodo(de, ate);
    return this.perf.rota(tenantId, placa, de, ate, empresaId);
  }
}
