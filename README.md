# Tabs vs Spaces

**Project codename:** `tabs-vs-spaces`  
**Purpose:** A hands-on laboratory for distributed systems, load balancing, asynchronous processing, and chaos engineering—without the overhead of complex business logic.

> **Document version:** 1.2 · **Last updated:** June 1, 2026 · **Maintained by:** Azaz Ahamed Zoha

> **Implementation status (June 2026)**
>
> | Status | Components |
> | ------ | ---------- |
> | **Implemented** | NestJS API (`POST /votes`), RabbitMQ ingest, worker batch consumer, PostgreSQL partitioned writes, `vote_totals` materialized view, Redis live counters (worker), `/health`, `/metrics`, local Docker Compose stack |
> | **In progress** | Frontend voting UI, SSE stream |
> | **Planned (roadmap)** | Nginx multi-zone LB, Prometheus/Grafana/k6, Proxmox deployment, chaos test suite |
>
> Sections marked **(implemented)** reflect the current repo. Sections marked **(planned)** describe the target Proxmox/chaos architecture — intent unchanged, not all files exist yet.

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

| Skill domain              | What you'll practice                                            | Interview relevance                        |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| **Load balancing**        | Nginx upstream configuration, health checks, failover detection | "How would you handle traffic spikes?"     |
| **Stateless design**      | APIs with zero local state, session externalization             | "How do you scale horizontally?"           |
| **Async processing**      | Producer–consumer patterns, message acknowledgments             | "How do you handle slow operations?"       |
| **Database optimization** | Table partitioning, index strategies, connection pooling        | "How do you handle write-heavy workloads?" |
| **Chaos engineering**     | Simulating failures, measuring recovery time                    | "What happens if a server goes down?"      |
| **Observability**         | Metrics collection, log aggregation, alerting                   | "How do you debug production issues?"      |

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
    W1 -->|INCRBY counters| Redis
    W2 -->|INCRBY counters| Redis
    SSE["Frontend SSE"] -.->|Planned| Redis
```

**Current local stack:** workers persist to PostgreSQL, refresh `vote_totals` (debounced), and increment Redis counters (`votes:tabs`, `votes:spaces`) after each successful batch flush. SSE from Redis to the browser is **planned** (see §7.3).

### Design Decisions & Rationale

#### Why separate API from workers?

| Problem                                              | Solution                                                     | Interview answer                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| PostgreSQL INSERT is slow (10–50 ms)                 | API returns **202 Accepted** in under 5 ms and enqueues work | "We decouple fast request handling from slow I/O to keep sub-10 ms responses under load." |
| API waiting on DB caps at ~20–100 req/s per instance | Workers batch-insert 100 votes → 10,000+ writes/s            |                                                                                           |

#### Why two workers?

A single worker bottlenecks when RabbitMQ fills faster than it drains. Multiple workers compete for messages; RabbitMQ distributes with round-robin delivery.

#### Why keep all state on LXC1?

If PostgreSQL and RabbitMQ run on your MacBook, disconnecting risks data loss. The **control plane** stays on always-on Proxmox; **stateless compute** (API/workers) can fail freely.

---

## 4. Infrastructure Topology

### Physical Layout

| Component   | Location | IP address     | Role                  | Failure impact                       |
| ----------- | -------- | -------------- | --------------------- | ------------------------------------ |
| **LXC1**    | Proxmox  | `192.168.1.5`  | Control plane         | Critical — entire system down        |
| **LXC2**    | Proxmox  | `192.168.1.10` | API Zone A            | Graceful — traffic shifts to MacBook |
| **LXC3**    | Proxmox  | `192.168.1.15` | Worker 1              | Graceful — LXC4 continues            |
| **LXC4**    | Proxmox  | `192.168.1.16` | Worker 2              | Graceful — LXC3 continues            |
| **MacBook** | Laptop   | `192.168.1.20` | API Zone B + frontend | Graceful — traffic shifts to LXC2    |

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

| Port     | Service                | Exposure      |
| -------- | ---------------------- | ------------- |
| 80 / 443 | Nginx HTTP/HTTPS       | Public        |
| 3000     | API instances          | Internal      |
| 5432     | PostgreSQL             | Internal only |
| 5672     | RabbitMQ AMQP          | Internal      |
| 15672    | RabbitMQ Management UI | Internal      |
| 6379     | Redis                  | Internal only |

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

| Service           | Technology | Version | Purpose                                    | Status      |
| ----------------- | ---------- | ------- | ------------------------------------------ | ----------- |
| Load balancer     | Nginx      | 1.25+   | L7 routing, health checks, TLS termination | Planned     |
| API framework     | NestJS     | 11.x    | Stateless HTTP server with DI              | Implemented |
| Message broker    | RabbitMQ   | 3.13    | Durable queue with acknowledgments         | Implemented |
| Database          | PostgreSQL | 16.x    | ACID storage with native range partitioning | Implemented |
| Cache             | Redis      | 7.2+    | In-memory counters (worker `INCRBY`)       | Partial     |
| Frontend          | Next.js    | 16.x    | SSR, real-time updates                     | Scaffolded  |
| Worker runtime    | tsx        | 4.x     | TypeScript dev runner with watch mode      | Implemented |
| Container runtime | Docker     | 24.x+   | Consistent deployments                     | Implemented |

### Development Tools

| Tool           | Purpose                       |
| -------------- | ----------------------------- |
| **k6**         | Load testing and benchmarking |
| **Artillery**  | Scenario-based load testing   |
| **Prometheus** | Metrics collection            |
| **Grafana**    | Dashboards and alerting       |
| **pgAdmin**    | PostgreSQL management         |
| **WSL2**       | Local development (Windows)   |

---

## 6. Repository Structure

```
tabs-vs-spaces/
├── frontend/                   # Next.js application (scaffold — voting UI planned)
│   ├── src/app/               # App router (page.tsx, layout.tsx)
│   └── package.json
│
├── api/                        # NestJS API (implemented)
│   ├── src/
│   │   ├── votes/             # Controller + service + DTO
│   │   ├── rabbitmq/          # amqp-connection-manager publisher
│   │   ├── health/
│   │   ├── metrics/
│   │   └── main.ts
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   └── package.json
│
├── worker/                     # Background consumer (implemented)
│   ├── src/
│   │   ├── consumer.ts        # VoteConsumer — batch + RabbitMQ
│   │   ├── database.ts        # Pool, partitions, batch INSERT
│   │   ├── config.ts
│   │   └── main.ts
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   └── package.json
│
├── infra/
│   ├── sql/                   # Postgres schema + seed partitions (implemented)
│   ├── nginx/                 # (planned) multi-zone upstream config
│   ├── k6/                    # (planned) load tests
│   ├── prometheus/            # (planned) scrape configs
│   └── grafana/               # (planned) dashboards
│
├── docker-compose.yml          # Local dev stack (implemented)
├── docker-compose.prod.yml     # (planned) Proxmox control-plane compose
└── README.md                   # This document
```

### Key Design Principles

1. **Isolation** — Each service has its own `package.json`; no shared code packages.
2. **Containerization** — Every service ships with a `Dockerfile`.
3. **Configuration as code** — Nginx, SQL, and load tests live under `infra/`.
4. **Single source of truth** — One Git repository, no submodules.

---

## 7. Component Design

### 7.1 API Service (Ingestion Layer) — **implemented**

Validation lives in the DTO; business logic in `VotesService`; RabbitMQ in `RabbitmqService`.

**File:** `api/src/votes/votes.controller.ts`

```typescript
@Controller("votes")
export class VotesController {
  constructor(private readonly votesService: VotesService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED) // 202 Accepted
  async vote(@Body() voteDto: VoteDto) {
    return this.votesService.ingestVote(voteDto);
  }
}
```

**File:** `api/src/votes/votes.service.ts`

```typescript
async ingestVote(voteDto: VoteDto) {
  await this.rabbitmq.publish("votes.exchange", "vote.cast", {
    ...voteDto,
    zone: this.zone,
    timestamp: new Date().toISOString(),
  });

  this.metrics.voteCounter.inc({ choice: voteDto.choice, zone: this.zone });

  return { status: "accepted", queued_at: new Date().toISOString() };
}
```

**File:** `api/src/votes/dto/vote.dto.ts`

```typescript
export class VoteDto {
  @IsIn(["tabs", "spaces"])
  choice: "tabs" | "spaces";

  @IsUUID("4")
  user_id: string;
}
```

| Characteristic       | Description                                     |
| -------------------- | ----------------------------------------------- |
| **Stateless**        | No local state between requests                 |
| **Fast**             | Under 10 ms by avoiding database I/O            |
| **Validated**        | Global `ValidationPipe` with `class-validator`  |
| **Route**            | `POST /votes` (no global `/api` prefix)         |
| **Idempotent-ready** | `user_id` on each vote; `ON CONFLICT DO NOTHING` in worker |

**Environment variables:**

```bash
RABBITMQ_URL=amqp://admin:secret@rabbitmq:5672
ZONE=local          # included on each message + Prometheus label
PORT=3000
```

---

### 7.2 Worker Service (Consumer Layer) — **implemented**

Uses `amqp-connection-manager` (auto-reconnect), `VoteConsumer` class, `tsx watch` for dev, and **Redis** for live counter updates via `worker/src/redis.ts`.

**File:** `worker/src/consumer.ts` (excerpt)

```typescript
export class VoteConsumer {
  private batch: VoteRecord[] = [];

  async start(): Promise<void> {
    this.connection = amqp.connect([config.rabbitmq.url], {
      heartbeatIntervalInSeconds: 5,
      reconnectTimeInSeconds: 3,
    });

    this.channelWrapper = this.connection.createChannel({
      setup: async (channel) => {
        await channel.assertExchange(exchange, "topic", { durable: true });
        await channel.assertQueue(queue, { durable: true });
        await channel.bindQueue(queue, exchange, routingKey);
        await channel.prefetch(prefetch);
        await channel.consume(queue, (msg) => this.handleMessage(msg, channel));
      },
    });
  }

  private handleMessage(msg: ConsumeMessage | null, channel: Channel): void {
    const vote = JSON.parse(msg.content.toString()) as VoteRecord;
    this.batch.push(vote);
    channel.ack(msg); // early ACK — see trade-off below

    if (this.batch.length >= config.worker.batchSize) {
      this.flush("batch-full");
    } else {
      this.resetTimer();
    }
  }
}
```

**File:** `worker/src/database.ts` (batch insert excerpt)

```typescript
const query = `
  INSERT INTO votes (choice, user_id, zone, worker_id, created_at)
  VALUES ${placeholders.join(", ")}
  ON CONFLICT DO NOTHING
`;
await pool.query(query, values);
```

| Detail         | Behavior                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| **Batching**   | Up to 100 votes per flush (`BATCH_SIZE`)                                 |
| **Timeout**    | Flush partial batch after 1 s (`BATCH_TIMEOUT_MS`)                       |
| **ACK timing** | ACK after in-memory batch (not after DB) — higher throughput, crash risk |
| **Totals (DB)**  | Debounced `REFRESH MATERIALIZED VIEW CONCURRENTLY vote_totals` after flushes |
| **Totals (Redis)** | Pipeline `INCRBY votes:tabs` / `votes:spaces` after successful DB flush   |
| **Redis startup** | `connectRedis()` at boot (`lazyConnect` + explicit connect for startup log) |
| **Partitions** | `ensurePartitionExists()` at startup + hourly for tomorrow               |
| **Dev runner** | `tsx watch src/main.ts` (replaces ts-node-dev)                           |

**Trade-off (early ACK):** ACK after in-memory batch (not after DB) — higher throughput, crash risk. Acceptable for voting; use late ACK + idempotency for financial workloads.

#### Redis dual-write concerns

PostgreSQL is the **source of truth**; Redis is a **fast read cache** for the frontend. The worker writes Postgres first, then Redis — which is the correct order, but introduces known trade-offs worth documenting:

| Concern | What happens | Severity (this project) |
| ------- | ------------ | ------------------------- |
| **Counter drift** | If `incrementCounters` fails (Redis down, network blip), Postgres has the vote but Redis totals lag. Failures are logged and non-fatal. | Medium for live UI; low for lab |
| **Batch vs inserted count** | Redis increments from the full batch; `ON CONFLICT DO NOTHING` may insert fewer rows. Redis can **over-count** vs Postgres on duplicate messages. | Low while duplicates are rare |
| **No rebuild on startup** | A fresh Redis volume starts counters at 0 while Postgres retains history. No sync-from-`vote_totals` job exists yet. | Medium after Redis wipe/redeploy |
| **Dual sources** | `vote_totals` (Postgres MV) and Redis keys can disagree until reconciliation. | Expected until frontend picks one path |
| **Optional at startup** | Redis failure at boot logs a warning; worker continues (Postgres-only mode). | Fine for resilience; confusing for debugging |

**When this design is ideal:** local dev, chaos experiments, learning competing consumers — Postgres durability with sub-second display targets.

**When to harden (before production UI):** increment from **actually inserted** rows (not raw batch size), add a startup job to seed Redis from `vote_totals` when keys are missing, and/or treat Redis as a TTL cache with Postgres fallback for reads.

See §7.3 for the planned SSE read path off Redis.

---

### 7.3 Frontend (Visualization Layer) — **planned**

**Current state:** `frontend/` is a Next.js 16 scaffold (`create-next-app` boilerplate on port 4000). Not yet in `docker-compose.yml`.

**Target design** (unchanged intent — Redis-backed SSE for live totals):

**Vote UI:** `frontend/src/app/page.tsx` *(planned)*

```typescript
'use client';

export default function VotingPage() {
  const [votes, setVotes] = useState({ tabs: 0, spaces: 0 });

  useEffect(() => {
    const eventSource = new EventSource('/api/stream');
    eventSource.onmessage = (event) => setVotes(JSON.parse(event.data));
    return () => eventSource.close();
  }, []);

  const handleVote = async (choice: 'tabs' | 'spaces') => {
    await fetch('http://localhost:3000/votes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice, user_id: crypto.randomUUID() }),
    });
  };

  // Progress bar + Tabs / Spaces buttons
}
```

**SSE stream:** `frontend/src/app/api/stream/route.ts` *(planned — reads Redis)*

```typescript
export async function GET() {
  const redis = new Redis(process.env.REDIS_URL);
  // Poll votes:tabs / votes:spaces every 500 ms → text/event-stream
}
```

**Interim read path:** query `vote_totals` in PostgreSQL, or `GET votes:tabs` / `GET votes:spaces` in Redis (`redis-cli`). SSE wiring is planned. If Redis was recently wiped, counters may be lower than Postgres — see §7.2.

**Real-time strategy (target):** SSE polls Redis every 500 ms — sub-second latency without WebSocket complexity. Aspirational standard: expose queue depth and consumer lag in Prometheus alongside UI latency (see §12).

---

## 8. Networking Strategy

### 8.1 Docker Networking (Local) — **implemented**

**File:** `docker-compose.yml` (excerpt — matches repo)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: votes
      POSTGRES_USER: voteuser
      POSTGRES_PASSWORD: votepass
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infra/sql:/docker-entrypoint-initdb.d
    networks:
      - app-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U voteuser -d votes"]

  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: secret
    ports:
      - "5672:5672"
      - "15672:15672"
    networks:
      - app-network

  redis:
    image: redis:7.2-alpine
    ports:
      - "6379:6379"
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]

  api:
    build:
      context: ./api
      dockerfile: Dockerfile.dev
    environment:
      RABBITMQ_URL: amqp://admin:secret@rabbitmq:5672
      ZONE: local
      PORT: 3000
    volumes:
      - ./api/src:/app/src
    ports:
      - "3000:3000"
    depends_on:
      rabbitmq:
        condition: service_healthy

  worker:
    build:
      context: ./worker
      dockerfile: Dockerfile.dev
    environment:
      RABBITMQ_URL: amqp://admin:secret@rabbitmq:5672
      DATABASE_URL: postgresql://voteuser:votepass@postgres:5432/votes
      WORKER_ID: worker-local
      BATCH_SIZE: "100"
      BATCH_TIMEOUT_MS: "1000"
      REDIS_URL: redis://redis:6379
    volumes:
      - ./worker/src:/app/src
    depends_on:
      rabbitmq:
        condition: service_healthy
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

networks:
  app-network:
    driver: bridge
```

> **Note:** After adding npm dependencies to `worker/`, rebuild the image (`docker compose build worker`) and recreate the container — only `src/` is bind-mounted; `node_modules` lives in the image.

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

        location /votes {
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

        # Legacy alias — optional rewrite if clients still POST /api/vote
        location = /api/vote {
            proxy_pass http://api_backend/votes;

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

| Directive             | Effect                               |
| --------------------- | ------------------------------------ |
| `proxy_next_upstream` | Retry next backend on 502/503/504    |
| `max_fails=2`         | Mark down after 2 failures           |
| `fail_timeout=5s`     | Retry failed server after 5 s        |
| `X-Zone-Hit`          | Log which backend served the request |

---

### 8.3 Health Check Endpoints — **implemented**

**File:** `api/src/health/health.controller.ts`

```typescript
@Controller("health")
export class HealthController {
  constructor(
    private readonly rabbitmq: RabbitmqService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async check() {
    const isRabbitMqHealthy = await this.rabbitmq.isConnected();

    if (!isRabbitMqHealthy) {
      throw new ServiceUnavailableException("RabbitMQ is not available");
    }

    return {
      status: "ok",
      zone: this.config.get("ZONE"),
      timestamp: new Date().toISOString(),
      dependencies: { rabbitmq: isRabbitMqHealthy },
    };
  }
}
```

If RabbitMQ is down, the API reports unhealthy so Nginx can stop routing traffic to that instance (once Nginx is deployed).

---

## 9. Data Flow & Message Processing

### Request Lifecycle

**Implemented today** (solid lines) vs **planned** (dashed):

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant API
    participant RabbitMQ
    participant Worker
    participant PostgreSQL

    User->>API: POST /votes
    API->>API: Validate VoteDto
    API->>RabbitMQ: Publish vote.cast (+ zone, timestamp)
    API-->>User: 202 Accepted

    RabbitMQ->>Worker: Deliver message (prefetch ≤ 100)
    Worker->>Worker: Add to batch · ACK
    Note over Worker: Flush at 100 votes or 1 s
    Worker->>PostgreSQL: Batch INSERT into votes
    Worker->>PostgreSQL: REFRESH vote_totals (debounced)
    Worker->>Redis: INCRBY votes:tabs / votes:spaces

    participant SSE as Frontend SSE (planned)
    loop Every 500 ms (planned)
        SSE-.->Redis: GET votes:tabs / votes:spaces
        SSE-->>User: SSE event
    end
```

> See **§7.2 Redis dual-write concerns** for drift, duplicate, and rebuild risks between Postgres and Redis.

> **Nginx routing** is planned for Proxmox — local dev hits `POST http://localhost:3000/votes` directly. Planned Nginx exposes `/votes` and optional legacy alias `/api/vote`.

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

| Strategy      | Pros                              | Cons                                   |
| ------------- | --------------------------------- | -------------------------------------- |
| **Early ACK** | Higher throughput; simpler errors | Loss if worker crashes before DB write |
| **Late ACK**  | Redelivery on crash               | Lower throughput; needs idempotency    |

**Interview insight:** For voting, prioritize throughput. For payments, use late ACK with idempotency keys.

### RabbitMQ Exchange & Queue Setup — **implemented**

**File:** `api/src/rabbitmq/rabbitmq.service.ts` (uses `amqp-connection-manager` for auto-reconnect)

```typescript
this.channelWrapper = this.connection.createChannel({
  setup: async (channel: Channel) => {
    await channel.assertExchange("votes.exchange", "topic", { durable: true });
    await channel.assertQueue("votes.queue", { durable: true });
    await channel.bindQueue("votes.queue", "votes.exchange", "vote.cast");
  },
});

await this.channelWrapper?.publish(exchange, routingKey, message, {
  persistent: true,
  timestamp: Date.now(),
});
```

The worker mirrors the same topology in `VoteConsumer.start()` so either service can boot independently.

**Topic routing keys (future):**

| Routing key  | Purpose                       |
| ------------ | ----------------------------- |
| `vote.cast`  | Current voting                |
| `vote.undo`  | Cancel vote (future)          |
| `vote.audit` | Separate audit queue (future) |

---

## 10. Database Design & Partitioning

### Schema — **implemented**

**File:** `infra/sql/001_schema.sql`

```sql
CREATE TABLE IF NOT EXISTS votes (
    id              BIGSERIAL,
    choice          TEXT NOT NULL CHECK (choice IN ('tabs', 'spaces')),
    user_id         UUID NOT NULL,
    zone            TEXT NOT NULL DEFAULT 'unknown',
    worker_id       TEXT NOT NULL DEFAULT 'unknown',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_votes_created_at ON votes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_votes_choice ON votes (choice);

CREATE MATERIALIZED VIEW IF NOT EXISTS vote_totals AS
    SELECT choice, COUNT(*) AS total
    FROM votes
    GROUP BY choice;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vote_totals_choice ON vote_totals (choice);
```

Uses **PostgreSQL 16 native declarative partitioning** (no `pg_partman` extension). Partition key includes `created_at` in the primary key as required by PostgreSQL range partitioning.

### Partitions — **implemented**

**Seed on first boot:** `infra/sql/002_partitions.sql` creates today + tomorrow via `CURRENT_DATE`.

**Ongoing:** `worker/src/database.ts` → `ensurePartitionExists()` at startup (today + tomorrow) and hourly thereafter. UTC day boundaries; idempotent (`SELECT` from `pg_tables` before `CREATE TABLE … PARTITION OF`).

```typescript
// worker/src/database.ts (excerpt)
if (exists.rowCount === 0) {
  await client.query(
    `CREATE TABLE ${quoteIdent(tableName)} PARTITION OF votes
     FOR VALUES FROM (${quoteLiteral(startStr)}) TO (${quoteLiteral(endStr)})`,
  );
}
```

> **Planned:** `infra/scripts/create-partition.sh` cron on LXC1 as a belt-and-suspenders backup — worker automation covers dev today.

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

### Connection Pooling — **implemented**

**File:** `worker/src/database.ts`

```typescript
pool = new Pool({
  connectionString: config.postgres.connectionString,
  max: config.postgres.poolMax,           // default 10
  idleTimeoutMillis: config.postgres.idleTimeoutMs,
  connectionTimeoutMillis: config.postgres.connectionTimeoutMs,
});
```

Configured via `DATABASE_URL` in `worker/.env.example`. Aspirational production tuning: keep pool size modest (~10–20 connections per worker) to avoid connection overhead at high batch throughput.

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

| Algorithm             | Nginx config     | Use case                                   |
| --------------------- | ---------------- | ------------------------------------------ |
| **Round robin**       | Default upstream | Equal backends — **recommended start**     |
| **Least connections** | `least_conn;`    | Unequal backend capacity                   |
| **IP hash**           | `ip_hash;`       | Sticky sessions (avoid for stateless APIs) |

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

> **Status:** API exposes `GET /metrics` with `votes_ingested_total` counter. Full Prometheus/Grafana/Loki stack and worker histograms are **planned** (configs referenced below target Proxmox Phase 4).

### API Metrics — **implemented**

**File:** `api/src/metrics/metrics.service.ts`

```typescript
this.voteCounter = new Counter({
  name: "votes_ingested_total",
  help: "Total votes ingested",
  labelNames: ["choice", "zone"],
});

this.httpDuration = new Histogram({
  name: "http_request_duration_ms",
  help: "Duration of HTTP requests in milliseconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [1, 5, 10, 50, 100, 500, 1000],
});
```

Scrape locally: `curl http://localhost:3000/metrics`

> **Note:** `httpDuration` is defined but not yet wired to an interceptor — planned enhancement.

### Worker Metrics — **planned**

```typescript
export const batchSize = new Histogram({
  name: "worker_batch_size",
  buckets: [10, 25, 50, 100, 200],
});

export const dbWriteDuration = new Histogram({
  name: "worker_db_write_duration_ms",
  buckets: [10, 50, 100, 500, 1000, 5000],
});
```

### Prometheus — **planned**

**File:** `infra/prometheus/prometheus.yml`

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: api-lxc2
    static_configs:
      - targets: ["192.168.1.10:3000"]
        labels: { zone: lxc2 }

  - job_name: api-macbook
    static_configs:
      - targets: ["192.168.1.20:3000"]
        labels: { zone: macbook }

  - job_name: worker-lxc3
    static_configs:
      - targets: ["192.168.1.15:9090"]

  - job_name: worker-lxc4
    static_configs:
      - targets: ["192.168.1.16:9090"]

  - job_name: rabbitmq
    static_configs:
      - targets: ["192.168.1.5:15692"]
```

```bash
docker run -d --name prometheus -p 9091:9090 \
  -v "$(pwd)/infra/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml" \
  prom/prometheus
```

UI: `http://192.168.1.5:9091`

### Grafana — **planned**

Pre-built dashboard: `infra/grafana/dashboards/system-overview.json`

| Panel            | PromQL (example)                                                         |
| ---------------- | ------------------------------------------------------------------------ |
| Votes ingested/s | `rate(votes_ingested_total[1m])`                                         |
| API p95 latency  | `histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))`    |
| Queue depth      | `rabbitmq_queue_messages{queue="votes.queue"}`                           |
| DB write p99     | `histogram_quantile(0.99, rate(worker_db_write_duration_ms_bucket[5m]))` |

```bash
docker run -d --name grafana -p 3003:3000 \
  -e GF_SECURITY_ADMIN_PASSWORD=admin \
  -v "$(pwd)/infra/grafana/dashboards:/etc/grafana/provisioning/dashboards" \
  grafana/grafana
```

UI: `http://192.168.1.5:3003` (default `admin` / `admin`)

### Log Aggregation (Loki) — **planned**

```yaml
services:
  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"

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

> **Status:** Test procedures and expected behaviors are documented below for Proxmox deployment. Script `infra/k6/vote-storm.js` and multi-zone hosts are **planned** — run adapted commands against local Docker (`localhost:3000/votes`) until Phase 2.

### Test Suite Overview

| Test                  | Failure mode              | Expected behavior                 | Success criteria                                         |
| --------------------- | ------------------------- | --------------------------------- | -------------------------------------------------------- |
| **Zone failure**      | Kill MacBook API          | Traffic → LXC2                    | Zero 5xx                                                 |
| **Worker crash**      | Kill LXC3 worker          | LXC4 drains queue                 | No message loss (late ACK) / acceptable loss (early ACK) |
| **Database slow**     | `pg_sleep` on INSERT      | Queue grows; API fast             | API p95 under 50 ms                                      |
| **RabbitMQ restart**  | `docker restart rabbitmq` | Workers reconnect                 | Messages persist                                         |
| **Network partition** | Block LXC2 → RabbitMQ     | LXC2 unhealthy; removed from pool | No client-visible errors                                 |
| **Thundering herd**   | 10k concurrent requests   | Graceful degradation              | p99 under 1 s                                            |

### Test 1: Zone Failure (MacBook Disconnect)

```bash
k6 run infra/k6/vote-storm.js
ssh lxc1 "tail -f /var/log/nginx/access.log | grep X-Zone-Hit"
watch -n 1 'curl -u admin:secret http://192.168.1.5:15672/api/queues/%2F/votes.queue'

# After 30s: disconnect MacBook
# Expect: 100% traffic to LXC2, no 502/503 in k6
```

**Expected metrics:**

| Phase         | `api_lxc2`  | `api_macbook`   |
| ------------- | ----------- | --------------- |
| Before        | ~500 req/s  | ~500 req/s      |
| After failure | ~1000 req/s | 0 (marked down) |

Recovery: under 10 s (`max_fails=2` × `fail_timeout=5s`)

---

### Test 2: Worker Competition

```bash
for i in {1..10000}; do
  curl -s -X POST http://192.168.1.5/votes \
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

### Test 5: Load Test (`vote-storm.js`) — **planned**

**File:** `infra/k6/vote-storm.js` *(not in repo yet — template below)*

```javascript
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 100 },
    { duration: "2m", target: 500 },
    { duration: "5m", target: 1000 },
    { duration: "2m", target: 2000 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<100", "p(99)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = "http://192.168.1.5"; // via Nginx in prod; use http://localhost:3000 locally

export default function () {
  const payload = JSON.stringify({
    choice: Math.random() > 0.5 ? "tabs" : "spaces",
    user_id: `k6-${__VU}-${__ITER}`,
  });

  const res = http.post(`${BASE_URL}/votes`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  check(res, {
    "status 202": (r) => r.status === 202,
    "response time OK": (r) => r.timings.duration < 200,
    // "has zone header": (r) => r.headers["X-Zone-Hit"] !== undefined,  // Nginx only
  });

  sleep(1);
}
```

```bash
k6 run infra/k6/vote-storm.js
```

---

## 14. Implementation Roadmap

> **Progress:** Phase 1 core pipeline is **implemented** (API, worker, Postgres, local Compose). Phases 2–5 remain as originally planned.

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

### Phase 1: Local Development (Week 1) — **core complete**

**Goal:** Full pipeline on laptop via Docker Compose.

```bash
docker compose up -d
curl -X POST http://localhost:3000/votes \
  -H 'Content-Type: application/json' \
  -d '{"choice":"tabs","user_id":"550e8400-e29b-41d4-a716-446655440000"}'
```

**Milestone:** Votes flow API → queue → worker → Postgres + Redis. Verify with `SELECT * FROM vote_totals;` and `redis-cli GET votes:tabs`. See §7.2 if Redis and Postgres totals disagree.

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

| Expansion              | Summary                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| **Multi-region**       | Zone C/D on AWS; central queue; measure cross-region latency                   |
| **Read replicas**      | Postgres streaming replication; worker writes primary, analytics reads replica |
| **Auth & rate limits** | JWT + Redis daily vote caps per user                                           |
| **Kafka**              | Event streaming with partition-by-`choice`; replay and consumer groups         |
| **API gateway**        | Kong/Envoy for rate limiting, plugins, service discovery                       |
| **Blue/green**         | Parallel upstreams; switch `proxy_pass` after smoke tests                      |
| **Financial ledger**   | Idempotency keys, late ACK, ACID batches, audit topic, reconciliation job      |

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

| Queue `messages` | Likely cause          |
| ---------------- | --------------------- |
| 0                | API not publishing    |
| High             | Workers not consuming |

---

### High latency (p99 over 1 s)

```bash
curl http://192.168.1.10:3000/metrics | grep http_request_duration
ping 192.168.1.5
curl -w "@curl-format.txt" -X POST http://192.168.1.5/votes \
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
docker compose exec postgres psql -U voteuser -d votes -c "\d+ votes"
docker compose restart worker   # re-runs ensurePartitionExists for today + tomorrow
```

If a malformed partition exists from an earlier run, drop it and restart the worker:

```bash
docker compose exec postgres psql -U voteuser -d votes -c "DROP TABLE IF EXISTS votes_YYYY_MM_DD;"
docker compose restart worker
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

curl -X POST http://localhost:3000/votes \
  -H 'Content-Type: application/json' \
  -d '{"choice":"tabs","user_id":"550e8400-e29b-41d4-a716-446655440000"}'

# Verify persistence
docker compose exec postgres psql -U voteuser -d votes -c "SELECT * FROM vote_totals;"

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

| Variable             | Service     | Example                                                 | Purpose                          | Status      |
| -------------------- | ----------- | ------------------------------------------------------- | -------------------------------- | ----------- |
| `RABBITMQ_URL`       | API, Worker | `amqp://admin:secret@rabbitmq:5672`                     | Broker connection                | Implemented |
| `DATABASE_URL`       | Worker      | `postgresql://voteuser:votepass@postgres:5432/votes`    | Postgres                         | Implemented |
| `ZONE`               | API         | `local`, `lxc2`, or `macbook`                           | Zone label on message + metrics  | Implemented |
| `WORKER_ID`          | Worker      | `worker-local`                                          | Stored on each vote row          | Implemented |
| `BATCH_SIZE`         | Worker      | `100`                                                   | Votes per flush                  | Implemented |
| `BATCH_TIMEOUT_MS`   | Worker      | `1000`                                                  | Partial batch timeout            | Implemented |
| `RABBITMQ_PREFETCH`  | Worker      | `100`                                                   | Max unacked messages             | Implemented |
| `PORT`               | API         | `3000`                                                  | HTTP listen port                 | Implemented |
| `REDIS_URL`          | Worker, Frontend | `redis://redis:6379`                                    | Live counters / SSE              | Worker: implemented |

See `api/.env.example` and `worker/.env.example` for local defaults.

---

## Conclusion

This project turns abstract system design into measurable engineering: load balancing with failover, async competing consumers, time-partitioned writes, chaos tests with recovery times, and dashboards backed by real metrics.

**Today (Phase 1):** a vote travels API → RabbitMQ → worker → PostgreSQL, with debounced `vote_totals` refresh and Redis counter increments. Postgres is authoritative; Redis is a fast display cache with known dual-write trade-offs (§7.2).

**Target (Phases 2–5):** SSE live UI, Nginx multi-zone routing, full observability stack, and Proxmox chaos testing — intent unchanged.

The stack is intentionally heavier than a voting app needs—because the goal is to practice patterns that scale to ledgers, feeds, and event platforms.

**Next step:** `docker compose up -d`, POST a vote to `/votes`, confirm rows in Postgres — then continue the roadmap in §14.
