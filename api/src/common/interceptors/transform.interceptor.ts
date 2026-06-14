// ============================================================
// common/interceptors/transform.interceptor.ts
// ============================================================
import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map }        from 'rxjs/operators';

/**
 * Envolve todas as respostas de sucesso no formato padrão:
 * { success: true, data: <payload>, timestamp: '...' }
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, any> {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => ({
        success:   true,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}


// ============================================================
// common/filters/http-exception.filter.ts
// ============================================================
import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Captura todas as exceções HTTP e formata a resposta de erro:
 * { success: false, error: { code, message, details }, timestamp }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();

    let status  = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Erro interno do servidor';
    let code    = 'INTERNAL_ERROR';
    let details: any[] = [];

    if (exception instanceof HttpException) {
      status        = exception.getStatus();
      const body    = exception.getResponse() as any;
      message       = typeof body === 'string' ? body : (body.message ?? message);
      code          = body.error ?? exception.constructor.name.replace('Exception', '').toUpperCase();
      details       = Array.isArray(body.message) ? body.message : [];
    } else {
      this.logger.error('Exceção não tratada', exception as Error);
    }

    response.status(status).json({
      success:   false,
      error:     { code, message, details },
      path:      request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
