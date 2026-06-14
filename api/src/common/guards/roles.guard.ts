import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector }     from '@nestjs/core';
import { ROLES_KEY }     from '../decorators/decorators';
import { UsuarioPerfil } from '../../database/entities/enums';

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
