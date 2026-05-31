import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RabbitmqService } from 'src/rabbitmq/rabbitmq.service';

@Controller('health')
export class HealthController {
    constructor(private readonly rabbitmq: RabbitmqService, private readonly config: ConfigService) {}

    @Get()
    async check() {
        const isRabbitMqHealthy = await this.rabbitmq.isConnected();

        if (!isRabbitMqHealthy) {
            throw new ServiceUnavailableException('RabbitMQ is not available');
        }

        return {
            status: 'ok',
            zone: this.config.get('ZONE'),
            timestamp: new Date().toISOString(),
            dependencies: {
                rabbitmq: isRabbitMqHealthy,
            },
        }
    }
}
