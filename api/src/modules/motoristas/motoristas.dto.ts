import {
  IsString, IsNotEmpty, IsOptional,
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
  busca?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  pagina?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limite?: number = 20;

  get skip(): number { return ((this.pagina ?? 1) - 1) * (this.limite ?? 20); }
}
