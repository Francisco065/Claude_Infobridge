// ── tenants.dto.ts ────────────────────────────────────────────
import {
  IsString, IsNotEmpty, IsOptional, IsEnum, Length, Matches, IsEmail, MinLength,
} from 'class-validator';
import { PartialType, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantPlano, UsuarioPerfil } from '../../database/entities/enums';

export class CriarTenantDto {
  @ApiProperty({ example: 'Inova Logística Ltda' })
  @IsString() @IsNotEmpty() @Length(2, 200)
  nome: string;

  @ApiPropertyOptional({ example: '02572512000158' })
  @IsOptional()
  @Matches(/^\d{14}$/, { message: 'CNPJ deve ter 14 dígitos numéricos' })
  cnpj?: string;

  @ApiPropertyOptional({ enum: TenantPlano, default: TenantPlano.STARTER })
  @IsOptional() @IsEnum(TenantPlano)
  plano?: TenantPlano;

  // Credencial Multiportal (configurada no onboarding)
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  multiportalUsername?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  multiportalPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  multiportalAppid?: number;

  // Admin inicial do tenant (criado junto com o tenant)
  @ApiProperty({ example: 'admin@empresa.com' })
  @IsEmail()
  adminEmail: string;

  @ApiProperty({ example: 'João da Silva' })
  @IsString() @IsNotEmpty()
  adminNome: string;

  @ApiProperty({ description: 'Senha temporária do admin (deve ser trocada no 1º acesso)' })
  @IsString() @MinLength(8)
  adminSenha: string;
}

export class AtualizarTenantDto extends PartialType(CriarTenantDto) {}

export class ConfigurarCredencialDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  username: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  password: string;

  @ApiProperty() @IsNotEmpty()
  appid: number;
}


// ── tenants.service.ts ────────────────────────────────────────
import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import * as bcrypt          from 'bcrypt';
import { Fernet }           from 'fernet'; // npm install fernet

import { Tenant }                 from '../../database/entities/tenant.entity';
import { Usuario }                from '../../database/entities/usuario.entity';
import { CredencialIntegracao }   from '../../database/entities/credencial-integracao.entity';
import { TenantNaoEncontradoException } from '../../common/filters/http-exception.filter';
import { PaginacaoDto, RespostaPaginadaDto } from '../../common/dto/paginacao.dto';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    // private readonly config: ConfigService,   // para pegar ENCRYPTION_KEY
  ) {}

  // ── Listar (superAdmin) ───────────────────────────────────

  async listar(paginacao: PaginacaoDto): Promise<RespostaPaginadaDto<Tenant>> {
    const repo = this.db.getRepository(Tenant);
    const qb   = repo.createQueryBuilder('t').orderBy('t.criado_em', 'DESC');

    if (paginacao.busca) {
      qb.where('t.nome ILIKE :busca OR t.cnpj LIKE :cnpj', {
        busca: `%${paginacao.busca}%`,
        cnpj:  `%${paginacao.busca}%`,
      });
    }

    const [dados, total] = await qb
      .skip(paginacao.skip)
      .take(paginacao.limite)
      .getManyAndCount();

    return RespostaPaginadaDto.de(dados, total, paginacao);
  }

  // ── Buscar por ID ──────────────────────────────────────────

  async buscarPorId(id: string): Promise<Tenant> {
    const tenant = await this.db
      .getRepository(Tenant)
      .findOne({ where: { id }, relations: ['credencial'] });

    if (!tenant) throw new TenantNaoEncontradoException(id);
    return tenant;
  }

  // ── Criar (onboarding completo) ───────────────────────────

  async criar(dto: CriarTenantDto): Promise<Tenant> {
    return this.db.transaction(async (manager) => {
      // 1. Verificar unicidade do CNPJ
      if (dto.cnpj) {
        const existe = await manager.findOne(Tenant, { where: { cnpj: dto.cnpj } });
        if (existe) throw new ConflictException(`CNPJ '${dto.cnpj}' já cadastrado`);
      }

      // 2. Criar o tenant
      const tenant = manager.create(Tenant, {
        nome:  dto.nome,
        cnpj:  dto.cnpj,
        plano: dto.plano ?? 'starter',
        ativo: true,
      });
      await manager.save(tenant);

      // 3. Criar o usuário admin inicial
      const senhaHash = await bcrypt.hash(dto.adminSenha, 12);
      const admin = manager.create(Usuario, {
        tenantId:  tenant.id,
        nome:      dto.adminNome,
        email:     dto.adminEmail.toLowerCase(),
        senhaHash,
        perfil:    UsuarioPerfil.ADMIN,
        ativo:     true,
      });
      await manager.save(admin);

      // 4. Configurar credencial Multiportal (se fornecida no onboarding)
      if (dto.multiportalUsername && dto.multiportalPassword && dto.multiportalAppid) {
        const passwordEnc = this._encryptarSenha(dto.multiportalPassword);
        const credencial = manager.create(CredencialIntegracao, {
          tenantId:    tenant.id,
          username:    dto.multiportalUsername,
          passwordEnc,
          appid:       dto.multiportalAppid,
          ativo:       true,
        });
        await manager.save(credencial);
      }

      this.logger.log(`Tenant criado: ${tenant.nome} [${tenant.id}]`);
      return tenant;
    });
  }

  // ── Atualizar ─────────────────────────────────────────────

  async atualizar(id: string, dto: AtualizarTenantDto): Promise<Tenant> {
    const tenant = await this.buscarPorId(id);
    Object.assign(tenant, { nome: dto.nome ?? tenant.nome, plano: dto.plano ?? tenant.plano });
    return this.db.getRepository(Tenant).save(tenant);
  }

  // ── Ativar / Desativar ────────────────────────────────────

  async alterarStatus(id: string, ativo: boolean): Promise<void> {
    await this.buscarPorId(id);
    await this.db.getRepository(Tenant).update(id, { ativo });
    this.logger.log(`Tenant ${ativo ? 'ativado' : 'desativado'}: ${id}`);
  }

  // ── Configurar Credencial Multiportal ─────────────────────

  async configurarCredencial(tenantId: string, dto: ConfigurarCredencialDto): Promise<void> {
    await this.buscarPorId(tenantId);
    const passwordEnc = this._encryptarSenha(dto.password);
    const repo = this.db.getRepository(CredencialIntegracao);
    const existente = await repo.findOne({ where: { tenantId } });

    if (existente) {
      await repo.update(existente.id, {
        username: dto.username, passwordEnc, appid: dto.appid,
        tokenCache: null, tokenExpiracao: null,  // forçar reautenticação
      });
    } else {
      const credencial = repo.create({ tenantId, username: dto.username, passwordEnc, appid: dto.appid });
      await repo.save(credencial);
    }

    this.logger.log(`Credencial Multiportal configurada para tenant: ${tenantId}`);
  }

  private _encryptarSenha(senha: string): string {
    // TODO: substituir pela chave real do config
    // const key = this.config.getOrThrow('ENCRYPTION_KEY');
    // return new Fernet(key).encrypt(senha);
    return Buffer.from(senha).toString('base64'); // placeholder — substituir em prod
  }
}


// ── tenants.controller.ts ─────────────────────────────────────
import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/guards';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';

@ApiTags('Tenants (SuperAdmin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
// TODO: adicionar guard de SuperAdmin
@Controller('admin/tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @ApiOperation({ summary: '[SuperAdmin] Lista todos os clientes' })
  listar(@Query() paginacao: PaginacaoDto) {
    return this.tenantsService.listar(paginacao);
  }

  @Get(':id')
  @ApiOperation({ summary: '[SuperAdmin] Detalhe de um cliente' })
  buscar(@Param('id') id: string) {
    return this.tenantsService.buscarPorId(id);
  }

  @Post()
  @ApiOperation({ summary: '[SuperAdmin] Onboarding completo de novo cliente' })
  criar(@Body() dto: CriarTenantDto) {
    return this.tenantsService.criar(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '[SuperAdmin] Atualizar dados do cliente' })
  atualizar(@Param('id') id: string, @Body() dto: AtualizarTenantDto) {
    return this.tenantsService.atualizar(id, dto);
  }

  @Patch(':id/ativar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[SuperAdmin] Ativar cliente' })
  ativar(@Param('id') id: string) {
    return this.tenantsService.alterarStatus(id, true);
  }

  @Patch(':id/desativar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[SuperAdmin] Desativar cliente (bloqueia acesso)' })
  desativar(@Param('id') id: string) {
    return this.tenantsService.alterarStatus(id, false);
  }

  @Post(':id/credencial-multiportal')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[SuperAdmin] Configurar credencial da Multiportal' })
  configurarCredencial(
    @Param('id') id: string,
    @Body() dto: ConfigurarCredencialDto,
  ) {
    return this.tenantsService.configurarCredencial(id, dto);
  }
}


// ── tenants.module.ts ─────────────────────────────────────────
import { Module }             from '@nestjs/common';
import { TypeOrmModule }      from '@nestjs/typeorm';
import { Tenant }             from '../../database/entities/tenant.entity';
import { Usuario }            from '../../database/entities/usuario.entity';
import { CredencialIntegracao } from '../../database/entities/credencial-integracao.entity';

@Module({
  imports:     [TypeOrmModule.forFeature([Tenant, Usuario, CredencialIntegracao])],
  controllers: [TenantsController],
  providers:   [TenantsService],
  exports:     [TenantsService],
})
export class TenantsModule {}
