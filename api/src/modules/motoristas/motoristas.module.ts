import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Motorista }     from '../../database/entities/motorista.entity';
import { Veiculo }       from '../../database/entities/veiculo.entity';
import { VinculoMotoristaVeiculo } from '../../database/entities/vinculo-motorista-veiculo.entity';
import { MotoristasController }   from './motoristas.controller';
import { MotoristasService }      from './motoristas.service';

@Module({
  imports:     [TypeOrmModule.forFeature([Motorista, Veiculo, VinculoMotoristaVeiculo])],
  controllers: [MotoristasController],
  providers:   [MotoristasService],
  exports:     [MotoristasService],
})
export class MotoristasModule {}
