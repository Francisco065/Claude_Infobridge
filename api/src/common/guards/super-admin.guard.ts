import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector }     from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/decorators';

/**
 * Restringe rotas de plataforma (ex.: /admin/tenants) a super-admins internos
 * da Infobridge. Um ADMIN de tenant NÃO é super-admin — senão poderia ler/editar
 * os dados e as credenciais Multiportal de OUTROS tenants.
 * Honra @Public() para não bloquear o setup inicial.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Acesso restrito à administração da plataforma Infobridge.');
    }
    return true;
  }
}
