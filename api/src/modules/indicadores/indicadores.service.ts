import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource }              from '@nestjs/typeorm';
import { DataSource }                    from 'typeorm';
import { IndicadorPeriodo }              from '../../database/entities/indicador-periodo.entity';
import { RespostaPaginadaDto }           from '../../common/dto/paginacao.dto';
import { FiltroIndicadorDto, RankingFiltroDto } from './indicadores.dto';

@Injectable()
export class IndicadoresService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private get repo() {
    return this.db.getRepository(IndicadorPeriodo);
  }

  // ── Listar com filtros ────────────────────────────────────

  async listar(tenantId: string, filtro: FiltroIndicadorDto) {
    const paginacao = { pagina: filtro.pagina ?? 1, limite: filtro.limite ?? 20, skip: filtro.skip };

    const qb = this.repo
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.motorista', 'm')
      .leftJoinAndSelect('i.veiculo', 'v')
      .where('i.tenant_id = :tenantId', { tenantId })
      .orderBy('i.periodo_inicio', 'DESC');

    if (filtro.motoristaId) qb.andWhere('i.motorista_id = :motoristaId', { motoristaId: filtro.motoristaId });
    if (filtro.veiculoId)   qb.andWhere('i.veiculo_id = :veiculoId', { veiculoId: filtro.veiculoId });
    if (filtro.tipoPeriodo) qb.andWhere('i.tipo_periodo = :tp', { tp: filtro.tipoPeriodo });
    if (filtro.dataInicio)  qb.andWhere('i.periodo_inicio >= :di', { di: filtro.dataInicio });
    if (filtro.dataFim)     qb.andWhere('i.periodo_fim <= :df', { df: filtro.dataFim });

    const [dados, total] = await qb.skip(paginacao.skip).take(paginacao.limite).getManyAndCount();
    return RespostaPaginadaDto.de(dados, total, paginacao as any);
  }

  // ── Detalhe de um indicador ───────────────────────────────

  async buscarPorId(tenantId: string, id: string) {
    const indicador = await this.repo
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.motorista', 'm')
      .leftJoinAndSelect('i.veiculo', 'v')
      .where('i.id = :id AND i.tenant_id = :tenantId', { id, tenantId })
      .getOne();

    if (!indicador) throw new NotFoundException(`Indicador ${id} não encontrado`);
    return indicador;
  }

  // ── Histórico de um motorista ─────────────────────────────

  async historicoPorMotorista(tenantId: string, motoristaId: string, filtro: FiltroIndicadorDto) {
    const paginacao = { pagina: filtro.pagina ?? 1, limite: filtro.limite ?? 20, skip: filtro.skip };

    const qb = this.repo
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.veiculo', 'v')
      .where('i.tenant_id = :tenantId AND i.motorista_id = :motoristaId', { tenantId, motoristaId })
      .orderBy('i.periodo_inicio', 'DESC');

    if (filtro.tipoPeriodo) qb.andWhere('i.tipo_periodo = :tp', { tp: filtro.tipoPeriodo });
    if (filtro.dataInicio)  qb.andWhere('i.periodo_inicio >= :di', { di: filtro.dataInicio });
    if (filtro.dataFim)     qb.andWhere('i.periodo_fim <= :df', { df: filtro.dataFim });

    const [dados, total] = await qb.skip(paginacao.skip).take(paginacao.limite).getManyAndCount();
    return RespostaPaginadaDto.de(dados, total, paginacao as any);
  }

  // ── Ranking de motoristas por nota ───────────────────────

  async ranking(tenantId: string, filtro: RankingFiltroDto) {
    const qb = this.repo
      .createQueryBuilder('i')
      .select([
        'i.motorista_id AS "motoristaId"',
        'm.nome AS "nomeMotorista"',
        'ROUND(AVG(i.nota_desempenho)::numeric, 2) AS "mediaNotaDesempenho"',
        'ROUND(AVG(i.media_km_l)::numeric, 3) AS "mediaKmL"',
        'SUM(i.km_total)::numeric AS "kmTotal"',
        'SUM(i.frenagens_bruscas)::integer AS "frenagensBruscas"',
        'COUNT(*)::integer AS "periodos"',
      ])
      .innerJoin('i.motorista', 'm')
      .where('i.tenant_id = :tenantId AND i.nota_desempenho IS NOT NULL', { tenantId })
      .groupBy('i.motorista_id, m.nome')
      .orderBy('"mediaNotaDesempenho"', 'DESC')
      .limit(filtro.limite ?? 10);

    if (filtro.tipoPeriodo) qb.andWhere('i.tipo_periodo = :tp', { tp: filtro.tipoPeriodo });
    if (filtro.dataInicio)  qb.andWhere('i.periodo_inicio >= :di', { di: filtro.dataInicio });
    if (filtro.dataFim)     qb.andWhere('i.periodo_fim <= :df', { df: filtro.dataFim });

    return qb.getRawMany();
  }

  // ── Resumo geral do tenant ────────────────────────────────

  async resumoTenant(tenantId: string, filtro: RankingFiltroDto) {
    const qb = this.repo
      .createQueryBuilder('i')
      .select([
        'COUNT(DISTINCT i.motorista_id)::integer AS "totalMotoristas"',
        'ROUND(AVG(i.nota_desempenho)::numeric, 2) AS "mediaNotaGeral"',
        'ROUND(AVG(i.media_km_l)::numeric, 3) AS "mediaKmL"',
        'SUM(i.km_total)::numeric AS "kmTotalFrota"',
        'SUM(i.frenagens_bruscas)::integer AS "frenagensBruscasTotais"',
        'ROUND(AVG(i.perc_motor_ocioso)::numeric, 2) AS "mediaPercOcioso"',
        'ROUND(AVG(i.perc_excesso_velocidade)::numeric, 2) AS "mediaExcessoVelocidade"',
      ])
      .where('i.tenant_id = :tenantId', { tenantId });

    if (filtro.tipoPeriodo) qb.andWhere('i.tipo_periodo = :tp', { tp: filtro.tipoPeriodo });
    if (filtro.dataInicio)  qb.andWhere('i.periodo_inicio >= :di', { di: filtro.dataInicio });
    if (filtro.dataFim)     qb.andWhere('i.periodo_fim <= :df', { df: filtro.dataFim });

    return qb.getRawOne();
  }
}
