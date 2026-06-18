import { NestFactory }         from '@nestjs/core';
import { ValidationPipe }      from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet                  from 'helmet';
import * as compression        from 'compression';
import { AppModule }           from './app.module';
import { DataSource }          from 'typeorm';
import * as bcrypt             from 'bcrypt';

async function seed(app: any) {
  const email    = process.env.SEED_ADMIN_EMAIL;
  const senha    = process.env.SEED_ADMIN_SENHA;
  const nomeTenant = process.env.SEED_TENANT_NOME ?? 'Infobridge Demo';
  const nomeAdmin  = process.env.SEED_ADMIN_NOME  ?? 'Administrador';

  if (!email || !senha) return;

  const db = app.get(DataSource);

  const jaExiste = await db.query(
    `SELECT id FROM usuarios WHERE email = $1 LIMIT 1`, [email]
  );
  if (jaExiste.length > 0) return;

  await db.transaction(async (manager: any) => {
    const [tenant] = await manager.query(
      `INSERT INTO tenants (nome, plano, ativo) VALUES ($1, 'starter', true) RETURNING id`,
      [nomeTenant]
    );
    const senhaHash = await bcrypt.hash(senha, 12);
    await manager.query(
      `INSERT INTO usuarios (tenant_id, nome, email, senha_hash, perfil, ativo)
       VALUES ($1, $2, $3, $4, 'admin', true)`,
      [tenant.id, nomeAdmin, email.toLowerCase(), senhaHash]
    );
    console.log(`✅ Admin criado: ${email} [tenant: ${nomeTenant}]`);
  });
}


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

  await seed(app);

  const port = process.env.API_PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Infobridge API rodando na porta ${port}`);
}

bootstrap();
