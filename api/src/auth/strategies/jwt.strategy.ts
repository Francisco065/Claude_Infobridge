import { Injectable }        from '@nestjs/common';
import { PassportStrategy }  from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService }     from '@nestjs/config';

export interface JwtPayload {
  sub:          string;   // userId
  tenantId:     string;
  email:        string;
  perfil:       string;
  isSuperAdmin: boolean;
  acessoTotal?: boolean;
  telas?:       string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    return {
      userId:       payload.sub,
      tenantId:     payload.tenantId,
      email:        payload.email,
      perfil:       payload.perfil,
      isSuperAdmin: payload.isSuperAdmin ?? false,
      acessoTotal:  payload.acessoTotal ?? false,
      telas:        payload.telas ?? [],
    };
  }
}
