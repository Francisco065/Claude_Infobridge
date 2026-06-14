import { IsOptional, IsEnum, IsDateString, IsUUID, IsNumber, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TipoPeriodo } from '../../database/entities/enums';

export class FiltroIndicadorDto {
  @ApiPropertyOptional({ description: 'UUID do motorista' })
  @IsOptional() @IsUUID()
  motoristaId?: string;

  @ApiPropertyOptional({ description: 'UUID do veículo' })
  @IsOptional() @IsUUID()
  veiculoId?: string;

  @ApiPropertyOptional({ enum: TipoPeriodo })
  @IsOptional() @IsEnum(TipoPeriodo)
  tipoPeriodo?: TipoPeriodo;

  @ApiPropertyOptional({ example: '2025-01-01', description: 'Início do intervalo de busca' })
  @IsOptional() @IsDateString()
  dataInicio?: string;

  @ApiPropertyOptional({ example: '2025-01-31', description: 'Fim do intervalo de busca' })
  @IsOptional() @IsDateString()
  dataFim?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive()
  pagina?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive()
  limite?: number = 20;

  get skip(): number { return ((this.pagina ?? 1) - 1) * (this.limite ?? 20); }
}

export class RankingFiltroDto {
  @ApiPropertyOptional({ enum: TipoPeriodo, default: TipoPeriodo.MENSAL })
  @IsOptional() @IsEnum(TipoPeriodo)
  tipoPeriodo?: TipoPeriodo = TipoPeriodo.MENSAL;

  @ApiPropertyOptional({ example: '2025-01-01' })
  @IsOptional() @IsDateString()
  dataInicio?: string;

  @ApiPropertyOptional({ example: '2025-01-31' })
  @IsOptional() @IsDateString()
  dataFim?: string;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive()
  limite?: number = 10;
}
