import {
  IsString, IsEmail, IsEnum, IsOptional, IsBoolean,
  IsNotEmpty, MinLength, MaxLength, Matches, Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UsuarioPerfil } from '../../database/entities/enums';

export class CriarUsuarioDto {
  @ApiProperty({ example: 'Maria Souza' })
  @IsString() @IsNotEmpty() @Length(2, 200)
  nome: string;

  @ApiProperty({ example: 'maria@empresa.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ enum: UsuarioPerfil, default: UsuarioPerfil.OPERADOR })
  @IsOptional() @IsEnum(UsuarioPerfil)
  perfil?: UsuarioPerfil;

  @ApiProperty()
  @IsString() @MinLength(8) @MaxLength(50)
  @Matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/, {
    message: 'Senha deve conter maiúscula, número e caractere especial',
  })
  senha: string;
}

export class AtualizarUsuarioDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(2, 200)
  nome?: string;

  @ApiPropertyOptional({ enum: UsuarioPerfil })
  @IsOptional() @IsEnum(UsuarioPerfil)
  perfil?: UsuarioPerfil;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  ativo?: boolean;
}

export class RedefinirSenhaAdminDto {
  @ApiProperty()
  @IsString() @MinLength(8) @MaxLength(50)
  @Matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/, {
    message: 'Senha deve conter maiúscula, número e caractere especial',
  })
  novaSenha: string;
}
