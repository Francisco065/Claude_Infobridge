import {
  Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService }                           from './auth.service';
import { Public }                                from '../common/decorators/decorators';
import { CurrentUser, UserId }                   from '../common/decorators/decorators';
import {
  LoginDto, RefreshTokenDto, AlterarSenhaDto,
  SolicitarResetSenhaDto, ConfirmarResetSenhaDto,
} from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login — retorna access + refresh token' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renova access token via refresh token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Public()
  @Post('solicitar-reset-senha')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Solicita e-mail de reset de senha' })
  solicitarReset(@Body() dto: SolicitarResetSenhaDto) {
    return this.authService.solicitarResetSenha(dto);
  }

  @Public()
  @Post('confirmar-reset-senha')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Redefine senha com token do e-mail' })
  confirmarReset(@Body() dto: ConfirmarResetSenhaDto) {
    return this.authService.confirmarResetSenha(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil do usuário autenticado' })
  me(@UserId() userId: string) {
    return this.authService.me(userId);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invalida o refresh token' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Post('alterar-senha')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Altera a senha do usuário autenticado' })
  alterarSenha(@UserId() userId: string, @Body() dto: AlterarSenhaDto) {
    return this.authService.alterarSenha(userId, dto);
  }
}
