// ── motoristas.dto.ts ─────────────────────────────────────────
import {
  IsString, IsNotEmpty, IsOptional, IsEmail,
  Matches, Length, IsUUID, IsDateString,
} from 'class-validator';
import { PartialType, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CriarMotoristaDto {
  @ApiProperty({ example: 'Carlos Andrade' })
  @IsString() @IsNotEmpty() @Length(3, 200)
  nome: string;

  @ApiPropertyOptional({ example: '12345678901' })
  @IsOptional()
  @Matches(/^\d{11}$/, { message: 'CPF deve ter 11 dígitos numéricos' })
  cpf?: string;

  @ApiPropertyOptional({ example: '12345678901' })
  @IsOptional() @IsString()
  cnh?: string;

  @ApiPropertyOptional({ example: 'E', description: 'Categoria da CNH' })
  @IsOptional() @IsString() @Length(1, 5)
  categoriaCnh?: string;
}

export class AtualizarMotoristaDto extends PartialType(CriarMotoristaDto) {
  @ApiPropertyOptional()
  @IsOptional()
  ativo?: boolean;
}

export class VincularVeiculoDto {
  @ApiProperty({ description: 'UUID do veículo' })
  @IsUUID()
  veiculoId: string;

  @ApiPropertyOptional({ description: 'Data/hora de início do vínculo (default: agora)' })
  @IsOptional() @IsDateString()
  inicio?: string;
}

export class FiltroMotoristaDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  busca?: string;    // nome, CPF

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  pagina?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limite?: number = 20;

  get skip(): number { return ((this.pagina ?? 1) - 1) * (this.limite ?? 20); }
}


// ── motoristas.service.ts ─────────────────────────────────────
import { Injectable, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import { Motorista }        from '../../database/entities/motorista.entity';
import { Veiculo }          from '../../database/entities/veiculo.entity';
import { VinculoMotoristaVeiculo } from '../../database/entities/vinculo-motorista-veiculo.entity';
import { TenantAwareRepository }   from '../../database/tenant-aware.repository';
import {
  MotoristaNaoEncontradoException,
  VeiculoNaoEncontradoException,
} from '../../common/filters/http-exception.filter';
import { RespostaPaginadaDto } from '../../common/dto/paginacao.dto';
import { FonteVinculo }        from '../../database/entities/enums';

@Injectable()
export class MotoristasService {
  private readonly logger = new Logger(MotoristasService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  private repo(tenantId: string) {
    return new TenantAwareRepository(Motorista, this.db, tenantId);
  }

  // ── Listar ────────────────────────────────────────────────

  async listar(tenantId: string, filtro: FiltroMotoristaDto) {
    const paginacao = { pagina: filtro.pagina ?? 1, limite: filtro.limite ?? 20, skip: filtro.skip };
    const qb = this.repo(tenantId)
      .createQueryBuilder('m')
      // Traz o veículo ativo atual
      .leftJoinAndSelect('m.vinculos', 'vmv', 'vmv.fim IS NULL')
      .leftJoinAndSelect('vmv.veiculo', 'v')
      .where('m.ativo = true')
      .orderBy('m.nome', 'ASC');

    if (filtro.busca) {
      qb.andWhere('(m.nome ILIKE :b OR m.cpf LIKE :b)', { b: `%${filtro.busca}%` });
    }

    const [dados, total] = await qb.skip(paginacao.skip).take(paginacao.limite).getManyAndCount();
    return RespostaPaginadaDto.de(dados, total, paginacao as any);
  }

  // ── Detalhe com veículo atual e histórico ─────────────────

  async buscarPorId(tenantId: string, id: string) {
    const motorista = await this.repo(tenantId)
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.vinculos', 'vmv')
      .leftJoinAndSelect('vmv.veiculo', 'v')
      .andWhere('m.id = :id', { id })
      .orderBy('vmv.inicio', 'DESC')
      .getOne();

    if (!motorista) throw new MotoristaNaoEncontradoException(id);
    return motorista;
  }

  // ── Criar ─────────────────────────────────────────────────

  async criar(tenantId: string, dto: CriarMotoristaDto) {
    if (dto.cpf) {
      const cpfExiste = await this.db
        .getRepository(Motorista)
        .findOne({ where: { cpf: dto.cpf, tenantId } });
      if (cpfExiste) throw new ConflictException(`CPF '${dto.cpf}' já cadastrado no tenant`);
    }

    const motorista = await this.repo(tenantId).save({
      nome:        dto.nome,
      cpf:         dto.cpf,
      cnh:         dto.cnh,
      categoriaCnh: dto.categoriaCnh,
      ativo:       true,
    });

    this.logger.log(`Motorista criado: ${motorista.nome} [tenant: ${tenantId}]`);
    return motorista;
  }

  // ── Atualizar ─────────────────────────────────────────────

  async atualizar(tenantId: string, id: string, dto: AtualizarMotoristaDto) {
    const motorista = await this.repo(tenantId).findById(id);
    if (!motorista) throw new MotoristaNaoEncontradoException(id);
    await this.repo(tenantId).update(id, dto as any);
    return this.buscarPorId(tenantId, id);
  }

  // ── Vincular ao Veículo ───────────────────────────────────

  async vincularVeiculo(tenantId: string, motoristaId: string, dto: VincularVeiculoDto) {
    // Validar motorista
    const motorista = await this.repo(tenantId).findById(motoristaId);
    if (!motorista) throw new MotoristaNaoEncontradoException(motoristaId);

    // Validar veículo
    const veiculoRepo = new TenantAwareRepository(Veiculo, this.db, tenantId);
    const veiculo = await veiculoRepo.findById(dto.veiculoId);
    if (!veiculo) throw new VeiculoNaoEncontradoException(dto.veiculoId);

    const inicio = dto.inicio ? new Date(dto.inicio) : new Date();

    return this.db.transaction(async (manager) => {
      // Fechar vínculo anterior do MOTORISTA (se existir)
      await manager
        .createQueryBuilder()
        .update(VinculoMotoristaVeiculo)
        .set({ fim: inicio })
        .where('tenant_id = :tenantId AND motorista_id = :motoristaId AND fim IS NULL', {
          tenantId, motoristaId,
        })
        .execute();

      // Fechar vínculo anterior do VEÍCULO (um veículo = um motorista por vez)
      await manager
        .createQueryBuilder()
        .update(VinculoMotoristaVeiculo)
        .set({ fim: inicio })
        .where('tenant_id = :tenantId AND veiculo_id = :veiculoId AND fim IS NULL', {
          tenantId, veiculoId: dto.veiculoId,
        })
        .execute();

      // Criar novo vínculo
      const vinculo = manager.create(VinculoMotoristaVeiculo, {
        tenantId,
        motoristaId,
        veiculoId:   dto.veiculoId,
        inicio,
        fim:         null,
        fonte:       FonteVinculo.MANUAL,
      });
      await manager.save(vinculo);

      this.logger.log(
        `Motorista ${motoristaId} vinculado ao veículo ${dto.veiculoId} [tenant: ${tenantId}]`,
      );
      return vinculo;
    });
  }

  // ── Desvincular do Veículo ────────────────────────────────

  async desvincularVeiculo(tenantId: string, motoristaId: string) {
    const motorista = await this.repo(tenantId).findById(motoristaId);
    if (!motorista) throw new MotoristaNaoEncontradoException(motoristaId);

    const agora = new Date();
    const resultado = await this.db
      .createQueryBuilder()
      .update(VinculoMotoristaVeiculo)
      .set({ fim: agora })
      .where('tenant_id = :tenantId AND motorista_id = :motoristaId AND fim IS NULL', {
        tenantId, motoristaId,
      })
      .execute();

    if (resultado.affected === 0) {
      throw new BadRequestException('Motorista não possui vínculo ativo com nenhum veículo');
    }
    this.logger.log(`Motorista ${motoristaId} desvinculado [tenant: ${tenantId}]`);
  }

  // ── Histórico de vínculos ─────────────────────────────────

  async historico(tenantId: string, motoristaId: string) {
    const motorista = await this.repo(tenantId).findById(motoristaId);
    if (!motorista) throw new MotoristaNaoEncontradoException(motoristaId);

    return this.db
      .getRepository(VinculoMotoristaVeiculo)
      .createQueryBuilder('vmv')
      .leftJoinAndSelect('vmv.veiculo', 'v')
      .where('vmv.tenant_id = :tenantId AND vmv.motorista_id = :motoristaId', {
        tenantId, motoristaId,
      })
      .orderBy('vmv.inicio', 'DESC')
      .getMany();
  }

  // ── Sincronização da Multiportal ──────────────────────────

  async sincronizarDaMultiportal(
    tenantId: string,
    motoristasMultiportal: any[],
  ): Promise<{ novos: number; atualizados: number }> {
    let novos = 0, atualizados = 0;
    const repo = this.db.getRepository(Motorista);

    for (const m of motoristasMultiportal) {
      const existente = await repo.findOne({
        where: { tenantId, idMultiportal: m.id },
      });

      const dados = {
        tenantId,
        idMultiportal: m.id,
        nome:          m.nome ?? m.name ?? 'Sem nome',
        cpf:           m.cpf ?? undefined,
        ativo:         true,
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
      `Sincronização de motoristas [tenant: ${tenantId}]: +${novos} novos, ~${atualizados} atualizados`,
    );
    return { novos, atualizados };
  }
}


// ── motoristas.controller.ts ──────────────────────────────────
import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards/guards';
import { TenantId, Roles }          from '../../common/decorators/decorators';
import { UsuarioPerfil }            from '../../database/entities/enums';

@ApiTags('Motoristas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('motoristas')
export class MotoristasController {
  constructor(private readonly motoService: MotoristasService) {}

  @Get()
  @ApiOperation({ summary: 'Lista motoristas do tenant com veículo ativo' })
  listar(@TenantId() t: string, @Query() f: FiltroMotoristaDto) {
    return this.motoService.listar(t, f);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do motorista com histórico de veículos' })
  buscar(@TenantId() t: string, @Param('id') id: string) {
    return this.motoService.buscarPorId(t, id);
  }

  @Get(':id/historico')
  @ApiOperation({ summary: 'Histórico completo de vínculos motorista ↔ veículo' })
  historico(@TenantId() t: string, @Param('id') id: string) {
    return this.motoService.historico(t, id);
  }

  @Post()
  @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
  @ApiOperation({ summary: 'Cadastra motorista manualmente' })
  criar(@TenantId() t: string, @Body() dto: CriarMotoristaDto) {
    return this.motoService.criar(t, dto);
  }

  @Patch(':id')
  @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
  @ApiOperation({ summary: 'Atualiza dados do motorista' })
  atualizar(@TenantId() t: string, @Param('id') id: string, @Body() dto: AtualizarMotoristaDto) {
    return this.motoService.atualizar(t, id, dto);
  }

  @Post(':id/vincular')
  @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
  @ApiOperation({ summary: 'Vincula o motorista a um veículo (fecha vínculo anterior automaticamente)' })
  vincular(@TenantId() t: string, @Param('id') id: string, @Body() dto: VincularVeiculoDto) {
    return this.motoService.vincularVeiculo(t, id, dto);
  }

  @Delete(':id/vincular')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
  @ApiOperation({ summary: 'Remove o vínculo ativo do motorista com o veículo' })
  desvincular(@TenantId() t: string, @Param('id') id: string) {
    return this.motoService.desvincularVeiculo(t, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UsuarioPerfil.ADMIN)
  @ApiOperation({ summary: '[Admin] Desativa motorista (soft delete)' })
  async desativar(@TenantId() t: string, @Param('id') id: string) {
    await this.motoService.atualizar(t, id, { ativo: false });
  }
}


// ── motoristas.module.ts ──────────────────────────────────────
import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Motorista }     from '../../database/entities/motorista.entity';
import { Veiculo }       from '../../database/entities/veiculo.entity';
import { VinculoMotoristaVeiculo } from '../../database/entities/vinculo-motorista-veiculo.entity';

@Module({
  imports:     [TypeOrmModule.forFeature([Motorista, Veiculo, VinculoMotoristaVeiculo])],
  controllers: [MotoristasController],
  providers:   [MotoristasService],
  exports:     [MotoristasService],
})
export class MotoristasModule {}
