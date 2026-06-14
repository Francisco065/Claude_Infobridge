import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UsuarioPerfil } from '../../database/entities/enums';

// ── @Roles(...) ───────────────────────────────────────────────
/**
 * Restringe o endpoint a perfis específicos.
 * Combinado com RolesGuard no módulo ou globalmente.
 *
 * @example
 * @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
 * @Get()
 * listar() {}
 */
export const Roles = (...roles: UsuarioPerfil[]) =>
  SetMetadata('roles', roles);

// ── @TenantId() ───────────────────────────────────────────────
/**
 * Extrai o tenantId do JWT (populado pelo TenantMiddleware).
 * Usar nos parâmetros dos controllers para evitar acessar req manualmente.
 *
 * @example
 * @Get()
 * listar(@TenantId() tenantId: string) {}
 */
export const TenantId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest()['tenantId'],
);

// ── @CurrentUser() ────────────────────────────────────────────
/**
 * Retorna o payload completo do usuário autenticado.
 * Contém: userId, tenantId, email, perfil, isSuperAdmin.
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest()['user'],
);

// ── @UserId() ─────────────────────────────────────────────────
export const UserId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest()['userId'],
);

// ── @IsSuperAdmin() ──────────────────────────────────────────
/**
 * Decorator de guarda para rotas exclusivas da Infobridge (plataforma).
 * Combinar com @Roles() não é necessário — superAdmin bypassa tudo.
 */
export const SuperAdminOnly = () => SetMetadata('superAdminOnly', true);
