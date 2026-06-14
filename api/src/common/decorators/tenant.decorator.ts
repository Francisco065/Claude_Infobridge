import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Extrai o tenantId do request (populado pelo TenantMiddleware) */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request['tenantId'];
  },
);

/** Extrai o userId do request (populado pelo TenantMiddleware) */
export const UserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request['userId'];
  },
);
