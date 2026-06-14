import { Test, TestingModule }             from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TypeOrmModule }                   from '@nestjs/typeorm';
import { ConfigModule }                    from '@nestjs/config';
import * as request                        from 'supertest';
import { AppModule }                       from '../src/app.module';

const BASE_URL = 'http://localhost:3000/api/v1';

// ── Dados do seed (devem existir no banco dev) ─────────────────
const ADMIN = {
  email: 'admin@inovalogistica.com.br',
  senha: 'Infobridge@2026',
};
const GESTOR  = { email: 'gestor@inovalogistica.com.br', senha: 'Infobridge@2026' };
const USUARIO_TENANT_ID = '11111111-1111-1111-1111-111111111111';

let accessToken: string  = '';
let refreshToken: string = '';
let novoUsuarioId: string = '';

// ─────────────────────────────────────────────────────────────
describe('E2E — Infobridge API', () => {

  // ── 1. AUTH ────────────────────────────────────────────────
  describe('POST /auth/login', () => {
    it('deve retornar 200 com access + refresh token para admin válido', async () => {
      const res = await request(BASE_URL)
        .post('/auth/login')
        .send(ADMIN)
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.usuario.email).toBe(ADMIN.email);
      expect(res.body.usuario.perfil).toBe('admin');

      accessToken  = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('deve retornar 400 com credenciais inválidas', async () => {
      await request(BASE_URL)
        .post('/auth/login')
        .send({ email: ADMIN.email, senha: 'senha_errada' })
        .expect(400);
    });

    it('deve retornar 400 com e-mail inexistente', async () => {
      await request(BASE_URL)
        .post('/auth/login')
        .send({ email: 'nao_existe@teste.com', senha: '123456' })
        .expect(400);
    });
  });

  describe('GET /auth/me', () => {
    it('deve retornar o perfil do usuário autenticado', async () => {
      const res = await request(BASE_URL)
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.email).toBe(ADMIN.email);
      expect(res.body).not.toHaveProperty('senhaHash');
    });

    it('deve retornar 401 sem token', async () => {
      await request(BASE_URL).get('/auth/me').expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('deve renovar o access token', async () => {
      const res = await request(BASE_URL)
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      // Atualizar o token para os próximos testes
      accessToken = res.body.accessToken;
    });
  });

  // ── 2. USUÁRIOS ────────────────────────────────────────────
  describe('GET /usuarios', () => {
    it('admin deve listar usuários do tenant', async () => {
      const res = await request(BASE_URL)
        .get('/usuarios')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('dados');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.dados.length).toBeGreaterThanOrEqual(3);
      expect(res.body.dados[0]).not.toHaveProperty('senhaHash');
    });

    it('deve suportar busca por nome', async () => {
      const res = await request(BASE_URL)
        .get('/usuarios?busca=Admin')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.dados.some((u: any) => u.nome.includes('Admin'))).toBe(true);
    });
  });

  describe('POST /usuarios', () => {
    it('admin deve criar novo usuário', async () => {
      const payload = {
        nome:   'Novo Operador Teste',
        email:  `op_teste_${Date.now()}@inovalogistica.com.br`,
        perfil: 'operador',
        senha:  'Teste@Seguro123',
      };

      const res = await request(BASE_URL)
        .post('/usuarios')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(payload)
        .expect(201);

      expect(res.body.email).toBe(payload.email);
      expect(res.body).not.toHaveProperty('senhaHash');
      novoUsuarioId = res.body.id;
    });

    it('deve retornar 409 ao tentar duplicar e-mail', async () => {
      await request(BASE_URL)
        .post('/usuarios')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ nome: 'Dup', email: ADMIN.email, senha: 'Teste@Seguro123', perfil: 'operador' })
        .expect(409);
    });

    it('gestor NÃO deve criar usuário (403)', async () => {
      // Fazer login como gestor
      const loginGestor = await request(BASE_URL)
        .post('/auth/login').send(GESTOR).expect(200);

      await request(BASE_URL)
        .post('/usuarios')
        .set('Authorization', `Bearer ${loginGestor.body.accessToken}`)
        .send({ nome: 'X', email: 'x@x.com', senha: 'Teste@123!', perfil: 'operador' })
        .expect(403);
    });
  });

  // ── 3. VEÍCULOS ────────────────────────────────────────────
  describe('GET /veiculos', () => {
    it('deve listar veículos do tenant com motorista ativo', async () => {
      const res = await request(BASE_URL)
        .get('/veiculos')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.dados.length).toBeGreaterThanOrEqual(3);
      expect(res.body.dados[0]).toHaveProperty('placa');
    });

    it('deve filtrar por tipo de dispositivo', async () => {
      const res = await request(BASE_URL)
        .get('/veiculos?tipoDispositivo=CAN')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.dados.every((v: any) => v.tipoDispositivo === 'CAN')).toBe(true);
    });
  });

  describe('PATCH /veiculos/:id', () => {
    it('gestor deve atualizar benchmark do veículo', async () => {
      const loginGestor = await request(BASE_URL)
        .post('/auth/login').send(GESTOR).expect(200);

      const res = await request(BASE_URL)
        .patch('/veiculos/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
        .set('Authorization', `Bearer ${loginGestor.body.accessToken}`)
        .send({ consumoReferenciaKml: 3.1, capacidadeTanqueL: 600 })
        .expect(200);

      expect(Number(res.body.consumoReferenciaKml)).toBe(3.1);
    });
  });

  // ── 4. MOTORISTAS ──────────────────────────────────────────
  describe('GET /motoristas', () => {
    it('deve listar motoristas com veículo ativo', async () => {
      const res = await request(BASE_URL)
        .get('/motoristas')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.dados.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('POST /motoristas', () => {
    it('gestor deve cadastrar motorista manualmente', async () => {
      const loginGestor = await request(BASE_URL)
        .post('/auth/login').send(GESTOR).expect(200);

      const res = await request(BASE_URL)
        .post('/motoristas')
        .set('Authorization', `Bearer ${loginGestor.body.accessToken}`)
        .send({ nome: 'Motorista Teste E2E', cpf: '12312312312', cnh: '99988877760', categoriaCnh: 'E' })
        .expect(201);

      expect(res.body.nome).toBe('Motorista Teste E2E');
    });
  });

  describe('POST /motoristas/:id/vincular', () => {
    it('deve vincular motorista ao terceiro veículo', async () => {
      const res = await request(BASE_URL)
        .post('/motoristas/ffffffff-ffff-ffff-ffff-ffffffffffff/vincular')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ veiculoId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.veiculoId).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
    });
  });

  // ── 5. LOGOUT ──────────────────────────────────────────────
  describe('POST /auth/logout', () => {
    it('deve invalidar o refresh token', async () => {
      await request(BASE_URL)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(204);

      // Tentar usar o refresh token invalidado deve falhar
      await request(BASE_URL)
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(400);
    });
  });

});
