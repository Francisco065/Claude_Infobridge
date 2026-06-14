import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant }        from '../../database/entities/tenant.entity';
import { Usuario }       from '../../database/entities/usuario.entity';
import { CredencialIntegracao } from '../../database/entities/credencial-integracao.entity';
import { TenantsController }   from './tenants.controller';
import { TenantsService }      from './tenants.service';

@Module({
  imports:     [TypeOrmModule.forFeature([Tenant, Usuario, CredencialIntegracao])],
  controllers: [TenantsController],
  providers:   [TenantsService],
  exports:     [TenantsService],
})
export class TenantsModule {}
