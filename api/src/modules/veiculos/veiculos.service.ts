import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource }   from '@nestjs/typeorm';
import { DataSource }         from 'typeorm';
import { Veiculo }            from '../../database/entities/veiculo.entity';
import { TenantAwareRepository }        from '../../database/tenant-aware.repository';
import { VeiculoNaoEncontradoException } from '../../common/filters/http-exception.filter';
import { RespostaPaginadaDto }          from '../../common/dto/paginacao.dto';
import { AtualizarVeiculoDto, FiltroVeiculoDto } from './veiculos.dto';

@Injectable()
export class VeiculosService {
  private readonly logger = new Logger(VeiculosService.name);

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private repo(tenantId: string) {
    return new TenantAwareRepository(Veiculo, this.db, tenantId);
  }

  /**
   * Última posição/telemetria de cada veículo ativo do tenant (mapa ao vivo).
   * Read-only: pega a leitura mais recente por veículo (LATERAL) + motorista
   * vinculado ativo. Status derivado de velocidade/ignição.
   * Combustível ainda não é ingerido → vai null (a UI não dispara "pane seca").
   */
  async aoVivo(tenantId: string, empresaId?: string) {
    const rows = await this.db.query(
      `
      SELECT v.id, v.placa, v.marca, v.modelo, v.frota,
             lt.latitude, lt.longitude, lt.velocidade, lt.rpm, lt.ignicao,
             lt.ts AS ultima_comunicacao,
             CASE
               WHEN lt.ts IS NULL              THEN 'MOTOR_DESLIGADO'
               WHEN COALESCE(lt.velocidade,0) > 0 THEN 'EM_MOVIMENTO'
               WHEN lt.ignicao = true          THEN 'MOTOR_LIGADO_PARADO'
               ELSE 'MOTOR_DESLIGADO'
             END AS status,
             m.id AS motorista_id, m.nome AS motorista_nome
      FROM   veiculos v
      LEFT JOIN LATERAL (
        SELECT latitude, longitude, velocidade, rpm, ignicao, ts, nivel_combustivel_pct
        FROM   leitura_telemetria
        WHERE  veiculo_id = v.id
        ORDER BY ts DESC
        LIMIT 1
      ) lt ON true
      LEFT JOIN vinculo_motorista_veiculo vmv
             ON vmv.veiculo_id = v.id AND vmv.fim IS NULL
      LEFT JOIN motoristas m ON m.id = vmv.motorista_id
      WHERE  v.tenant_id = $1 AND v.ativo = true
        AND  ($2::uuid IS NULL OR v.empresa_id = $2::uuid)
      ORDER BY v.placa
      `,
      [tenantId, empresaId ?? null],
    );

    const num = (x: any) => (x === null || x === undefined ? null : Number(x));

    const dados = rows.map((r: any) => ({
      id:        r.id,
      placa:     r.placa,
      marca:     r.marca,
      modelo:    r.modelo,
      frota:     r.frota,
      grupoId:   r.frota || 'sem-grupo',
      grupoNome: r.frota || 'Sem frota',
      motorista: r.motorista_id ? { id: r.motorista_id, nome: r.motorista_nome } : null,
      status:    r.status,
      latitude:  num(r.latitude),
      longitude: num(r.longitude),
      velocidade: num(r.velocidade),
      rpm:       num(r.rpm),
      combustivel: num(r.nivel_combustivel_pct), // nível % (CAN → OBD2 → …)
      ultimaComunicacao: r.ultima_comunicacao ? new Date(r.ultima_comunicacao).toISOString() : null,
    }));

    return { dados };
  }

  async listar(tenantId: string, filtro: FiltroVeiculoDto, empresaId?: string) {
    const paginacao = { pagina: filtro.pagina ?? 1, limite: filtro.limite ?? 20, skip: filtro.skip };
    const qb = this.repo(tenantId)
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.vinculos', 'vmv', 'vmv.fim IS NULL')
      .leftJoinAndSelect('vmv.motorista', 'm')
      .where('v.ativo = true')
      .orderBy('v.placa', 'ASC');

    if (empresaId) qb.andWhere('v.empresa_id = :empresaId', { empresaId });

    if (filtro.busca) {
      qb.andWhere('(v.placa ILIKE :b OR v.modelo ILIKE :b OR v.frota ILIKE :b)', { b: `%${filtro.busca}%` });
    }
    if (filtro.tipoDispositivo) {
      qb.andWhere('v.tipo_dispositivo = :td', { td: filtro.tipoDispositivo });
    }

    const [dados, total] = await qb.skip(paginacao.skip).take(paginacao.limite).getManyAndCount();
    return RespostaPaginadaDto.de(dados, total, paginacao as any);
  }

  async buscarPorId(tenantId: string, id: string, empresaId?: string) {
    const qb = this.repo(tenantId)
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.vinculos', 'vmv', 'vmv.fim IS NULL')
      .leftJoinAndSelect('vmv.motorista', 'm')
      .andWhere('v.id = :id', { id });

    if (empresaId) qb.andWhere('v.empresa_id = :empresaId', { empresaId });

    const veiculo = await qb.getOne();
    if (!veiculo) throw new VeiculoNaoEncontradoException(id);
    return veiculo;
  }

  async atualizar(tenantId: string, id: string, dto: AtualizarVeiculoDto) {
    const veiculo = await this.repo(tenantId).findById(id);
    if (!veiculo) throw new VeiculoNaoEncontradoException(id);

    await this.repo(tenantId).update(id, {
      placa:               dto.placa               ?? veiculo.placa,
      consumoReferenciaKml: dto.consumoReferenciaKml ?? veiculo.consumoReferenciaKml,
      capacidadeTanqueL:   dto.capacidadeTanqueL   ?? veiculo.capacidadeTanqueL,
      tipoDispositivo:     dto.tipoDispositivo      ?? veiculo.tipoDispositivo,
    });

    return this.buscarPorId(tenantId, id);
  }

  async sincronizarDaMultiportal(tenantId: string, veiculosMultiportal: any[]) {
    let novos = 0, atualizados = 0;
    const repo = this.db.getRepository(Veiculo);

    for (const v of veiculosMultiportal) {
      const existente = await repo.findOne({ where: { tenantId, idMultiportal: v.id } });
      const dados = {
        tenantId, idMultiportal: v.id, placa: v.placa ?? undefined,
        marca: v.marca ?? undefined, modelo: v.modelo ?? undefined,
        frota: v.frota ?? undefined, tipoMonitoramento: v.tipoMonitoramento ?? undefined, ativo: true,
      };
      if (existente) { await repo.update(existente.id, dados); atualizados++; }
      else { await repo.save(repo.create(dados)); novos++; }
    }

    return { novos, atualizados };
  }
}
