import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * HttpExceptionFilter
 *
 * Formata TODOS os erros da aplicação no padrão:
 * {
 *   statusCode: 400,
 *   mensagem:   'Descrição do erro',
 *   erros:      ['campo é obrigatório'],   // array de erros de validação
 *   timestamp:  '2026-06-13T10:00:00.000Z',
 *   path:       '/api/v1/veiculos',
 * }
 *
 * Registrar globalmente no main.ts:
 *   app.useGlobalFilters(new HttpExceptionFilter());
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();
    const status   = exception.getStatus();
    const body     = exception.getResponse() as any;

    // Erros de validação (class-validator via ValidationPipe)
    // vêm como { message: string[], error: 'Bad Request' }
    const erros: string[] =
      Array.isArray(body?.message) ? body.message : [];

    const mensagem: string =
      typeof body?.message === 'string'
        ? body.message
        : typeof body === 'string'
        ? body
        : 'Erro interno';

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}: ${mensagem}`,
        exception.stack,
      );
    }

    response.status(status).json({
      statusCode: status,
      mensagem,
      erros:      erros.length ? erros : undefined,
      timestamp:  new Date().toISOString(),
      path:       request.url,
    });
  }
}

// ── Exceções de domínio customizadas ─────────────────────────

import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';

export class TenantNaoEncontradoException extends NotFoundException {
  constructor(id?: string) {
    super(id ? `Tenant '${id}' não encontrado` : 'Tenant não encontrado');
  }
}

export class UsuarioNaoEncontradoException extends NotFoundException {
  constructor(id?: string) {
    super(id ? `Usuário '${id}' não encontrado` : 'Usuário não encontrado');
  }
}

export class EmailJaCadastradoException extends ConflictException {
  constructor(email: string) {
    super(`E-mail '${email}' já está em uso`);
  }
}

export class VeiculoNaoEncontradoException extends NotFoundException {
  constructor(id?: string) {
    super(id ? `Veículo '${id}' não encontrado` : 'Veículo não encontrado');
  }
}

export class MotoristaNaoEncontradoException extends NotFoundException {
  constructor(id?: string) {
    super(id ? `Motorista '${id}' não encontrado` : 'Motorista não encontrado');
  }
}

export class CredenciaisInvalidasException extends BadRequestException {
  constructor() {
    super('E-mail ou senha incorretos');
  }
}

export class TokenInvalidoException extends BadRequestException {
  constructor() {
    super('Token inválido ou expirado');
  }
}
