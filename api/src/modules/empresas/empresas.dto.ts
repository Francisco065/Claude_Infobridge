import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean,
  IsArray, IsUUID, Length, Matches, ValidateNested, IsEmail,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { EmpresaTipo } from '../../database/entities/enums';
import { IsCnpj } from '../../common/validators/cnpj.validator';

export class ResponsavelDto {
  @ApiProperty({ example: 'João da Silva' })
  @IsString() @IsNotEmpty() @Length(2, 200)
  nome: string;

  @ApiPropertyOptional({ example: 'joao@empresa.com' })
  @IsOptional() @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '11987654321' })
  @IsOptional() @IsString() @Length(8, 20)
  telefone?: string;
}

export class CriarEmpresaDto {
  @ApiPropertyOptional({ example: '11222333000181', description: 'CNPJ real (14 dígitos)' })
  @IsOptional() @IsString()
  @Matches(/^\d{14}$/, { message: 'CNPJ deve ter 14 dígitos numéricos' })
  @IsCnpj()
  cnpj?: string;

  @ApiProperty({ example: 'Transportes Silva LTDA' })
  @IsString() @IsNotEmpty() @Length(2, 200)
  nome: string;

  @ApiPropertyOptional({ example: 'Silva Log' })
  @IsOptional() @IsString() @Length(2, 200)
  nomeFantasia?: string;

  @ApiPropertyOptional({ description: 'Endereço livre (legado)' })
  @IsOptional() @IsString()
  endereco?: string;

  @ApiPropertyOptional({ example: '01001000', description: 'CEP (8 dígitos)' })
  @IsOptional() @IsString() @Matches(/^\d{8}$/, { message: 'CEP deve ter 8 dígitos numéricos' })
  cep?: string;

  @ApiPropertyOptional({ example: 'Praça da Sé' })
  @IsOptional() @IsString() @Length(1, 200)
  logradouro?: string;

  @ApiPropertyOptional({ example: '100' })
  @IsOptional() @IsString() @Length(1, 20)
  numero?: string;

  @ApiPropertyOptional({ example: 'Sé' })
  @IsOptional() @IsString() @Length(1, 120)
  bairro?: string;

  @ApiPropertyOptional({ example: 'São Paulo' })
  @IsOptional() @IsString() @Length(1, 120)
  cidade?: string;

  @ApiPropertyOptional({ example: 'SP' })
  @IsOptional() @IsString() @Length(2, 2)
  uf?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(2, 200)
  representanteComercial?: string;

  @ApiPropertyOptional({ enum: EmpresaTipo, default: EmpresaTipo.OUTROS })
  @IsOptional() @IsEnum(EmpresaTipo)
  tipo?: EmpresaTipo;

  @ApiPropertyOptional({ type: [ResponsavelDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ResponsavelDto)
  responsaveis?: ResponsavelDto[];

  @ApiPropertyOptional({ type: [String], description: 'UUIDs dos veículos vinculados à empresa' })
  @IsOptional() @IsArray() @IsUUID('all', { each: true })
  veiculoIds?: string[];
}

// Na edição o CNPJ é imutável — por isso é removido do DTO de atualização.
export class AtualizarEmpresaDto extends PartialType(OmitType(CriarEmpresaDto, ['cnpj'] as const)) {
  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  ativo?: boolean;
}
