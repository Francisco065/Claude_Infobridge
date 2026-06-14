// ============================================================
// common/dto/pagination.dto.ts
// ============================================================
import { IsOptional, IsInt, Min, Max, IsString } from 'class-validator';
import { Type }                from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PaginationDto {
  @ApiPropertyOptional({ default: 1, description: 'Página atual' })
  @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, description: 'Itens por página (máx 100)' })
  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number)
  perPage: number = 20;

  @ApiPropertyOptional({ description: 'Busca por nome/placa/email' })
  @IsOptional() @IsString()
  search?: string;

  get skip(): number { return (this.page - 1) * this.perPage; }
}

export interface PaginatedResult<T> {
  items: T[];
  meta: { total: number; page: number; perPage: number; lastPage: number };
}

export function paginar<T>(items: T[], total: number, dto: PaginationDto): PaginatedResult<T> {
  return {
    items,
    meta: {
      total,
      page:     dto.page,
      perPage:  dto.perPage,
      lastPage: Math.ceil(total / dto.perPage) || 1,
    },
  };
}
