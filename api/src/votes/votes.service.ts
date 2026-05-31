import { Injectable, Logger } from '@nestjs/common';
import { RabbitmqService } from 'src/rabbitmq/rabbitmq.service';
import { VoteDto } from './dto/vote.dto';
import { MetricsService } from 'src/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class VotesService {
    private readonly logger = new Logger(VotesService.name);
    private readonly zone : string;

    constructor(
        private readonly rabbitmq: RabbitmqService, 
        private readonly metrics: MetricsService,
        private readonly config: ConfigService
    ) {
        this.zone = this.config.get('ZONE') || 'unknown';
    }

    async ingestVote(voteDto: VoteDto) : Promise<{
        status: string;
        queued_at: string;
    }> {
        const start = Date.now()

        //Publish to RabbitMQ
        await this.rabbitmq.publish('votes.exchange', 'vote.cast', {
            ...voteDto,
            zone: this.zone,
            timestamp: new Date().toISOString(),
        });

        this.metrics.voteCounter.inc({ choice: voteDto.choice, zone: this.zone });

        const duration = Date.now() - start;

        this.logger.debug(`Ingested vote in ${duration}ms`);

        return {
            status: 'accepted',
            queued_at: new Date().toISOString(),
        }

    }
}
