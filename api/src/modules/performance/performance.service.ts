import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';

// Paleta estável por veículo (mesma do handoff de design).
const PALETTE = [
  '#6E1414', '#2563EB', '#16A34A', '#D97706', '#7C3AED',
  '#0D9488', '#DB2777', '#4B5563', '#0EA5E9', '#CA8A04',
  '#059669', '#9333EA', '#EA580C', '#0891B2', '#65A30D',
];

@Injectable()
export class PerformanceService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Veículos ativos do tenant (opcionalmente da empresa) + motorista atual + cor. */
  async veiculos(tenantId: string, empresaId?: string) {
    const rows = await this.db.query(
      `
      SELECT v.placa,
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', v.marca, v.modelo)), ''), 'Sem modelo') AS modelo,
             m.nome AS motorista
      FROM   veiculos v
      LEFT JOIN vinculo_motorista_veiculo vmv
             ON vmv.veiculo_id = v.id AND vmv.fim IS NULL
      LEFT JOIN motoristas m ON m.id = vmv.motorista_id
      WHERE  v.tenant_id = $1 AND v.ativo = true
        AND  ($2::uuid IS NULL OR v.empresa_id = $2::uuid)
      ORDER BY v.placa
      `,
      [tenantId, empresaId ?? null],
    );
    return rows.map((r: any, i: number) => ({
      placa: r.placa, modelo: r.modelo, motorista: r.motorista ?? null,
      cor: PALETTE[i % PALETTE.length],
    }));
  }

  /**
   * Métricas por veículo por dia no período [de, ate). Tudo derivado de
   * leitura_telemetria: km (soma km_rodado), velocidade média/máx, minutos de
   * ignição (movimento/ociosa/desligada), freadas (Δv/Δt) e combustível
   * estimado (queda de nível × capacidade do tanque).
   */
  async metricasDiarias(tenantId: string, de: string, ate: string, empresaId?: string) {
    const rows = await this.db.query(
      `
      WITH base AS (
        SELECT v.placa,
               (lt.ts AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
               lt.velocidade, lt.ignicao, lt.is_motor_ocioso, lt.km_rodado,
               lt.odometro_km,
               lt.nivel_combustivel_pct, v.capacidade_tanque_l,
               LAG(lt.velocidade)             OVER w AS vel_ant,
               LAG(lt.odometro_km)            OVER w AS odo_ant,
               LAG(lt.nivel_combustivel_pct)  OVER w AS nivel_ant,
               LEAST(EXTRACT(EPOCH FROM (lt.ts - LAG(lt.ts) OVER w)), 600) AS dt
        FROM   leitura_telemetria lt
        JOIN   veiculos v ON v.id = lt.veiculo_id
        WHERE  lt.tenant_id = $1
          AND  lt.ts >= ($2::date AT TIME ZONE 'America/Sao_Paulo')
          AND  lt.ts <  (($3::date + 1) AT TIME ZONE 'America/Sao_Paulo')
          AND  v.ativo = true
          AND  ($4::uuid IS NULL OR v.empresa_id = $4::uuid)
        WINDOW w AS (PARTITION BY lt.veiculo_id ORDER BY lt.ts)
      )
      SELECT placa, dia::text AS dia,
        -- km do dia: usa o km_rodado persistido pelo worker; quando ele ainda
        -- não foi calculado (leituras recentes que o recálculo horário não
        -- alcançou), CALCULA aqui o mesmo delta de odômetro saneado do worker
        -- (0 < Δ ≤ 30 km por posição). Sem isso, dias recentes apareciam zerados.
        ROUND(COALESCE(SUM(GREATEST(COALESCE(
          km_rodado,
          CASE WHEN odometro_km - odo_ant > 0 AND odometro_km - odo_ant <= 30
               THEN odometro_km - odo_ant ELSE 0 END
        ), 0)), 0)::numeric, 1)                                               AS km,
        ROUND(COALESCE(AVG(velocidade) FILTER (WHERE velocidade > 0), 0)::numeric, 1) AS avg_speed,
        COALESCE(MAX(velocidade), 0)                                          AS max_speed,
        -- Ignição em 3 estados MUTUAMENTE EXCLUSIVOS e exaustivos (mov + ocioso +
        -- desligada = tempo total). Movimento: ligada e velocidade > 0. Ocioso:
        -- ligada e NÃO em movimento (velocidade 0/nula) — cobre também leituras
        -- sem velocidade, sem perder tempo nem contar em dobro. Desligada: resto.
        ROUND(COALESCE(SUM(dt) FILTER (WHERE ignicao IS TRUE AND velocidade > 0), 0) / 60.0)::int AS mov_min,
        ROUND(COALESCE(SUM(dt) FILTER (WHERE ignicao IS TRUE AND (velocidade IS NULL OR velocidade <= 0)), 0) / 60.0)::int AS idle_min,
        ROUND(COALESCE(SUM(dt) FILTER (WHERE ignicao IS NOT TRUE), 0) / 60.0)::int AS off_min,
        COUNT(*) FILTER (WHERE dt > 0 AND dt <= 60 AND vel_ant IS NOT NULL
                         AND (vel_ant - velocidade) / 3.6 / dt >= 2.0)        AS brakes_total,
        COUNT(*) FILTER (WHERE dt > 0 AND dt <= 60 AND vel_ant IS NOT NULL AND vel_ant > 70
                         AND (vel_ant - velocidade) / 3.6 / dt >= 2.0)        AS brakes_high,
        CASE WHEN MAX(capacidade_tanque_l) IS NULL THEN NULL
             ELSE ROUND((SUM(GREATEST(COALESCE(nivel_ant, nivel_combustivel_pct) - nivel_combustivel_pct, 0))
                         * MAX(capacidade_tanque_l) / 100.0)::numeric, 1) END AS fuel_l
      FROM   base
      GROUP BY placa, dia
      ORDER BY placa, dia
      `,
      [tenantId, de, ate, empresaId ?? null],
    );
    const n = (x: any) => (x === null || x === undefined ? null : Number(x));
    const porPlaca: Record<string, any[]> = {};
    for (const r of rows) {
      (porPlaca[r.placa] ??= []).push({
        date: r.dia, km: n(r.km), avgSpeed: n(r.avg_speed), maxSpeed: n(r.max_speed),
        ignMovingMin: n(r.mov_min), ignIdleMin: n(r.idle_min), ignOffMin: n(r.off_min),
        brakesTotal: n(r.brakes_total), brakesHigh: n(r.brakes_high), fuelL: n(r.fuel_l),
      });
    }
    return porPlaca;
  }

  /**
   * Nota de desempenho oficial (a MESMA da Info Análise): lê nota_desempenho do
   * indicador mensal do veículo/período. mes = 'YYYY-MM'. Quando há mais de um
   * motorista no mês, usa o dominante (maior km). Retorna null se não houver.
   */
  async notaMes(tenantId: string, placa: string, mes: string, empresaId?: string) {
    const rows = await this.db.query(
      `
      SELECT ip.nota_desempenho AS nota, m.nome AS motorista
      FROM   indicador_periodo ip
      JOIN   veiculos v   ON v.id = ip.veiculo_id
      LEFT JOIN motoristas m ON m.id = ip.motorista_id
      WHERE  v.tenant_id = $1 AND v.placa = $2
        AND  ip.periodo_inicio = ($3 || '-01')::date
        AND  ip.nota_desempenho IS NOT NULL
        AND  ($4::uuid IS NULL OR v.empresa_id = $4::uuid)
      ORDER BY ip.km_total DESC NULLS LAST
      LIMIT 1
      `,
      [tenantId, placa, mes, empresaId ?? null],
    );
    const r = rows[0];
    return { nota: r ? Number(r.nota) : null, motorista: r?.motorista ?? null };
  }

  /**
   * Resumo OFICIAL do período — lê os indicadores mensais já calculados pelo
   * worker (a MESMA fonte da Info Análise), garantindo que km, combustível,
   * média km/L, velocidades, frenagens e ocioso batam exatamente. Considera
   * todos os meses que o período [de, ate] toca. placa opcional (veículo único).
   */
  async resumoIndicador(tenantId: string, de: string, ate: string, placa?: string, empresaId?: string) {
    const rows = await this.db.query(
      `
      SELECT
        COALESCE(SUM(ip.km_total), 0)                                         AS km,
        SUM(ip.consumo_total_litros)                                          AS consumo,
        COALESCE(MAX(ip.velocidade_max_kmh), 0)                               AS vel_max,
        AVG(ip.velocidade_media_kmh) FILTER (WHERE ip.velocidade_media_kmh > 0) AS vel_media,
        COALESCE(SUM(ip.frenagens_totais), 0)                                 AS frenagens,
        COALESCE(SUM(ip.frenagens_alta_velocidade), 0)                        AS frenagens_alta,
        COALESCE(SUM(ip.frenagens_bruscas), 0)                                AS frenagens_bruscas,
        AVG(ip.perc_motor_ocioso)                                             AS perc_ocioso,
        COALESCE(SUM(ip.tempo_motor_ocioso_penalizado_s), 0)                  AS tempo_ocioso_pen,
        COALESCE(SUM(ip.tempo_movimento_s), 0)                                AS tempo_mov,
        COALESCE(SUM(ip.tempo_parado_s), 0)                                   AS tempo_parado,
        COUNT(*)                                                              AS registros
      FROM   indicador_periodo ip
      JOIN   veiculos v ON v.id = ip.veiculo_id
      WHERE  ip.tenant_id = $1 AND v.ativo = true
        AND  ip.tipo_periodo = 'mensal'
        AND  ip.periodo_inicio >= date_trunc('month', $2::date)::date
        AND  ip.periodo_inicio <= date_trunc('month', $3::date)::date
        AND  ($4::text IS NULL OR v.placa = $4)
        AND  ($5::uuid IS NULL OR v.empresa_id = $5::uuid)
      `,
      [tenantId, de, ate, placa ?? null, empresaId ?? null],
    );
    const r = rows[0] ?? {};
    const num = (x: any) => (x === null || x === undefined ? null : Number(x));
    const km = Number(r.km ?? 0);
    const consumo = num(r.consumo);
    return {
      registros: Number(r.registros ?? 0),
      km,
      consumo,
      mediaKmL: consumo && consumo > 0 ? +(km / consumo).toFixed(2) : null,
      velMedia: num(r.vel_media) ?? 0,
      velMax: num(r.vel_max) ?? 0,
      frenagens: Number(r.frenagens ?? 0),
      frenagensAlta: Number(r.frenagens_alta ?? 0),
      frenagensBruscas: Number(r.frenagens_bruscas ?? 0),
      percOcioso: num(r.perc_ocioso) ?? 0,
      tempoOciosoPenalizadoS: Number(r.tempo_ocioso_pen ?? 0),
      tempoMovS: Number(r.tempo_mov ?? 0),
      tempoParadoS: Number(r.tempo_parado ?? 0),
    };
  }

  /** Rota (pontos GPS) + eventos de um veículo no período, para o mapa. */
  async rota(tenantId: string, placa: string, de: string, ate: string, empresaId?: string) {
    const rows = await this.db.query(
      `
      SELECT lt.ts, lt.latitude, lt.longitude, lt.velocidade, lt.ignicao, lt.is_motor_ocioso,
             LAG(lt.velocidade) OVER w AS vel_ant,
             LEAST(EXTRACT(EPOCH FROM (lt.ts - LAG(lt.ts) OVER w)), 3600) AS dt
      FROM   leitura_telemetria lt
      JOIN   veiculos v ON v.id = lt.veiculo_id
      WHERE  lt.tenant_id = $1 AND v.placa = $2 AND v.ativo = true
        AND  lt.ts >= ($3::date AT TIME ZONE 'America/Sao_Paulo')
        AND  lt.ts <  (($4::date + 1) AT TIME ZONE 'America/Sao_Paulo')
        AND  ($5::uuid IS NULL OR v.empresa_id = $5::uuid)
        AND  lt.latitude IS NOT NULL AND lt.longitude IS NOT NULL
      WINDOW w AS (PARTITION BY lt.veiculo_id ORDER BY lt.ts)
      ORDER BY lt.ts
      `,
      [tenantId, placa, de, ate, empresaId ?? null],
    );
    const num = (x: any) => (x === null ? null : Number(x));
    const pontos: [number, number][] = [];
    const eventos: any[] = [];
    const brt = (ts: any) => new Date(ts).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).replace(',', ' ·');

    rows.forEach((r: any, i: number) => {
      const lat = num(r.latitude), lng = num(r.longitude);
      if (lat === null || lng === null) return;
      const idx = pontos.length;
      pontos.push([lat, lng]);
      const vel = Number(r.velocidade ?? 0), velAnt = Number(r.vel_ant ?? 0), dt = Number(r.dt ?? 0);
      // Excesso de velocidade (> 90 km/h)
      if (vel > 90) eventos.push({ type: 'speed', idx, label: `Excesso de velocidade · ${vel} km/h`, time: brt(r.ts) });
      // Frenagem brusca (Δv/Δt ≥ 2,94 m/s²)
      if (dt > 0 && velAnt > 0 && (velAnt - vel) / 3.6 / dt >= 2.94)
        eventos.push({ type: 'brake', idx, label: 'Frenagem brusca', time: brt(r.ts) });
      // Parada longa (motor ocioso / parado por > 20 min entre posições)
      if (dt >= 20 * 60 && (r.is_motor_ocioso === true || vel === 0))
        eventos.push({ type: 'stop', idx, label: `Parada longa · ${Math.round(dt / 60)} min`, time: brt(r.ts) });
    });
    if (pontos.length) {
      eventos.unshift({ type: 'start', idx: 0, label: 'Início do trajeto', time: brt(rows[0].ts) });
      eventos.push({ type: 'end', idx: pontos.length - 1, label: 'Fim do trajeto', time: brt(rows[rows.length - 1].ts) });
    }
    return { pontos, eventos };
  }
}
