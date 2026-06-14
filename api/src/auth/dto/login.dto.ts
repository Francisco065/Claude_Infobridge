import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'motorista@empresa.com.br' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SenhaSegura123!' })
  @IsString()
  @MinLength(6)
  senha: string;
}
