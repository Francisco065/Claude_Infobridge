import {
  IsString, IsEmail, IsEnum, IsOptional, IsBoolean,
  IsNotEmpty, MinLength, MaxLength, Matches, Length, IsArray, IsUUID,
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

  @ApiPropertyOptional({ description: 'Acesso geral a todas as telas', default: false })
  @IsOptional() @IsBoolean()
  acessoTotal?: boolean;

  @ApiPropertyOptional({ description: 'Telas liberadas (quando acessoTotal=false)', type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  telas?: string[];

  @ApiPropertyOptional({ description: 'UUID da empresa (cliente) vinculada ao usuário' })
  @IsOptional() @IsUUID()
  empresaId?: string;
}

export class AtualizarUsuarioDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(2, 200)
  nome?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: UsuarioPerfil })
  @IsOptional() @IsEnum(UsuarioPerfil)
  perfil?: UsuarioPerfil;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  ativo?: boolean;

  @ApiPropertyOptional({ description: 'Acesso geral a todas as telas' })
  @IsOptional() @IsBoolean()
  acessoTotal?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  telas?: string[];

  @ApiPropertyOptional({ description: 'UUID da empresa (cliente) vinculada ao usuário' })
  @IsOptional() @IsUUID()
  empresaId?: string;
}

export class RedefinirSenhaAdminDto {
  @ApiProperty()
  @IsString() @MinLength(8) @MaxLength(50)
  @Matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/, {
    message: 'Senha deve conter maiúscula, número e caractere especial',
  })
  novaSenha: string;
}
