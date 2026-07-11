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
    // Cor derivada da PLACA (hash estável), não da posição na lista — assim a
    // cor de um veículo não muda quando a frota ganha/perde veículos.
    const hash = (s: string) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return Math.abs(h);
    };
    return rows.map((r: any) => ({
      placa: r.placa, modelo: r.modelo, motorista: r.motorista ?? null,
      cor: PALETTE[hash(r.placa) % PALETTE.length],
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
               lt.evento_id,
               LAG(lt.velocidade)             OVER w AS vel_ant,
               LEAST(EXTRACT(EPOCH FROM (lt.ts - LAG(lt.ts) OVER w)), 600) AS dt
        FROM   leitura_telemetria lt
        JOIN   veiculos v ON v.id = lt.veiculo_id
        WHERE  lt.tenant_id = $1
          AND  lt.ts >= ($2::date AT TIME ZONE 'America/Sao_Paulo')
          AND  lt.ts <  (($3::date + 1) AT TIME ZONE 'America/Sao_Paulo')
          AND  lt.gps_valido IS TRUE
          AND  v.ativo = true
          AND  ($4::uuid IS NULL OR v.empresa_id = $4::uuid)
        WINDOW w AS (PARTITION BY lt.veiculo_id ORDER BY lt.ts)
      ),
      -- Combustível como o worker calcula: LAG só sobre leituras COM nível
      -- (pular NULLs não perde quedas) e cada queda limitada a 100% (ruído
      -- de sensor não vira litros fantasmas).
      niv AS (
        SELECT placa, dia,
               SUM(LEAST(GREATEST(nivel_ant - nivel, 0), 100)) AS queda_pct,
               MAX(cap) AS cap
        FROM (
          SELECT v.placa,
                 (lt.ts AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
                 lt.nivel_combustivel_pct AS nivel, v.capacidade_tanque_l AS cap,
                 LAG(lt.nivel_combustivel_pct) OVER (PARTITION BY lt.veiculo_id ORDER BY lt.ts) AS nivel_ant
          FROM   leitura_telemetria lt
          JOIN   veiculos v ON v.id = lt.veiculo_id
          WHERE  lt.tenant_id = $1
            AND  lt.ts >= ($2::date AT TIME ZONE 'America/Sao_Paulo')
            AND  lt.ts <  (($3::date + 1) AT TIME ZONE 'America/Sao_Paulo')
            AND  lt.gps_valido IS TRUE
            AND  lt.nivel_combustivel_pct IS NOT NULL
            AND  v.ativo = true
            AND  ($4::uuid IS NULL OR v.empresa_id = $4::uuid)
        ) s
        GROUP BY placa, dia
      ),
      -- Distância geodésica (haversine) por dia — MESMA base e filtros do
      -- worker: <30m é ruído de GPS parado, >30km ou >220km/h é salto de GPS.
      -- Fallback para leituras que o recálculo horário ainda não alcançou.
      -- (O odômetro id 10 oscila com outliers e acumulava km fantasmas.)
      geo AS (
        SELECT placa, dia,
               SUM(CASE WHEN d_km >= 0.03 AND d_km <= 30 AND dt > 0
                         AND d_km / (dt / 3600.0) <= 220
                        THEN d_km ELSE 0 END) AS km_geo
        FROM (
          SELECT placa, dia, dt,
                 CASE WHEN lat_a IS NULL THEN 0
                      ELSE 2 * 6371.0 * asin(least(1.0, sqrt(
                             power(sin(radians(lat - lat_a) / 2), 2) +
                             cos(radians(lat_a)) * cos(radians(lat)) *
                             power(sin(radians(lng - lng_a) / 2), 2)
                           )))
                 END AS d_km
          FROM (
            SELECT v.placa,
                   (lt.ts AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
                   lt.latitude::float8  AS lat, lt.longitude::float8 AS lng,
                   LAG(lt.latitude::float8)  OVER w AS lat_a,
                   LAG(lt.longitude::float8) OVER w AS lng_a,
                   EXTRACT(EPOCH FROM (lt.ts - LAG(lt.ts) OVER w)) AS dt
            FROM   leitura_telemetria lt
            JOIN   veiculos v ON v.id = lt.veiculo_id
            WHERE  lt.tenant_id = $1
              AND  lt.ts >= ($2::date AT TIME ZONE 'America/Sao_Paulo')
              AND  lt.ts <  (($3::date + 1) AT TIME ZONE 'America/Sao_Paulo')
              AND  lt.latitude IS NOT NULL AND lt.longitude IS NOT NULL
              AND  v.ativo = true
              AND  ($4::uuid IS NULL OR v.empresa_id = $4::uuid)
            WINDOW w AS (PARTITION BY lt.veiculo_id ORDER BY lt.ts)
          ) coords
        ) s
        GROUP BY placa, dia
      ),
      agg AS (
      SELECT placa, dia,
        -- km via km_rodado persistido pelo worker (fonte primária)
        ROUND(COALESCE(SUM(GREATEST(km_rodado, 0)), 0)::numeric, 1)           AS km_worker,
        -- km estimado por velocidade × tempo (último recurso quando não há
        -- odômetro nem km_rodado — a velocidade vem em toda posição GPS)
        ROUND(COALESCE(SUM(velocidade * dt / 3600.0)
                       FILTER (WHERE velocidade > 0 AND dt > 0), 0)::numeric, 1) AS km_vel,
        ROUND(COALESCE(AVG(velocidade) FILTER (WHERE velocidade > 0), 0)::numeric, 1) AS avg_speed,
        COALESCE(MAX(velocidade), 0)                                          AS max_speed,
        -- Ignição em 3 estados MUTUAMENTE EXCLUSIVOS e exaustivos (mov + ocioso +
        -- desligada = tempo total). Movimento: ligada e velocidade > 0. Ocioso:
        -- ligada e NÃO em movimento (velocidade 0/nula) — cobre também leituras
        -- sem velocidade, sem perder tempo nem contar em dobro. Desligada: resto.
        ROUND(COALESCE(SUM(dt) FILTER (WHERE ignicao IS TRUE AND velocidade > 0), 0) / 60.0)::int AS mov_min,
        ROUND(COALESCE(SUM(dt) FILTER (WHERE ignicao IS TRUE AND (velocidade IS NULL OR velocidade <= 0)), 0) / 60.0)::int AS idle_min,
        ROUND(COALESCE(SUM(dt) FILTER (WHERE ignicao IS NOT TRUE), 0) / 60.0)::int AS off_min,
        -- Freadas: detecção Δv/Δt mesclada com o evento de frenagem brusca do
        -- próprio equipamento (evento_id 13654), como o worker faz (max).
        GREATEST(
          COUNT(*) FILTER (WHERE dt > 0 AND dt <= 60 AND vel_ant IS NOT NULL
                           AND (vel_ant - velocidade) / 3.6 / dt >= 2.0),
          COUNT(*) FILTER (WHERE evento_id = 13654)
        )                                                                     AS brakes_total,
        COUNT(*) FILTER (WHERE dt > 0 AND dt <= 60 AND vel_ant IS NOT NULL AND vel_ant > 70
                         AND (vel_ant - velocidade) / 3.6 / dt >= 2.0)        AS brakes_high
      FROM   base
      GROUP BY placa, dia
      )
      SELECT a.placa, a.dia::text AS dia,
             -- Cadeia de fontes do km: worker (haversine) → haversine ao vivo
             -- → velocidade×tempo. Garante km em todo dia com movimento,
             -- mesmo com o recálculo do worker atrasado.
             CASE WHEN a.km_worker > 0 THEN a.km_worker
                  WHEN COALESCE(g.km_geo, 0) > 0 THEN ROUND(g.km_geo::numeric, 1)
                  ELSE a.km_vel END                                           AS km,
             a.avg_speed, a.max_speed, a.mov_min, a.idle_min, a.off_min,
             a.brakes_total, a.brakes_high,
             CASE WHEN n.cap IS NULL THEN NULL
                  ELSE ROUND((n.queda_pct * n.cap / 100.0)::numeric, 1) END   AS fuel_l
      FROM   agg a
      LEFT JOIN niv n ON n.placa = a.placa AND n.dia = a.dia
      LEFT JOIN geo g ON g.placa = a.placa AND g.dia = a.dia
      ORDER BY a.placa, a.dia
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
        AND  ip.tipo_periodo = 'mensal'
        AND  ip.periodo_inicio = ($3 || '-01')::date
        AND  ip.nota_desempenho IS NOT NULL
        AND  ($4::uuid IS NULL OR m.empresa_id = $4::uuid)
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
        -- Média ponderada pelo tempo em movimento (como o worker calcula por
        -- linha) — média simples distorceria veículos com poucos km.
        SUM(ip.velocidade_media_kmh * ip.tempo_movimento_s)
          FILTER (WHERE ip.velocidade_media_kmh > 0 AND ip.tempo_movimento_s > 0)
        / NULLIF(SUM(ip.tempo_movimento_s)
          FILTER (WHERE ip.velocidade_media_kmh > 0 AND ip.tempo_movimento_s > 0), 0) AS vel_media,
        COALESCE(SUM(ip.frenagens_totais), 0)                                 AS frenagens,
        COALESCE(SUM(ip.frenagens_alta_velocidade), 0)                        AS frenagens_alta,
        COALESCE(SUM(ip.frenagens_bruscas), 0)                                AS frenagens_bruscas,
        AVG(ip.perc_motor_ocioso)                                             AS perc_ocioso,
        COALESCE(SUM(ip.tempo_motor_ocioso_penalizado_s), 0)                  AS tempo_ocioso_pen,
        COALESCE(SUM(ip.tempo_movimento_s), 0)                                AS tempo_mov,
        COALESCE(SUM(ip.tempo_parado_s), 0)                                   AS tempo_parado,
        COUNT(*)                                                              AS registros
      -- DISTINCT ON dedupe períodos parciais antigos (mesmo mês com
      -- periodo_fim diferente): fica só o mais completo, evitando somar em
      -- dobro km/litros. Sem filtro de v.ativo: indicadores históricos de
      -- veículos desativados continuam contando (como na Info Análise).
      FROM (
        SELECT DISTINCT ON (ip.motorista_id, ip.veiculo_id, ip.periodo_inicio) ip.*
        FROM   indicador_periodo ip
        WHERE  ip.tenant_id = $1
          AND  ip.tipo_periodo = 'mensal'
          AND  ip.periodo_inicio >= date_trunc('month', $2::date)::date
          AND  ip.periodo_inicio <= date_trunc('month', $3::date)::date
        ORDER BY ip.motorista_id, ip.veiculo_id, ip.periodo_inicio, ip.periodo_fim DESC
      ) ip
      JOIN   veiculos v ON v.id = ip.veiculo_id
      LEFT JOIN motoristas m ON m.id = ip.motorista_id
      WHERE  ($4::text IS NULL OR v.placa = $4)
        AND  ($5::uuid IS NULL OR m.empresa_id = $5::uuid)
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

  /**
   * Saúde dos DADOS do tenant: quando chegou a última leitura de telemetria
   * (ingestão viva?) e quando os indicadores do mês corrente foram
   * recalculados pela última vez (motor de cálculo vivo?). Alimenta o
   * badge de status na página — parada de ingestão fica visível na hora.
   */
  async statusDados(tenantId: string, empresaId?: string) {
    const rows = await this.db.query(
      `
      SELECT
        (SELECT MAX(lt.ts) FROM leitura_telemetria lt
          JOIN veiculos v ON v.id = lt.veiculo_id
          WHERE lt.tenant_id = $1
            AND ($2::uuid IS NULL OR v.empresa_id = $2::uuid))            AS ultima_leitura,
        (SELECT COUNT(*) FROM leitura_telemetria lt
          JOIN veiculos v ON v.id = lt.veiculo_id
          WHERE lt.tenant_id = $1
            AND lt.ts >= (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo')
            AND ($2::uuid IS NULL OR v.empresa_id = $2::uuid))            AS leituras_hoje,
        (SELECT MAX(ip.calculado_em) FROM indicador_periodo ip
          WHERE ip.tenant_id = $1 AND ip.tipo_periodo = 'mensal'
            AND ip.periodo_inicio = date_trunc('month', CURRENT_DATE)::date) AS ultimo_calculo
      `,
      [tenantId, empresaId ?? null],
    );
    const r = rows[0] ?? {};
    const minutos = (ts: any) => (ts ? Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000)) : null);
    return {
      ultimaLeitura: r.ultima_leitura ?? null,
      minutosDesdeUltimaLeitura: minutos(r.ultima_leitura),
      leiturasHoje: Number(r.leituras_hoje ?? 0),
      ultimoCalculo: r.ultimo_calculo ?? null,
      minutosDesdeUltimoCalculo: minutos(r.ultimo_calculo),
    };
  }

  /** Rota (pontos GPS) + eventos de um veículo no período, para o mapa. */
  async rota(tenantId: string, placa: string, de: string, ate: string, empresaId?: string) {
    const rows = await this.db.query(
      `
      SELECT lt.ts, lt.latitude, lt.longitude, lt.velocidade, lt.ignicao, lt.is_motor_ocioso,
             LAG(lt.velocidade) OVER w AS vel_ant,
             LEAST(EXTRACT(EPOCH FROM (lt.ts - LAG(lt.ts) OVER w)), 3600) AS dt,
             EXTRACT(EPOCH FROM (lt.ts - LAG(lt.ts) OVER w))              AS gap_s
      FROM   leitura_telemetria lt
      JOIN   veiculos v ON v.id = lt.veiculo_id
      WHERE  lt.tenant_id = $1 AND v.placa = $2 AND v.ativo = true
        AND  lt.ts >= ($3::date AT TIME ZONE 'America/Sao_Paulo')
        AND  lt.ts <  (($4::date + 1) AT TIME ZONE 'America/Sao_Paulo')
        AND  ($5::uuid IS NULL OR v.empresa_id = $5::uuid)
        AND  lt.latitude IS NOT NULL AND lt.longitude IS NOT NULL
        AND  lt.gps_valido IS TRUE
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

    rows.forEach((r: any) => {
      const lat = num(r.latitude), lng = num(r.longitude);
      if (lat === null || lng === null) return;
      const idx = pontos.length;
      // 5 casas decimais ≈ 1,1 m de precisão — suficiente para o mapa e corta
      // o payload quase pela metade.
      pontos.push([+lat.toFixed(5), +lng.toFixed(5)]);
      const vel = Number(r.velocidade ?? 0), velAnt = Number(r.vel_ant ?? 0), dt = Number(r.dt ?? 0);
      const gap = Number(r.gap_s ?? 0);
      // Excesso de velocidade (> 90 km/h)
      if (vel > 90) eventos.push({ type: 'speed', idx, label: `Excesso de velocidade · ${vel} km/h`, time: brt(r.ts) });
      // Frenagem brusca (Δv/Δt ≥ 2,94 m/s²)
      if (dt > 0 && velAnt > 0 && (velAnt - vel) / 3.6 / dt >= 2.94)
        eventos.push({ type: 'brake', idx, label: 'Frenagem brusca', time: brt(r.ts) });
      // Parada longa (> 20 min entre posições) — duração REAL (gap sem teto),
      // exibida em h/min acima de 1h.
      if (gap >= 20 * 60 && (r.is_motor_ocioso === true || vel === 0)) {
        const min = Math.round(gap / 60);
        const duracao = min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} min`;
        eventos.push({ type: 'stop', idx, label: `Parada longa · ${duracao}`, time: brt(r.ts) });
      }
    });
    if (pontos.length) {
      eventos.unshift({ type: 'start', idx: 0, label: 'Início do trajeto', time: brt(rows[0].ts) });
      eventos.push({ type: 'end', idx: pontos.length - 1, label: 'Fim do trajeto', time: brt(rows[rows.length - 1].ts) });
    }

    // Decimação: um mês a cada ~60s são ~44 mil pontos (~1 MB) por veículo.
    // Mantém no máximo ~MAX_PONTOS, preservando primeiro/último e TODOS os
    // pontos com evento (idx remapeado após a redução).
    const MAX_PONTOS = 4000;
    if (pontos.length > MAX_PONTOS) {
      const passo = Math.ceil(pontos.length / MAX_PONTOS);
      const manter = new Set<number>([0, pontos.length - 1]);
      for (let i = 0; i < pontos.length; i += passo) manter.add(i);
      for (const ev of eventos) manter.add(ev.idx);
      const ordenados = [...manter].sort((a, b) => a - b);
      const novoIdx = new Map<number, number>();
      ordenados.forEach((antigo, novo) => novoIdx.set(antigo, novo));
      const pontosRed = ordenados.map((i) => pontos[i]);
      for (const ev of eventos) ev.idx = novoIdx.get(ev.idx)!;
      return { pontos: pontosRed, eventos };
    }
    return { pontos, eventos };
  }
}
