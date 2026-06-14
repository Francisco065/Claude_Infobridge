import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IndicadorPeriodo }      from '../../database/entities/indicador-periodo.entity';
import { IndicadoresController } from './indicadores.controller';
import { IndicadoresService }    from './indicadores.service';

@Module({
  imports:     [TypeOrmModule.forFeature([IndicadorPeriodo])],
  controllers: [IndicadoresController],
  providers:   [IndicadoresService],
  exports:     [IndicadoresService],
})
export class IndicadoresModule {}
