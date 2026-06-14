// ── veiculos.dto.ts ───────────────────────────────────────────
import {
  IsOptional, IsNumber, IsPositive, IsString, Length, IsEnum,
} from 'class-validator';
import { Type }             from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TipoDispositivo }  from '../../database/entities/enums';

export class AtualizarVeiculoDto {
  @ApiPropertyOptional({ description: 'Placa (atualização manual se divergir da Multiportal)' })
  @IsOptional() @IsString() @Length(7, 10)
  placa?: string;

  @ApiPropertyOptional({ description: 'Consumo de referência (benchmark) em km/L' })
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive()
  consumoReferenciaKml?: number;

  @ApiPropertyOptional({ description: 'Capacidade do tanque em litros' })
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive()
  capacidadeTanqueL?: number;

  @ApiPropertyOptional({ enum: TipoDispositivo })
  @IsOptional() @IsEnum(TipoDispositivo)
  tipoDispositivo?: TipoDispositivo;
}

export class FiltroVeiculoDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  busca?: string;     // placa, modelo, frota

  @ApiPropertyOptional({ enum: TipoDispositivo })
  @IsOptional() @IsEnum(TipoDispositivo)
  tipoDispositivo?: TipoDispositivo;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive()
  pagina?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive()
  limite?: number = 20;

  get skip(): number { return ((this.pagina ?? 1) - 1) * (this.limite ?? 20); }
}


// ── veiculos.service.ts ───────────────────────────────────────
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource }   from '@nestjs/typeorm';
import { DataSource }         from 'typeorm';
import { Veiculo }            from '../../database/entities/veiculo.entity';
import { Motorista }          from '../../database/entities/motorista.entity';
import { VinculoMotoristaVeiculo } from '../../database/entities/vinculo-motorista-veiculo.entity';
import { TenantAwareRepository }   from '../../database/tenant-aware.repository';
import { VeiculoNaoEncontradoException } from '../../common/filters/http-exception.filter';
import { RespostaPaginadaDto, PaginacaoDto } from '../../common/dto/paginacao.dto';

@Injectable()
export class VeiculosService {
  private readonly logger = new Logger(VeiculosService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  private repo(tenantId: string) {
    return new TenantAwareRepository(Veiculo, this.db, tenantId);
  }

  // ── Listar com filtros ────────────────────────────────────

  async listar(tenantId: string, filtro: FiltroVeiculoDto) {
    const paginacao = { pagina: filtro.pagina ?? 1, limite: filtro.limite ?? 20, skip: filtro.skip };
    const qb = this.repo(tenantId)
      .createQueryBuilder('v')
      .leftJoinAndSelect(   // motorista ativo (vínculo sem fim)
        'v.vinculos', 'vmv', 'vmv.fim IS NULL',
      )
      .leftJoinAndSelect('vmv.motorista', 'm')
      .where('v.ativo = true')
      .orderBy('v.placa', 'ASC');

    if (filtro.busca) {
      qb.andWhere(
        '(v.placa ILIKE :b OR v.modelo ILIKE :b OR v.frota ILIKE :b)',
        { b: `%${filtro.busca}%` },
      );
    }
    if (filtro.tipoDispositivo) {
      qb.andWhere('v.tipo_dispositivo = :td', { td: filtro.tipoDispositivo });
    }

    const [dados, total] = await qb.skip(paginacao.skip).take(paginacao.limite).getManyAndCount();
    return RespostaPaginadaDto.de(dados, total, paginacao as any);
  }

  // ── Detalhe com motorista ativo e últimos KMs ─────────────

  async buscarPorId(tenantId: string, id: string) {
    const veiculo = await this.repo(tenantId)
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.vinculos', 'vmv', 'vmv.fim IS NULL')
      .leftJoinAndSelect('vmv.motorista', 'm')
      .andWhere('v.id = :id', { id })
      .getOne();

    if (!veiculo) throw new VeiculoNaoEncontradoException(id);
    return veiculo;
  }

  // ── Atualizar configurações locais ────────────────────────

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

  /**
   * Sincroniza veículos com a Multiportal.
   * Chamado manualmente pelo admin OU automaticamente pelo worker de ingestão
   * na primeira execução de dados_novos.
   *
   * Recebe o array de veículos já obtido da Multiportal (evita chamar a API
   * novamente) e faz upsert de cada um no banco local.
   */
  async sincronizarDaMultiportal(
    tenantId: string,
    veiculosMultiportal: any[],
  ): Promise<{ novos: number; atualizados: number }> {
    let novos = 0, atualizados = 0;
    const repo = this.db.getRepository(Veiculo);

    for (const v of veiculosMultiportal) {
      const existente = await repo.findOne({
        where: { tenantId, idMultiportal: v.id },
      });

      const dados = {
        tenantId,
        idMultiportal:     v.id,
        placa:             v.placa       ?? undefined,
        marca:             v.marca       ?? undefined,
        modelo:            v.modelo      ?? undefined,
        frota:             v.frota       ?? undefined,
        tipoMonitoramento: v.tipoMonitoramento ?? undefined,
        ativo:             true,
      };

      if (existente) {
        await repo.update(existente.id, dados);
        atualizados++;
      } else {
        await repo.save(repo.create(dados));
        novos++;
      }
    }

    this.logger.log(
      `Sincronização de veículos [tenant: ${tenantId}]: +${novos} novos, ~${atualizados} atualizados`,
    );
    return { novos, atualizados };
  }
}


// ── veiculos.controller.ts ────────────────────────────────────
import {
  Controller, Get, Patch, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/guards';
import { TenantId, Roles }          from '../../common/decorators/decorators';

@ApiTags('Veículos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('veiculos')
export class VeiculosController {
  constructor(private readonly veiculosService: VeiculosService) {}

  @Get()
  @ApiOperation({ summary: 'Lista veículos do tenant com motorista ativo' })
  listar(@TenantId() tenantId: string, @Query() filtro: FiltroVeiculoDto) {
    return this.veiculosService.listar(tenantId, filtro);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do veículo com motorista ativo' })
  buscar(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.veiculosService.buscarPorId(tenantId, id);
  }

  @Patch(':id')
  @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
  @ApiOperation({ summary: 'Atualiza configurações do veículo (benchmark, tanque)' })
  atualizar(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: AtualizarVeiculoDto,
  ) {
    return this.veiculosService.atualizar(tenantId, id, dto);
  }
}


// ── veiculos.module.ts ────────────────────────────────────────
import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Veiculo }       from '../../database/entities/veiculo.entity';
import { VinculoMotoristaVeiculo } from '../../database/entities/vinculo-motorista-veiculo.entity';

@Module({
  imports:     [TypeOrmModule.forFeature([Veiculo, VinculoMotoristaVeiculo])],
  controllers: [VeiculosController],
  providers:   [VeiculosService],
  exports:     [VeiculosService],
})
export class VeiculosModule {}
