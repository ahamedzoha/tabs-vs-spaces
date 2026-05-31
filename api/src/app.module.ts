import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VotesModule } from './votes/votes.module';
import { RabbitmqModule } from './rabbitmq/rabbitmq.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ 
  ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: '.env',
  }),
  VotesModule,
  RabbitmqModule,
  HealthModule,
  MetricsModule,
],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
