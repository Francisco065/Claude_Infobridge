import { NestFactory }         from '@nestjs/core';
import { ValidationPipe }      from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet                  from 'helmet';
import * as compression        from 'compression';
import { AppModule }           from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── Segurança ─────────────────────────────────────────────
  app.use(helmet());
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? '*',
    credentials: true,
  });
  app.use(compression());

  // ── Validação global de DTOs ──────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:        true,   // remove campos não declarados no DTO
      forbidNonWhitelisted: true,
      transform:        true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Prefixo global da API ─────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── Swagger (protegido por chave de API) ─────────────────
  const docsKey = process.env.DOCS_API_KEY;
  if (docsKey) {
    const { Request, Response, NextFunction } = await import('express') as any;
    app.use('/docs', (req: any, res: any, next: any) => {
      if (req.query.key === docsKey || req.headers['x-docs-key'] === docsKey) return next();
      res.status(401).json({ message: 'Chave inválida — use ?key=SUA_CHAVE ou header x-docs-key' });
    });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Infobridge API')
    .setDescription('API de telemetria e gamificação de condutores')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.API_PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Infobridge API rodando na porta ${port}`);
}

bootstrap();
