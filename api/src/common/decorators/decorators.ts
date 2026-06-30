import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UsuarioPerfil } from '../../database/entities/enums';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';

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

// ── @EmpresaScope() ───────────────────────────────────────────
/**
 * Empresa (cliente) à qual as consultas devem ser restritas.
 *
 * Retorna `undefined` (= sem restrição, vê todas as empresas do tenant) quando:
 *  - o usuário é admin, OU
 *  - o usuário tem acesso total, OU
 *  - o usuário não está vinculado a nenhuma empresa (legado/irrestrito).
 *
 * Caso contrário, retorna o `empresaId` do usuário — os serviços aplicam
 * `WHERE empresa_id = :empresaId` para isolar os dados do cliente.
 */
export const EmpresaScope = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest();
    if (req['perfil'] === 'admin' || req['acessoTotal'] === true) return undefined;
    return req['empresaId'] || undefined;
  },
);

// ── @IsSuperAdmin() ──────────────────────────────────────────
/**
 * Decorator de guarda para rotas exclusivas da Infobridge (plataforma).
 * Combinar com @Roles() não é necessário — superAdmin bypassa tudo.
 */
export const SuperAdminOnly = () => SetMetadata('superAdminOnly', true);
