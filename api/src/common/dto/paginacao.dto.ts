import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { Type }        from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Paginação — Request ───────────────────────────────────────

export class PaginacaoDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite: number = 20;

  @ApiPropertyOptional({ description: 'Busca por nome/texto' })
  @IsOptional()
  @IsString()
  busca?: string;

  get skip(): number {
    return (this.pagina - 1) * this.limite;
  }
}

// ── Paginação — Response ──────────────────────────────────────

export class MetaPaginacaoDto {
  @ApiProperty() pagina:    number;
  @ApiProperty() limite:    number;
  @ApiProperty() total:     number;
  @ApiProperty() totalPaginas: number;
  @ApiProperty() temProxima:   boolean;
  @ApiProperty() temAnterior:  boolean;
}

export class RespostaPaginadaDto<T> {
  @ApiProperty({ isArray: true })
  dados: T[];

  @ApiProperty({ type: MetaPaginacaoDto })
  meta: MetaPaginacaoDto;

  static de<T>(
    dados: T[],
    total: number,
    paginacao: PaginacaoDto,
  ): RespostaPaginadaDto<T> {
    const totalPaginas = Math.ceil(total / paginacao.limite);
    return {
      dados,
      meta: {
        pagina:       paginacao.pagina,
        limite:       paginacao.limite,
        total,
        totalPaginas,
        temProxima:   paginacao.pagina < totalPaginas,
        temAnterior:  paginacao.pagina > 1,
      },
    };
  }
}

// ── Resposta padrão de sucesso ────────────────────────────────

export class RespostaSucessoDto {
  @ApiProperty() mensagem: string;
  @ApiPropertyOptional() id?: string;
}
