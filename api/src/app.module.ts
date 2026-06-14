import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService }            from '@nestjs/config';
import { TypeOrmModule }                          from '@nestjs/typeorm';
import { BullModule }                             from '@nestjs/bull';
import { APP_GUARD, APP_FILTER }                  from '@nestjs/core';

import { TenantMiddleware }    from './common/middleware/tenant.middleware';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard }        from './common/guards/jwt-auth.guard';
import { RolesGuard }          from './common/guards/jwt-auth.guard';
import { ALL_ENTITIES }        from './database/entities';

import { AuthModule }       from './auth/auth.module';
import { TenantsModule }    from './modules/tenants/tenants.module';
import { UsuariosModule }   from './modules/usuarios/usuarios.module';
import { VeiculosModule }   from './modules/veiculos/veiculos.module';
import { MotoristasModule } from './modules/motoristas/motoristas.module';
import { TelemetriaModule } from './modules/telemetria/telemetria.module';
import { IndicadoresModule } from './modules/indicadores/indicadores.module';
import { PontuacaoModule }  from './modules/pontuacao/pontuacao.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    TypeOrmModule.forRootAsync({
      imports:    [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type:        'postgres',
        url:         config.get<string>('DATABASE_URL'),
        entities:    ALL_ENTITIES,
        synchronize: false,
        logging:     config.get('NODE_ENV') === 'development' ? ['query', 'error'] : ['error'],
        extra:       { max: 20, idleTimeoutMillis: 30000 },
      }),
      inject: [ConfigService],
    }),

    BullModule.forRootAsync({
      imports:    [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host:     config.get('REDIS_HOST', 'localhost'),
          port:     config.get<number>('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD'),
        },
        defaultJobOptions: {
          attempts: 3, backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100, removeOnFail: 50,
        },
      }),
      inject: [ConfigService],
    }),

    AuthModule,
    TenantsModule,
    UsuariosModule,
    VeiculosModule,
    MotoristasModule,
    TelemetriaModule,
    IndicadoresModule,
    PontuacaoModule,
  ],
  providers: [
    { provide: APP_GUARD,  useClass: JwtAuthGuard },
    { provide: APP_GUARD,  useClass: RolesGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .exclude('/api/v1/auth/(.*)', '/health')
      .forRoutes('*');
  }
}
