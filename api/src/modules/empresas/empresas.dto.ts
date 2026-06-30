import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean,
  IsArray, IsUUID, Length, Matches, ValidateNested, IsEmail,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { EmpresaTipo } from '../../database/entities/enums';

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
  @ApiPropertyOptional({ example: '12345678000190', description: 'CNPJ (14 dígitos)' })
  @IsOptional() @IsString()
  @Matches(/^\d{14}$/, { message: 'CNPJ deve ter 14 dígitos numéricos' })
  cnpj?: string;

  @ApiProperty({ example: 'Transportes Silva LTDA' })
  @IsString() @IsNotEmpty() @Length(2, 200)
  nome: string;

  @ApiPropertyOptional({ example: 'Silva Log' })
  @IsOptional() @IsString() @Length(2, 200)
  nomeFantasia?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  endereco?: string;

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

export class AtualizarEmpresaDto extends PartialType(CriarEmpresaDto) {
  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  ativo?: boolean;
}
