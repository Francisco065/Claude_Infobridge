import {
  IsString, IsNotEmpty, IsOptional,
  Matches, Length, IsUUID, IsDateString,
} from 'class-validator';
import { PartialType, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsCpf } from '../../common/validators/cpf.validator';

export class CriarMotoristaDto {
  @ApiProperty({ example: 'Carlos Andrade' })
  @IsString() @IsNotEmpty() @Length(3, 200)
  nome: string;

  @ApiProperty({ example: '52998224725', description: 'CPF real (11 dígitos)' })
  @IsString() @IsNotEmpty()
  @Matches(/^\d{11}$/, { message: 'CPF deve ter 11 dígitos numéricos' })
  @IsCpf()
  cpf: string;

  @ApiProperty({ example: '11987654321', description: 'Telefone com DDD (10 ou 11 dígitos)' })
  @IsString() @IsNotEmpty()
  @Matches(/^\d{10,11}$/, { message: 'Telefone deve ter DDD + número (10 ou 11 dígitos)' })
  telefone: string;

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
  busca?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  pagina?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limite?: number = 20;

  get skip(): number { return ((this.pagina ?? 1) - 1) * (this.limite ?? 20); }
}
