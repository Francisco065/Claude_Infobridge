import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Veiculo }       from '../../database/entities/veiculo.entity';
import { VinculoMotoristaVeiculo } from '../../database/entities/vinculo-motorista-veiculo.entity';
import { VeiculosController }     from './veiculos.controller';
import { VeiculosService }        from './veiculos.service';

@Module({
  imports:     [TypeOrmModule.forFeature([Veiculo, VinculoMotoristaVeiculo])],
  controllers: [VeiculosController],
  providers:   [VeiculosService],
  exports:     [VeiculosService],
})
export class VeiculosModule {}
