import { NestFactory }         from '@nestjs/core';
import { ValidationPipe }      from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as helmet             from 'helmet';
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

  // ── Swagger (desabilitado em produção) ────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Infobridge API')
      .setDescription('API de telemetria e gamificação de condutores')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
    console.log('📚 Swagger disponível em: http://localhost:3000/docs');
  }

  const port = process.env.API_PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Infobridge API rodando na porta ${port}`);
}

bootstrap();
