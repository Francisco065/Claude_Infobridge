import { Injectable, CanActivate, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const TELA_KEY = 'telaRequerida';

/**
 * Restringe o endpoint a usuários com acesso à TELA informada — a mesma regra
 * do podeAcessar() do frontend: admin e acessoTotal enxergam tudo; os demais
 * precisam da tela na lista `telas` do token. Fecha o buraco de o frontend
 * esconder a tela mas a API continuar aberta a qualquer autenticado.
 *
 * @example
 * @RequerTela('info-analise')
 * @Controller('performance')
 */
export const RequerTela = (tela: string) => SetMetadata(TELA_KEY, tela);

@Injectable()
export class TelaGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const tela = this.reflector.getAllAndOverride<string>(TELA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!tela) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Usuário não autenticado');
    if (user.perfil === 'admin' || user.acessoTotal === true) return true;
    if (Array.isArray(user.telas) && user.telas.includes(tela)) return true;

    throw new ForbiddenException(`Acesso negado. Usuário não tem acesso à tela '${tela}'.`);
  }
}
