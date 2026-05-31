import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import amqp, { type AmqpConnectionManager, type ChannelWrapper, type Channel } from 'amqp-connection-manager';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RabbitmqService.name);
    private connection!: AmqpConnectionManager;
    private channelWrapper?: ChannelWrapper;

    constructor(private readonly configService: ConfigService) {}

    async onModuleInit() {
        const rabbitMqUrl = this.configService.get<string>('RABBITMQ_URL') as string;

        // Create connection with automatic reconnection
        this.connection = amqp.connect([rabbitMqUrl], {
            heartbeatIntervalInSeconds: 5,
            reconnectTimeInSeconds: 5,
          });

          this.connection.on('connect', () => {
            this.logger.log('Connected to RabbitMQ');
          })

          this.connection.on('disconnect', () => {
            this.logger.log('Disconnected from RabbitMQ');
          })

          //Create channel wrapper
          this.channelWrapper = this.connection.createChannel({
            json: true,
            setup : async (channel: Channel) => {
                // Declare exchange
                await channel.assertExchange('votes.exchange', 'topic', { durable: true });

                // Declare queue
                await channel.assertQueue('votes.queue', { durable: true });

                // Bind queue to exchange
                await channel.bindQueue('votes.queue', 'votes.exchange', 'vote.cast');

                this.logger.log('RabbitMQ channel setup complete');
            }
          })
    }

    async publish(exchange: string, routingKey: string, message: any) : Promise<void> {
        try {
            await this.channelWrapper?.publish(exchange, routingKey, message, {
                persistent: true,
                timestamp: Date.now(),
            })

            this.logger.debug(`Published message to ${exchange} with routing key ${routingKey}`);
        } catch (error) {
            this.logger.error('Failed to publish message to RabbitMQ', error);
            throw error;
        }
    }

    async isConnected() : Promise<boolean> {
        return this.connection.isConnected();
    }



    async onModuleDestroy() {
        await this.channelWrapper?.close();
        await this.connection?.close();
        this.logger.log('RabbitMQ connection closed');
    }

}
