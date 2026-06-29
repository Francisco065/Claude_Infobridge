import {
  Injectable, UnauthorizedException, BadRequestException, Logger,
} from '@nestjs/common';
import { InjectDataSource }  from '@nestjs/typeorm';
import { DataSource }        from 'typeorm';
import { JwtService }        from '@nestjs/jwt';
import { ConfigService }     from '@nestjs/config';
import { InjectQueue }       from '@nestjs/bull';
import { Queue }             from 'bull';
import * as bcrypt           from 'bcrypt';
import { randomBytes }       from 'crypto';
import { createClient }      from 'redis';

import { Usuario }                from '../database/entities/usuario.entity';
import {
  CredenciaisInvalidasException,
  TokenInvalidoException,
  UsuarioNaoEncontradoException,
} from '../common/filters/http-exception.filter';
import {
  LoginDto, RefreshTokenDto, AlterarSenhaDto,
  SolicitarResetSenhaDto, ConfirmarResetSenhaDto,
} from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private redisClient: ReturnType<typeof createClient> | null = null;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ── Redis (lazy singleton) ────────────────────────────────
  private async redis() {
    if (!this.redisClient || !this.redisClient.isOpen) {
      this.redisClient = createClient({ url: this.config.get('REDIS_URL') });
      await this.redisClient.connect();
    }
    return this.redisClient;
  }

  // ── Login ─────────────────────────────────────────────────
  async login(dto: LoginDto) {
    const usuario = await this.db.getRepository(Usuario).findOne({
      where:     { email: dto.email.toLowerCase().trim(), ativo: true },
      relations: ['tenant'],
    });
    if (!usuario) throw new CredenciaisInvalidasException();

    const ok = await bcrypt.compare(dto.senha, usuario.senhaHash);
    if (!ok) throw new CredenciaisInvalidasException();

    await this.db.getRepository(Usuario).update(usuario.id, { ultimoLogin: new Date() });
    const tokens = await this._tokens(usuario);
    this.logger.log(`Login: ${usuario.email}`);

    return {
      ...tokens,
      usuario: {
        id: usuario.id, nome: usuario.nome, email: usuario.email,
        perfil: usuario.perfil, tenantId: usuario.tenantId,
        acessoTotal: usuario.acessoTotal, telas: usuario.telas ?? [],
        tenant: { id: usuario.tenant?.id, nome: usuario.tenant?.nome },
      },
    };
  }

  // ── Refresh ───────────────────────────────────────────────
  async refresh(dto: RefreshTokenDto) {
    let payload: any;
    try { payload = await this.jwt.verifyAsync(dto.refreshToken); }
    catch { throw new TokenInvalidoException(); }

    const r = await this.redis();
    if (await r.get(`refresh:blacklist:${dto.refreshToken}`)) throw new TokenInvalidoException();

    const usuario = await this.db.getRepository(Usuario).findOne({ where: { id: payload.sub, ativo: true } });
    if (!usuario) throw new UnauthorizedException('Usuário inativo');
    return this._tokens(usuario);
  }

  // ── Logout ────────────────────────────────────────────────
  async logout(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync(refreshToken);
      const ttl = (payload.exp ?? 0) - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        const r = await this.redis();
        await r.setEx(`refresh:blacklist:${refreshToken}`, ttl, '1');
      }
    } catch { /* já expirado */ }
  }

  // ── Alterar Senha ─────────────────────────────────────────
  async alterarSenha(userId: string, dto: AlterarSenhaDto) {
    const u = await this.db.getRepository(Usuario).findOne({ where: { id: userId, ativo: true } });
    if (!u) throw new UsuarioNaoEncontradoException(userId);
    if (!await bcrypt.compare(dto.senhaAtual, u.senhaHash))
      throw new BadRequestException('Senha atual incorreta');
    if (dto.senhaAtual === dto.novaSenha)
      throw new BadRequestException('Nova senha deve ser diferente da atual');
    await this.db.getRepository(Usuario).update(userId, { senhaHash: await bcrypt.hash(dto.novaSenha, BCRYPT_ROUNDS) });
  }

  // ── Reset de Senha ────────────────────────────────────────
  async solicitarResetSenha(dto: SolicitarResetSenhaDto) {
    const u = await this.db.getRepository(Usuario).findOne({ where: { email: dto.email.toLowerCase(), ativo: true } });
    if (!u) return; // não revelar se e-mail existe
    const token = randomBytes(32).toString('hex');
    const r = await this.redis();
    await r.setEx(`reset:${token}`, 3600, JSON.stringify({ userId: u.id }));
    this.logger.log(`Reset solicitado: ${u.email} token=${token}`);
    // TODO: disparar e-mail
  }

  async confirmarResetSenha(dto: ConfirmarResetSenhaDto) {
    const r    = await this.redis();
    const raw  = await r.get(`reset:${dto.token}`);
    if (!raw) throw new TokenInvalidoException();
    const { userId } = JSON.parse(raw);
    await this.db.getRepository(Usuario).update(userId, { senhaHash: await bcrypt.hash(dto.novaSenha, BCRYPT_ROUNDS) });
    await r.del(`reset:${dto.token}`);
  }

  // ── Me ────────────────────────────────────────────────────
  async me(userId: string) {
    const u = await this.db.getRepository(Usuario).findOne({
      where: { id: userId, ativo: true }, relations: ['tenant'],
    });
    if (!u) throw new UsuarioNaoEncontradoException(userId);
    const { senhaHash, ...rest } = u;
    return rest;
  }

  // ── Helpers ───────────────────────────────────────────────
  async hashSenha(senha: string) { return bcrypt.hash(senha, BCRYPT_ROUNDS); }

  private async _tokens(usuario: Usuario) {
    const payload = {
      sub: usuario.id, tenantId: usuario.tenantId,
      email: usuario.email, perfil: usuario.perfil, isSuperAdmin: false,
      nome: usuario.nome,
      acessoTotal: usuario.acessoTotal, telas: usuario.telas ?? [],
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, { expiresIn: this.config.get('JWT_EXPIRATION', '8h') }),
      this.jwt.signAsync(payload, { expiresIn: this.config.get('JWT_REFRESH_EXPIRATION', '7d') }),
    ]);
    return { accessToken, refreshToken };
  }
}
