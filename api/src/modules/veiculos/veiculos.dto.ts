import { IsOptional, IsNumber, IsPositive, IsString, Length, IsEnum } from 'class-validator';
import { Type }             from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TipoDispositivo }  from '../../database/entities/enums';

export class AtualizarVeiculoDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(7, 10)
  placa?: string;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive()
  consumoReferenciaKml?: number;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive()
  capacidadeTanqueL?: number;

  @ApiPropertyOptional({ enum: TipoDispositivo })
  @IsOptional() @IsEnum(TipoDispositivo)
  tipoDispositivo?: TipoDispositivo;
}

export class FiltroVeiculoDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  busca?: string;

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
