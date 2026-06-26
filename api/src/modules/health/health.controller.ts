import { Controller, Get }      from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public }                from '../../common/decorators/decorators';

/**
 * HealthController
 *
 * Endpoint público de verificação de saúde e versão do deploy.
 * O campo `build` permite confirmar qual versão do código está rodando
 * no Railway (útil para validar que um redeploy realmente aconteceu).
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Verificação de saúde e versão do deploy' })
  health() {
    return {
      status: 'ok',
      build: '2026-06-26-indicadores-injectrepository',
      timestamp: new Date().toISOString(),
    };
  }
}
