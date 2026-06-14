import {
  IsString, IsNotEmpty, IsOptional, IsEnum, Length, Matches, IsEmail, MinLength,
} from 'class-validator';
import { PartialType, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantPlano } from '../../database/entities/enums';

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

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  multiportalUsername?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  multiportalPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  multiportalAppid?: number;

  @ApiProperty({ example: 'admin@empresa.com' })
  @IsEmail()
  adminEmail: string;

  @ApiProperty({ example: 'João da Silva' })
  @IsString() @IsNotEmpty()
  adminNome: string;

  @ApiProperty()
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
