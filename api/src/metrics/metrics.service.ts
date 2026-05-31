import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram, register } from 'prom-client';

@Injectable()
export class MetricsService {
    public readonly voteCounter: Counter;
    public readonly httpDuration: Histogram;

    constructor(private config: ConfigService) {
        const zone = this.config.get('ZONE') || 'unknown';

        this.voteCounter  = new Counter({
            name: 'votes_ingested_total',
            help: 'Total votes ingested',
            labelNames: ['choice', 'zone'],
        });

        //http request duration metrics
        this.httpDuration = new Histogram({
            name: 'http_request_duration_ms',
            help: 'Duration of HTTP requests in milliseconds',
            labelNames: ['method', 'route', 'status_code'],
            buckets: [1, 5, 10, 50, 100, 500, 1000],
        });
    }

    async getMetrics() : Promise<string> {
        return await register.metrics();
    }
}
