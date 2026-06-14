import {
  IsEmail, IsString, IsNotEmpty, MinLength, MaxLength, Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// ── Login ─────────────────────────────────────────────────────

export class LoginDto {
  @ApiProperty({ example: 'motorista@empresa.com.br' })
  @IsEmail({}, { message: 'E-mail inválido' })
  email: string;

  @ApiProperty({ example: 'SenhaSegura@123' })
  @IsString()
  @IsNotEmpty({ message: 'Senha é obrigatória' })
  senha: string;
}

// ── Refresh Token ─────────────────────────────────────────────

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token recebido no login' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

// ── Alterar Senha (usuário autenticado) ───────────────────────

export class AlterarSenhaDto {
  @ApiProperty({ description: 'Senha atual do usuário' })
  @IsString()
  @IsNotEmpty()
  senhaAtual: string;

  @ApiProperty({ description: 'Nova senha (mín. 8 chars, 1 maiúscula, 1 número, 1 especial)' })
  @IsString()
  @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
  @MaxLength(50)
  @Matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/, {
    message: 'Senha deve conter pelo menos 1 letra maiúscula, 1 número e 1 caractere especial',
  })
  novaSenha: string;
}

// ── Solicitar Reset de Senha ──────────────────────────────────

export class SolicitarResetSenhaDto {
  @ApiProperty({ example: 'usuario@empresa.com' })
  @IsEmail()
  email: string;
}

// ── Confirmar Reset de Senha ──────────────────────────────────

export class ConfirmarResetSenhaDto {
  @ApiProperty({ description: 'Token recebido por e-mail' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(50)
  @Matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/, {
    message: 'Senha deve conter pelo menos 1 maiúscula, 1 número e 1 especial',
  })
  novaSenha: string;
}
