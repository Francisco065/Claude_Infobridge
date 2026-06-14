// ============================================================
// common/decorators/roles.decorator.ts
// ============================================================
import { SetMetadata }  from '@nestjs/common';
import { UsuarioPerfil } from '../../../database/entities/enums';

export const ROLES_KEY = 'roles';

/**
 * Define quais perfis podem acessar a rota.
 * Uso: @Roles(UsuarioPerfil.ADMIN, UsuarioPerfil.GESTOR)
 *
 * Perfis e permissões:
 *  admin    → tudo no tenant (gerenciar usuários, veículos, motoristas, credenciais)
 *  gestor   → visualizar tudo, criar/editar veículos e motoristas (não gerencia usuários)
 *  operador → visualizar dados do próprio veículo/motorista; sem escrita
 *  readonly → somente leitura, sem nenhuma operação de escrita
 */
export const Roles = (...roles: UsuarioPerfil[]) => SetMetadata(ROLES_KEY, roles);


// ============================================================
// common/decorators/public.decorator.ts
// ============================================================
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca uma rota como pública (sem necessidade de JWT).
 * Uso: @Public() antes do @Get()/@Post() etc.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);


// ============================================================
// common/guards/jwt-auth.guard.ts
// ============================================================
import {
  Injectable, ExecutionContext, UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard }  from '@nestjs/passport';
import { Reflector }  from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Rotas marcadas com @Public() não precisam de token
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw err ?? new UnauthorizedException('Token inválido ou ausente');
    }
    return user;
  }
}


// ============================================================
// common/guards/roles.guard.ts
// ============================================================
import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException,
} from '@nestjs/common';
import { Reflector }     from '@nestjs/core';
import { ROLES_KEY }     from '../decorators/roles.decorator';
import { UsuarioPerfil } from '../../../database/entities/enums';

/** Hierarquia de perfis: admin > gestor > operador > readonly */
const HIERARQUIA: Record<UsuarioPerfil, number> = {
  [UsuarioPerfil.ADMIN]:    4,
  [UsuarioPerfil.GESTOR]:   3,
  [UsuarioPerfil.OPERADOR]: 2,
  [UsuarioPerfil.READONLY]: 1,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UsuarioPerfil[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.perfil) throw new ForbiddenException('Perfil não encontrado no token');

    const userLevel     = HIERARQUIA[user.perfil as UsuarioPerfil] ?? 0;
    const requiredLevel = Math.min(...required.map((r) => HIERARQUIA[r] ?? 99));

    if (userLevel < requiredLevel) {
      throw new ForbiddenException(
        `Acesso negado. Perfil '${user.perfil}' não tem permissão para esta operação.`,
      );
    }
    return true;
  }
}
