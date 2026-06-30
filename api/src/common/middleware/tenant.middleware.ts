import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService }    from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }    from 'typeorm';

/**
 * TenantMiddleware
 *
 * Executado em todas as rotas autenticadas (exceto /auth/*).
 *
 * O que faz:
 *  1. Extrai o JWT do header Authorization: Bearer <token>
 *  2. Verifica e decodifica o token
 *  3. Coloca tenantId e userId em req para uso nos controllers
 *  4. Executa SET LOCAL app.current_tenant = '<uuid>' na conexão PostgreSQL
 *     para que o Row Level Security funcione automaticamente
 *
 * Nota sobre SET LOCAL e connection pooling:
 *  TypeORM usa um pool de conexões. SET LOCAL afeta apenas a transação corrente.
 *  Para garantir o isolamento, cada operação de escrita deve ser feita dentro
 *  de uma transação (ver BaseRepository.withTenant()).
 *  Para leituras, o SET SESSION (sem LOCAL) é suficiente, mas exige reset
 *  ao devolver a conexão ao pool — tratado no afterEach do middleware.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];

    // Sem token: passa adiante — JwtAuthGuard decide se a rota é pública ou não
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice(7);

    let payload: {
      sub: string; tenantId: string; email: string;
      perfil?: string; acessoTotal?: boolean; empresaId?: string | null;
    };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      // Token inválido: passa adiante, guard vai rejeitar
      return next();
    }

    req['userId']      = payload.sub;
    req['tenantId']    = payload.tenantId;
    req['email']       = payload.email;
    req['perfil']      = payload.perfil;
    req['acessoTotal'] = payload.acessoTotal;
    req['empresaId']   = payload.empresaId ?? null;

    await this.dataSource.query(
      `SET app.current_tenant = '${payload.tenantId}'`,
    );

    next();
  }
}
