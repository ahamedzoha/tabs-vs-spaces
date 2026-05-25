# Tabs vs Spaces

**Project codename:** `tabs-vs-spaces`  
**Purpose:** A hands-on laboratory for distributed systems, load balancing, asynchronous processing, and chaos engineering—without the overhead of complex business logic.

> **Document version:** 1.0 · **Last updated:** May 25, 2026 · **Maintained by:** Zoha Rahman

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Learning Objectives](#2-learning-objectives)
3. [System Architecture](#3-system-architecture)
4. [Infrastructure Topology](#4-infrastructure-topology)
5. [Technology Stack](#5-technology-stack)
6. [Repository Structure](#6-repository-structure)
7. [Component Design](#7-component-design)
8. [Networking Strategy](#8-networking-strategy)
9. [Data Flow & Message Processing](#9-data-flow--message-processing)
10. [Database Design & Partitioning](#10-database-design--partitioning)
11. [Load Balancing & Health Checks](#11-load-balancing--health-checks)
12. [Observability & Telemetry](#12-observability--telemetry)
13. [Chaos Engineering Tests](#13-chaos-engineering-tests)
14. [Implementation Roadmap](#14-implementation-roadmap)
15. [Future Expansions](#15-future-expansions)
16. [Troubleshooting Guide](#16-troubleshooting-guide)
17. [References & Further Reading](#17-references--further-reading)
18. [Appendices](#appendices)

---

## 1. Executive Summary

### What We're Building

A globally distributed (simulated) voting application where users vote for **Tabs** or **Spaces** in an infinite clicker war. The application generates massive write-heavy throughput, making it ideal for stress-testing distributed system concepts.

### Why This Matters

Reading about load balancers, message queues, and database partitioning is theoretical. **This project forces you to:**

- Wire up actual distributed components
- Watch them fail under load
- Debug cross-machine networking issues
- Measure performance with real metrics
- Practice patterns from system design interviews (e.g. Alex Xu, Chapter 3)

### The Core Innovation

By splitting compute across **Proxmox LXC containers** and your **MacBook**, connected via Twingate, you simulate a true multi–Availability Zone (AZ) architecture. When your MacBook disconnects (simulating an AZ failure), the system continues processing without dropping requests.

---

## 2. Learning Objectives

### Primary Skills

| Skill domain | What you'll practice | Interview relevance |
| --- | --- | --- |
| **Load balancing** | Nginx upstream configuration, health checks, failover detection | "How would you handle traffic spikes?" |
| **Stateless design** | APIs with zero local state, session externalization | "How do you scale horizontally?" |
| **Async processing** | Producer–consumer patterns, message acknowledgments | "How do you handle slow operations?" |
| **Database optimization** | Table partitioning, index strategies, connection pooling | "How do you handle write-heavy workloads?" |
| **Chaos engineering** | Simulating failures, measuring recovery time | "What happens if a server goes down?" |
| **Observability** | Metrics collection, log aggregation, alerting | "How do you debug production issues?" |

### System Design Concepts Covered

- **Horizontal scaling** — Multiple identical API instances
- **Vertical partitioning** — Separate read/write workloads
- **Competing consumers** — Multiple workers on one queue
- **Circuit breaking** — Nginx automatic failover
- **Idempotency** — Handle duplicate messages gracefully
- **CAP theorem** — Observe consistency vs. availability trade-offs

---

## 3. System Architecture

### High-Level Design

```mermaid
flowchart TB
    subgraph client["Client"]
        Browser["Browser"]
    end

    subgraph edge["Edge - LXC1"]
        Nginx["Nginx<br/>Load Balancer"]
    end

    subgraph compute["Stateless compute"]
        API_A["API<br/>Zone A · LXC2"]
        API_B["API<br/>Zone B · MacBook"]
    end

    subgraph control["Control plane - LXC1"]
        RMQ["RabbitMQ"]
        PG[("PostgreSQL")]
        Redis[("Redis")]
    end

    subgraph workers["Workers"]
        W1["Worker · LXC3"]
        W2["Worker · LXC4"]
    end

    Browser -->|HTTPS| Nginx
    Nginx --> API_A
    Nginx --> API_B
    API_A -->|Publish| RMQ
    API_B -->|Publish| RMQ
    RMQ --> W1
    RMQ --> W2
    W1 -->|Batch insert| PG
    W2 -->|Batch insert| PG
    W1 -->|Counters| Redis
    W2 -->|Counters| Redis
```

### Design Decisions & Rationale

#### Why separate API from workers?

| Problem | Solution | Interview answer |
| --- | --- | --- |
| PostgreSQL INSERT is slow (10–50 ms) | API returns **202 Accepted** in under 5 ms and enqueues work | "We decouple fast request handling from slow I/O to keep sub-10 ms responses under load." |
| API waiting on DB caps at ~20–100 req/s per instance | Workers batch-insert 100 votes → 10,000+ writes/s | |

#### Why two workers?

A single worker bottlenecks when RabbitMQ fills faster than it drains. Multiple workers compete for messages; RabbitMQ distributes with round-robin delivery.

#### Why keep all state on LXC1?

If PostgreSQL and RabbitMQ run on your MacBook, disconnecting risks data loss. The **control plane** stays on always-on Proxmox; **stateless compute** (API/workers) can fail freely.

---

## 4. Infrastructure Topology

### Physical Layout

| Component | Location | IP address | Role | Failure impact |
| --- | --- | --- | --- | --- |
| **LXC1** | Proxmox | `192.168.1.5` | Control plane | Critical — entire system down |
| **LXC2** | Proxmox | `192.168.1.10` | API Zone A | Graceful — traffic shifts to MacBook |
| **LXC3** | Proxmox | `192.168.1.15` | Worker 1 | Graceful — LXC4 continues |
| **LXC4** | Proxmox | `192.168.1.16` | Worker 2 | Graceful — LXC3 continues |
| **MacBook** | Laptop | `192.168.1.20` | API Zone B + frontend | Graceful — traffic shifts to LXC2 |

### Network Topology

```mermaid
flowchart LR
    subgraph proxmox["Proxmox · 192.168.1.0/24"]
        LXC1["LXC1 · .5<br/>Nginx · PG · RMQ · Redis"]
        LXC2["LXC2 · .10<br/>API Zone A"]
        LXC3["LXC3 · .15<br/>Worker 1"]
        LXC4["LXC4 · .16<br/>Worker 2"]
    end

    Mac["MacBook · .20<br/>API Zone B · Next.js"]

    LXC2 --> LXC1
    LXC3 --> LXC1
    LXC4 --> LXC1
    Mac --> LXC1
    Internet["Clients"] --> LXC1
```

### Network Requirements

- **Same subnet:** All devices on `192.168.1.0/24` (or bridged via Twingate)
- **Open ports:**

| Port | Service | Exposure |
| --- | --- | --- |
| 80 / 443 | Nginx HTTP/HTTPS | Public |
| 3000 | API instances | Internal |
| 5432 | PostgreSQL | Internal only |
| 5672 | RabbitMQ AMQP | Internal |
| 15672 | RabbitMQ Management UI | Internal |
| 6379 | Redis | Internal only |

### LXC Container Specifications

```bash
# LXC1 (Control Plane) — needs more resources
CPU: 4 cores | RAM: 4 GB | Storage: 20 GB

# LXC2, LXC3, LXC4 (Compute) — lightweight
CPU: 2 cores | RAM: 2 GB | Storage: 10 GB
```

---

## 5. Technology Stack

### Core Services

| Service | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Load balancer | Nginx | 1.25+ | L7 routing, health checks, TLS termination |
| API framework | NestJS | 10.x | Stateless HTTP server with DI |
| Message broker | RabbitMQ | 3.13 | Durable queue with acknowledgments |
| Database | PostgreSQL | 16.x | ACID storage with partitioning |
| Cache | Redis | 7.2 | In-memory counters and rate limiting |
| Frontend | Next.js | 14.x | SSR, real-time updates |
| Container runtime | Docker | 24.x | Consistent deployments |

### Development Tools

| Tool | Purpose |
| --- | --- |
| **k6** | Load testing and benchmarking |
| **Artillery** | Scenario-based load testing |
| **Prometheus** | Metrics collection |
| **Grafana** | Dashboards and alerting |
| **pgAdmin** | PostgreSQL management |
| **WSL2** | Local development (Windows) |

---

## 6. Repository Structure

```
tabs-vs-spaces/
├── frontend/                   # Next.js application
│   ├── src/
│   │   ├── app/               # App router pages
│   │   ├── components/        # React components
│   │   └── lib/               # SSE client, API helpers
│   ├── public/
│   ├── package.json
│   └── Dockerfile
│
├── api/                        # NestJS API
│   ├── src/
│   │   ├── votes/
│   │   ├── health/
│   │   ├── metrics/
│   │   └── main.ts
│   ├── test/
│   ├── package.json
│   └── Dockerfile
│
├── worker/                     # Background consumer
│   ├── src/
│   │   ├── consumer.ts
│   │   ├── database.ts
│   │   └── main.ts
│   ├── package.json
│   └── Dockerfile
│
├── infra/
│   ├── nginx/
│   ├── sql/
│   ├── k6/
│   ├── prometheus/
│   └── grafana/
│
├── .github/workflows/
├── docker-compose.yml
├── docker-compose.prod.yml
├── README.md                   # This document
└── ARCHITECTURE.md             # Optional deep-dive copy
```

### Key Design Principles

1. **Isolation** — Each service has its own `package.json`; no shared code packages.
2. **Containerization** — Every service ships with a `Dockerfile`.
3. **Configuration as code** — Nginx, SQL, and load tests live under `infra/`.
4. **Single source of truth** — One Git repository, no submodules.

---

## 7. Component Design

### 7.1 API Service (Ingestion Layer)

**File:** `api/src/votes/votes.controller.ts`

```typescript
import { Controller, Post, Body, HttpCode, Logger, BadRequestException } from '@nestjs/common';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { VoteDto } from './dto/vote.dto';
import { voteCounter } from '../metrics/metrics.service';

@Controller('votes')
export class VotesController {
  private readonly logger = new Logger(VotesController.name);

  constructor(private readonly rabbitmq: RabbitMQService) {}

  @Post()
  @HttpCode(202)
  async ingest(@Body() voteDto: VoteDto) {
    const start = Date.now();

    if (!['tabs', 'spaces'].includes(voteDto.choice)) {
      throw new BadRequestException('Invalid choice');
    }

    await this.rabbitmq.publish('votes.exchange', 'vote.cast', voteDto);

    voteCounter.inc({
      choice: voteDto.choice,
      zone: process.env.ZONE || 'unknown',
    });

    const duration = Date.now() - start;
    this.logger.debug(`Ingested vote in ${duration}ms`);

    return { status: 'accepted', queued_at: new Date().toISOString() };
  }
}
```

| Characteristic | Description |
| --- | --- |
| **Stateless** | No local state between requests |
| **Fast** | Under 10 ms by avoiding database I/O |
| **Idempotent-ready** | `user_id` on each vote for future deduplication |

**Environment variables:**

```bash
RABBITMQ_URL=amqp://192.168.1.5:5672
ZONE=lxc2          # or macbook
PORT=3000
```

---

### 7.2 Worker Service (Consumer Layer)

**File:** `worker/src/consumer.ts`

```typescript
import amqp from 'amqplib';
import { Pool } from 'pg';
import Redis from 'ioredis';

const BATCH_SIZE = 100;
const BATCH_TIMEOUT = 1000; // 1 second

class VoteWorker {
  private voteBatch: Vote[] = [];
  private batchTimer: NodeJS.Timeout | null = null;

  constructor(
    private channel: amqp.Channel,
    private db: Pool,
    private redis: Redis,
  ) {}

  async start() {
    await this.channel.assertQueue('votes.queue', { durable: true });
    this.channel.prefetch(BATCH_SIZE);

    this.channel.consume('votes.queue', async (msg) => {
      if (!msg) return;

      const vote = JSON.parse(msg.content.toString());
      this.voteBatch.push(vote);
      this.channel.ack(msg);

      if (this.voteBatch.length >= BATCH_SIZE) {
        await this.flushBatch();
      } else {
        this.resetBatchTimer();
      }
    });
  }

  private resetBatchTimer() {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(() => this.flushBatch(), BATCH_TIMEOUT);
  }

  private async flushBatch() {
    if (this.voteBatch.length === 0) return;

    const batch = [...this.voteBatch];
    this.voteBatch = [];

    const values = batch
      .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
      .join(',');

    const params = batch.flatMap((v) => [v.choice, v.user_id, v.timestamp]);

    await this.db.query(
      `INSERT INTO votes (choice, user_id, created_at) VALUES ${values}`,
      params,
    );

    const tabsCount = batch.filter((v) => v.choice === 'tabs').length;
    const spacesCount = batch.filter((v) => v.choice === 'spaces').length;

    await Promise.all([
      this.redis.incrby('votes:tabs', tabsCount),
      this.redis.incrby('votes:spaces', spacesCount),
    ]);

    console.log(`Flushed ${batch.length} votes to database`);
  }
}
```

| Detail | Behavior |
| --- | --- |
| **Batching** | Up to 100 votes per flush |
| **Timeout** | Flush partial batch after 1 s |
| **ACK timing** | ACK after in-memory batch (not after DB) — higher throughput, crash risk |
| **Redis** | Counters updated with DB flush |

**Trade-off:** Early ACK can lose messages if the worker crashes between ACK and DB write. Acceptable for voting; use late ACK + idempotency for financial workloads.

---

### 7.3 Frontend (Visualization Layer)

**Vote UI:** `frontend/src/app/page.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';

export default function VotingPage() {
  const [votes, setVotes] = useState({ tabs: 0, spaces: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource('/api/stream');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setVotes(data);
    };

    return () => eventSource.close();
  }, []);

  const handleVote = async (choice: 'tabs' | 'spaces') => {
    setLoading(true);

    await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        choice,
        user_id: crypto.randomUUID(),
      }),
    });

    setLoading(false);
  };

  const total = votes.tabs + votes.spaces;
  const tabsPercent = total ? (votes.tabs / total) * 100 : 50;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
      {/* Progress bar + Tabs / Spaces buttons */}
    </div>
  );
}
```

**SSE stream:** `frontend/src/app/api/stream/route.ts`

```typescript
import Redis from 'ioredis';

export async function GET() {
  const redis = new Redis(process.env.REDIS_URL);

  const stream = new ReadableStream({
    async start(controller) {
      const sendUpdate = async () => {
        const [tabs, spaces] = await Promise.all([
          redis.get('votes:tabs'),
          redis.get('votes:spaces'),
        ]);

        controller.enqueue(
          `data: ${JSON.stringify({
            tabs: parseInt(tabs || '0'),
            spaces: parseInt(spaces || '0'),
          })}\n\n`,
        );
      };

      await sendUpdate();
      const interval = setInterval(sendUpdate, 500);

      return () => clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
```

**Real-time strategy:** SSE polls Redis every 500 ms—sub-second latency without WebSocket complexity.

---

## 8. Networking Strategy

### 8.1 Docker Networking (Local)

**File:** `docker-compose.yml`

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: votes
      POSTGRES_USER: voteuser
      POSTGRES_PASSWORD: votepass
    networks:
      - control-plane
    ports:
      - '5432:5432'

  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: secret
    networks:
      - control-plane
    ports:
      - '5672:5672'
      - '15672:15672'

  redis:
    image: redis:7.2-alpine
    networks:
      - control-plane
    ports:
      - '6379:6379'

  api:
    build: ./api
    environment:
      RABBITMQ_URL: amqp://admin:secret@rabbitmq:5672
      ZONE: local
    networks:
      - control-plane
    ports:
      - '3000:3000'
    depends_on:
      - rabbitmq

  worker:
    build: ./worker
    environment:
      RABBITMQ_URL: amqp://admin:secret@rabbitmq:5672
      DATABASE_URL: postgresql://voteuser:votepass@postgres:5432/votes
      REDIS_URL: redis://redis:6379
    networks:
      - control-plane
    depends_on:
      - rabbitmq
      - postgres
      - redis

networks:
  control-plane:
    driver: bridge
```

**Production:** Services run on separate machines—no shared Docker networks. LXC1 exposes stateful ports; compute nodes use host IPs.

**Cross-machine environment variables:**

```bash
# api/.env (LXC2 & MacBook)
RABBITMQ_URL=amqp://admin:secret@192.168.1.5:5672
ZONE=lxc2   # or macbook

# worker/.env (LXC3 & LXC4)
RABBITMQ_URL=amqp://admin:secret@192.168.1.5:5672
DATABASE_URL=postgresql://voteuser:votepass@192.168.1.5:5432/votes
REDIS_URL=redis://192.168.1.5:6379
```

---

### 8.2 Nginx Configuration

**File:** `infra/nginx/upstreams.conf`

```nginx
upstream api_backend {
    server 192.168.1.10:3000 max_fails=2 fail_timeout=5s;  # Zone A
    server 192.168.1.20:3000 max_fails=2 fail_timeout=5s;  # Zone B
    keepalive 32;
}
```

**File:** `infra/nginx/nginx.conf` (excerpt)

```nginx
events {
    worker_connections 2048;
}

http {
    include upstreams.conf;

    access_log /var/log/nginx/access.log combined;
    error_log  /var/log/nginx/error.log warn;

    server {
        listen 80;
        server_name tabs-vs-spaces.local;

        location /nginx-health {
            access_log off;
            return 200 "OK\n";
            add_header Content-Type text/plain;
        }

        location /api/ {
            proxy_pass http://api_backend;
            proxy_next_upstream error timeout http_502 http_503 http_504;

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Zone-Hit $upstream_addr;

            proxy_connect_timeout 2s;
            proxy_send_timeout    5s;
            proxy_read_timeout    5s;
        }

        location / {
            proxy_pass http://192.168.1.20:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_cache_bypass $http_upgrade;
        }
    }
}
```

| Directive | Effect |
| --- | --- |
| `proxy_next_upstream` | Retry next backend on 502/503/504 |
| `max_fails=2` | Mark down after 2 failures |
| `fail_timeout=5s` | Retry failed server after 5 s |
| `X-Zone-Hit` | Log which backend served the request |

---

### 8.3 Health Check Endpoints

**File:** `api/src/health/health.controller.ts`

```typescript
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

@Controller('health')
export class HealthController {
  constructor(private readonly rabbitmq: RabbitMQService) {}

  @Get()
  async check() {
    const queueHealthy = await this.rabbitmq.isConnected();

    if (!queueHealthy) {
      throw new ServiceUnavailableException('RabbitMQ unavailable');
    }

    return {
      status: 'ok',
      zone: process.env.ZONE,
      timestamp: new Date().toISOString(),
    };
  }
}
```

If RabbitMQ is down, the API reports unhealthy so Nginx can stop routing traffic to that instance.

---

## 9. Data Flow & Message Processing

### Request Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Nginx
    participant API
    participant RabbitMQ
    participant Worker
    participant PostgreSQL
    participant Redis
    participant SSE as Frontend SSE

    User->>Nginx: POST /api/vote
    Nginx->>API: Round-robin route
    API->>API: Validate payload
    API->>RabbitMQ: Publish vote.cast
    API-->>User: 202 Accepted (under 10ms)

    RabbitMQ->>Worker: Deliver message
    Worker->>Worker: Add to batch · ACK
    Note over Worker: Flush at 100 votes or 1 s
    Worker->>PostgreSQL: Batch INSERT
    Worker->>Redis: INCRBY counters

    loop Every 500 ms
        SSE->>Redis: GET votes:tabs / votes:spaces
        Redis-->>SSE: Counts
        SSE-->>User: SSE event
    end
```

### Message Acknowledgment Strategies

```mermaid
flowchart LR
    subgraph early["Early ACK (voting app)"]
        E1[Receive] --> E2[Batch in memory]
        E2 --> E3[ACK immediately]
        E3 --> E4[Flush to DB]
    end

    subgraph late["Late ACK (payments)"]
        L1[Receive] --> L2[Batch in memory]
        L2 --> L3[Flush to DB]
        L3 --> L4[ACK after commit]
    end
```

| Strategy | Pros | Cons |
| --- | --- | --- |
| **Early ACK** | Higher throughput; simpler errors | Loss if worker crashes before DB write |
| **Late ACK** | Redelivery on crash | Lower throughput; needs idempotency |

**Interview insight:** For voting, prioritize throughput. For payments, use late ACK with idempotency keys.

### RabbitMQ Exchange & Queue Setup

**File:** `api/src/rabbitmq/rabbitmq.module.ts`

```typescript
async onModuleInit() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange('votes.exchange', 'topic', { durable: true });
  await channel.assertQueue('votes.queue', { durable: true });
  await channel.bindQueue('votes.queue', 'votes.exchange', 'vote.cast');

  this.channel = channel;
}
```

**Topic routing keys (future):**

| Routing key | Purpose |
| --- | --- |
| `vote.cast` | Current voting |
| `vote.undo` | Cancel vote (future) |
| `vote.audit` | Separate audit queue (future) |

---

## 10. Database Design & Partitioning

### Schema

**File:** `infra/sql/001_schema.sql`

```sql
CREATE EXTENSION IF NOT EXISTS pg_partman;

CREATE TABLE votes (
    id         BIGSERIAL,
    choice     TEXT NOT NULL CHECK (choice IN ('tabs', 'spaces')),
    user_id    UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_votes_created_at ON votes (created_at DESC);
CREATE INDEX idx_votes_choice       ON votes (choice);
CREATE INDEX idx_votes_user_id      ON votes (user_id);
```

### Partitions

**File:** `infra/sql/002_partitions.sql`

```sql
CREATE TABLE votes_2024_05_25 PARTITION OF votes
    FOR VALUES FROM ('2024-05-25 00:00:00') TO ('2024-05-26 00:00:00');

CREATE TABLE votes_2024_05_26 PARTITION OF votes
    FOR VALUES FROM ('2024-05-26 00:00:00') TO ('2024-05-27 00:00:00');
```

**Daily cron:** `infra/scripts/create-partition.sh`

```bash
#!/bin/bash
# 0 0 * * * /path/to/create-partition.sh

TOMORROW=$(date -d "+1 day" +%Y-%m-%d)
NEXT_DAY=$(date -d "+2 days" +%Y-%m-%d)

psql -U voteuser -d votes <<EOF
CREATE TABLE IF NOT EXISTS votes_${TOMORROW//-/_} PARTITION OF votes
FOR VALUES FROM ('$TOMORROW 00:00:00') TO ('$NEXT_DAY 00:00:00');
EOF
```

### Query Patterns

**Efficient (partition pruning):**

```sql
SELECT choice, COUNT(*)
FROM votes
WHERE created_at >= '2024-05-25'
  AND created_at <  '2024-05-26'
GROUP BY choice;
```

**Inefficient (all partitions):**

```sql
SELECT choice, COUNT(*)
FROM votes
WHERE user_id = '123e4567-e89b-12d3-a456-426614174000'
GROUP BY choice;
```

**Fix:** Add `created_at` when possible:

```sql
SELECT choice, COUNT(*)
FROM votes
WHERE user_id = '...'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY choice;
```

### Connection Pooling

**File:** `worker/src/database.ts`

```typescript
import { Pool } from 'pg';

export const pool = new Pool({
  host: '192.168.1.5',
  port: 5432,
  database: 'votes',
  user: 'voteuser',
  password: 'votepass',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.query('SELECT 1'); // warmup
```

---

## 11. Load Balancing & Health Checks

### Passive Health Checks (Open Source Nginx)

```bash
#!/bin/bash
# Run on LXC1 every 10s via systemd timer

check_backend() {
    local ip=$1
    curl -sf "http://$ip:3000/health" > /dev/null && echo "$ip is up" || echo "$ip is down"
}

check_backend 192.168.1.10
check_backend 192.168.1.20
```

If a backend is down, comment it out in `upstreams.conf` and `nginx -s reload`.

### Load Distribution Algorithms

| Algorithm | Nginx config | Use case |
| --- | --- | --- |
| **Round robin** | Default upstream | Equal backends — **recommended start** |
| **Least connections** | `least_conn;` | Unequal backend capacity |
| **IP hash** | `ip_hash;` | Sticky sessions (avoid for stateless APIs) |

```nginx
# Least connections example
upstream api_backend {
    least_conn;
    server 192.168.1.10:3000;
    server 192.168.1.20:3000;
}
```

---

## 12. Observability & Telemetry

### API Metrics

**File:** `api/src/metrics/metrics.service.ts`

```typescript
import { Counter, Histogram, register } from 'prom-client';

export const voteCounter = new Counter({
  name: 'votes_ingested_total',
  help: 'Total votes ingested',
  labelNames: ['choice', 'zone'],
});

export const responseTime = new Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request latency',
  labelNames: ['method', 'route', 'status'],
  buckets: [1, 5, 10, 50, 100, 500, 1000],
});
```

### Worker Metrics

```typescript
export const batchSize = new Histogram({
  name: 'worker_batch_size',
  buckets: [10, 25, 50, 100, 200],
});

export const dbWriteDuration = new Histogram({
  name: 'worker_db_write_duration_ms',
  buckets: [10, 50, 100, 500, 1000, 5000],
});
```

### Prometheus

**File:** `infra/prometheus/prometheus.yml`

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: api-lxc2
    static_configs:
      - targets: ['192.168.1.10:3000']
        labels: { zone: lxc2 }

  - job_name: api-macbook
    static_configs:
      - targets: ['192.168.1.20:3000']
        labels: { zone: macbook }

  - job_name: worker-lxc3
    static_configs:
      - targets: ['192.168.1.15:9090']

  - job_name: worker-lxc4
    static_configs:
      - targets: ['192.168.1.16:9090']

  - job_name: rabbitmq
    static_configs:
      - targets: ['192.168.1.5:15692']
```

```bash
docker run -d --name prometheus -p 9091:9090 \
  -v "$(pwd)/infra/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml" \
  prom/prometheus
```

UI: `http://192.168.1.5:9091`

### Grafana

Pre-built dashboard: `infra/grafana/dashboards/system-overview.json`

| Panel | PromQL (example) |
| --- | --- |
| Votes ingested/s | `rate(votes_ingested_total[1m])` |
| API p95 latency | `histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))` |
| Queue depth | `rabbitmq_queue_messages{queue="votes.queue"}` |
| DB write p99 | `histogram_quantile(0.99, rate(worker_db_write_duration_ms_bucket[5m]))` |

```bash
docker run -d --name grafana -p 3003:3000 \
  -e GF_SECURITY_ADMIN_PASSWORD=admin \
  -v "$(pwd)/infra/grafana/dashboards:/etc/grafana/provisioning/dashboards" \
  grafana/grafana
```

UI: `http://192.168.1.5:3003` (default `admin` / `admin`)

### Log Aggregation (Loki)

```yaml
services:
  loki:
    image: grafana/loki:latest
    ports:
      - '3100:3100'

  promtail:
    image: grafana/promtail:latest
    volumes:
      - /var/log/nginx:/var/log/nginx:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
```

**LogQL example:**

```logql
{job="api"} |= "error" | json | status_code >= 500
```

---

## 13. Chaos Engineering Tests

### Test Suite Overview

| Test | Failure mode | Expected behavior | Success criteria |
| --- | --- | --- | --- |
| **Zone failure** | Kill MacBook API | Traffic → LXC2 | Zero 5xx |
| **Worker crash** | Kill LXC3 worker | LXC4 drains queue | No message loss (late ACK) / acceptable loss (early ACK) |
| **Database slow** | `pg_sleep` on INSERT | Queue grows; API fast | API p95 under 50 ms |
| **RabbitMQ restart** | `docker restart rabbitmq` | Workers reconnect | Messages persist |
| **Network partition** | Block LXC2 → RabbitMQ | LXC2 unhealthy; removed from pool | No client-visible errors |
| **Thundering herd** | 10k concurrent requests | Graceful degradation | p99 under 1 s |

### Test 1: Zone Failure (MacBook Disconnect)

```bash
k6 run infra/k6/vote-storm.js
ssh lxc1 "tail -f /var/log/nginx/access.log | grep X-Zone-Hit"
watch -n 1 'curl -u admin:secret http://192.168.1.5:15672/api/queues/%2F/votes.queue'

# After 30s: disconnect MacBook
# Expect: 100% traffic to LXC2, no 502/503 in k6
```

**Expected metrics:**

| Phase | `api_lxc2` | `api_macbook` |
| --- | --- | --- |
| Before | ~500 req/s | ~500 req/s |
| After failure | ~1000 req/s | 0 (marked down) |

Recovery: under 10 s (`max_fails=2` × `fail_timeout=5s`)

---

### Test 2: Worker Competition

```bash
for i in {1..10000}; do
  curl -s -X POST http://192.168.1.5/api/vote \
    -H 'Content-Type: application/json' \
    -d "{\"choice\":\"tabs\",\"user_id\":\"test-$i\"}"
done

docker logs -f worker-lxc3 &
docker logs -f worker-lxc4 &
```

```sql
SELECT COUNT(*) FROM votes WHERE user_id LIKE 'test-%';
-- Expected: 10000
```

---

### Test 3: Database Backpressure

```sql
CREATE OR REPLACE FUNCTION slow_insert() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_sleep(0.1);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER slow_insert_trigger
  BEFORE INSERT ON votes
  FOR EACH ROW EXECUTE FUNCTION slow_insert();
```

```bash
k6 run --vus 100 --duration 60s infra/k6/vote-storm.js
```

Observe: API under 10 ms; queue depth grows; workers flush less often.

**Cleanup:**

```sql
DROP TRIGGER slow_insert_trigger ON votes;
DROP FUNCTION slow_insert();
```

---

### Test 4: RabbitMQ Restart

```bash
k6 run --vus 10 --duration 10s infra/k6/vote-storm.js
curl -u admin:secret http://192.168.1.5:15672/api/queues/%2F/votes.queue | jq .messages
docker restart rabbitmq
sleep 30
# Verify workers reconnect and queue depth resumes draining
```

---

### Test 5: Load Test (`vote-storm.js`)

**File:** `infra/k6/vote-storm.js`

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '2m', target: 500 },
    { duration: '5m', target: 1000 },
    { duration: '2m', target: 2000 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<100', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'http://192.168.1.5';

export default function () {
  const payload = JSON.stringify({
    choice: Math.random() > 0.5 ? 'tabs' : 'spaces',
    user_id: `k6-${__VU}-${__ITER}`,
  });

  const res = http.post(`${BASE_URL}/api/vote`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'status 202': (r) => r.status === 202,
    'response time OK': (r) => r.timings.duration < 200,
    'has zone header': (r) => r.headers['X-Zone-Hit'] !== undefined,
  });

  sleep(1);
}
```

```bash
k6 run infra/k6/vote-storm.js
```

---

## 14. Implementation Roadmap

```mermaid
gantt
    title Implementation phases
    dateFormat YYYY-MM-DD
    section Phase 1
    Local Docker stack           :p1, 2026-05-25, 7d
    section Phase 2
    Proxmox LXC deployment       :p2, after p1, 7d
    section Phase 3
    Multi-zone HA (MacBook)      :p3, after p2, 7d
    section Phase 4
    Prometheus + Grafana         :p4, after p3, 7d
    section Phase 5
    Chaos testing + docs         :p5, after p4, 7d
```

### Phase 1: Local Development (Week 1)

**Goal:** Full pipeline on laptop via Docker Compose.

```bash
mkdir -p tabs-vs-spaces/{frontend,api,worker,infra/{nginx,sql,k6,prometheus,grafana}}
cd tabs-vs-spaces && git init
docker compose up -d
curl -X POST http://localhost:3000/api/vote \
  -H 'Content-Type: application/json' \
  -d '{"choice":"tabs","user_id":"test"}'
```

**Milestone:** Votes flow API → queue → worker → Postgres; counts visible in Redis/UI.

---

### Phase 2: Proxmox Deployment (Week 2)

1. Provision LXCs (`192.168.1.5`, `.10`, `.15`, `.16`)
2. Install Docker on each host
3. LXC1: `docker compose -f docker-compose.prod.yml up -d postgres rabbitmq redis`
4. LXC2/LXC3/LXC4: build and run `api` / `worker` images with production env
5. Copy `infra/nginx/*` to LXC1 and `nginx -t && nginx -s reload`

**Milestone:** System reachable at `http://192.168.1.5`

---

### Phase 3: Multi-Zone HA (Week 3)

1. Run API on MacBook (`ZONE=macbook`, `RABBITMQ_URL` → LXC1)
2. Add `192.168.1.20:3000` to Nginx upstream
3. Run Next.js on MacBook; proxy `/` from Nginx
4. Failover test: close lid → traffic 100% to LXC2

---

### Phase 4: Observability (Week 4)

Deploy Prometheus + Grafana on LXC1; import `system-overview.json`; add alert rules for queue backlog.

---

### Phase 5: Chaos Testing (Week 5)

Run Section 13 tests; document in `CHAOS_RESULTS.md`; tune batch size, workers, Nginx `keepalive` from findings.

---

## 15. Future Expansions

| Expansion | Summary |
| --- | --- |
| **Multi-region** | Zone C/D on AWS; central queue; measure cross-region latency |
| **Read replicas** | Postgres streaming replication; worker writes primary, analytics reads replica |
| **Auth & rate limits** | JWT + Redis daily vote caps per user |
| **Kafka** | Event streaming with partition-by-`choice`; replay and consumer groups |
| **API gateway** | Kong/Envoy for rate limiting, plugins, service discovery |
| **Blue/green** | Parallel upstreams; switch `proxy_pass` after smoke tests |
| **Financial ledger** | Idempotency keys, late ACK, ACID batches, audit topic, reconciliation job |

---

## 16. Troubleshooting Guide

### API returns 502 Bad Gateway

```bash
ssh lxc2 "docker ps | grep api"
ssh lxc1 "curl -sf http://192.168.1.10:3000/health"
docker logs api 2>&1 | grep -i rabbitmq
```

---

### Votes not appearing in database

```bash
curl -u admin:secret http://192.168.1.5:15672/api/queues/%2F/votes.queue
docker logs worker-lxc3 | tail -20
docker exec rabbitmq rabbitmqadmin publish \
  exchange=votes.exchange routing_key=vote.cast \
  payload='{"choice":"tabs","user_id":"test"}'
psql -U voteuser -d votes -c "SELECT * FROM votes WHERE user_id='test';"
```

| Queue `messages` | Likely cause |
| --- | --- |
| 0 | API not publishing |
| High | Workers not consuming |

---

### High latency (p99 over 1 s)

```bash
curl http://192.168.1.10:3000/metrics | grep http_request_duration
ping 192.168.1.5
curl -w "@curl-format.txt" -X POST http://192.168.1.5/api/vote \
  -H 'Content-Type: application/json' \
  -d '{"choice":"tabs","user_id":"test"}'
```

---

### MacBook not receiving traffic

```bash
ssh lxc1 "grep 192.168.1.20 /var/log/nginx/error.log"
curl http://192.168.1.20:3000/health
ssh lxc1 "nginx -T | grep -A5 upstream"
```

---

### Missing database partition

**Symptom:** `no partition of relation "votes" found for row`

```bash
date
psql -U voteuser -d votes -c "\d+ votes"
/root/tabs-vs-spaces/infra/scripts/create-partition.sh
```

---

### Redis OOM

```bash
redis-cli INFO memory | grep used_memory_human
redis-cli CONFIG SET maxmemory-policy allkeys-lru
redis-cli CONFIG SET maxmemory 2gb
```

---

## 17. References & Further Reading

### Books

1. **System Design Interview (Vol. 1 & 2)** — Alex Xu (Ch. 3 framework; Ch. 11 news feed)
2. **Designing Data-Intensive Applications** — Martin Kleppmann (Ch. 5 replication; Ch. 11 stream processing)
3. **Site Reliability Engineering** — Google (Ch. 3 risk; Ch. 14 incidents)

### Online

- [Nginx documentation](https://nginx.org/en/docs/)
- [RabbitMQ tutorials](https://www.rabbitmq.com/getstarted.html)
- [PostgreSQL partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [Prometheus naming](https://prometheus.io/docs/practices/naming/)
- [k6 documentation](https://k6.io/docs/)

### Related projects

- **HashiCorp Consul** — Dynamic upstream updates
- **Linkerd / Istio** — Service mesh traffic management
- **Temporal** — Workflow orchestration for complex async pipelines

---

## Appendices

### Appendix A: Quick Start

```bash
git clone https://github.com/yourusername/tabs-vs-spaces.git
cd tabs-vs-spaces
docker compose up -d

curl -X POST http://localhost:3000/api/vote \
  -H 'Content-Type: application/json' \
  -d '{"choice":"tabs","user_id":"test"}'

# Proxmox
ssh root@192.168.1.5 "cd tabs-vs-spaces && git pull && docker compose up -d"

# Load test
k6 run infra/k6/vote-storm.js

# UIs
open http://192.168.1.5:3003   # Grafana
open http://192.168.1.5:9091   # Prometheus
open http://192.168.1.5:15672  # RabbitMQ Management
```

---

### Appendix B: Environment Variables

| Variable | Service | Example | Purpose |
| --- | --- | --- | --- |
| `RABBITMQ_URL` | API, Worker | `amqp://admin:secret@192.168.1.5:5672` | Broker connection |
| `DATABASE_URL` | Worker | `postgresql://voteuser:votepass@192.168.1.5:5432/votes` | Postgres |
| `REDIS_URL` | Worker, Frontend | `redis://192.168.1.5:6379` | Counters / SSE |
| `ZONE` | API | `lxc2` or `macbook` | Zone label for metrics |
| `PORT` | API | `3000` | HTTP listen port |

---

## Conclusion

This project turns abstract system design into measurable engineering: load balancing with failover, async competing consumers, time-partitioned writes, chaos tests with recovery times, and dashboards backed by real metrics.

The stack is intentionally heavier than a voting app needs—because the goal is to practice patterns that scale to ledgers, feeds, and event platforms.

**Next step:** Phase 1 — `docker compose up -d` on your machine and confirm a vote travels API → RabbitMQ → worker → PostgreSQL → Redis → SSE.
