import { Global, Module } from '@nestjs/common';
import { RabbitmqService } from './rabbitmq.service';

@Global() // Make the module available globally to all other modules
@Module({
  providers: [RabbitmqService],
  exports: [RabbitmqService],
})
export class RabbitmqModule {}
