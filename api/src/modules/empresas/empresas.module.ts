import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empresa }       from '../../database/entities/empresa.entity';
import { Veiculo }       from '../../database/entities/veiculo.entity';
import { EmpresasController } from './empresas.controller';
import { EmpresasService }    from './empresas.service';

@Module({
  imports:     [TypeOrmModule.forFeature([Empresa, Veiculo])],
  controllers: [EmpresasController],
  providers:   [EmpresasService],
  exports:     [EmpresasService],
})
export class EmpresasModule {}
