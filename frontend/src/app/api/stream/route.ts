import { getRedis } from "@/lib/redis";

// ioredis uses Node TCP sockets, so this handler must run on the Node.js
// runtime (not Edge). It also must never be statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const redis = getRedis();

  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = async () => {
        try {
          const [tabs, spaces, lastUpdated] = await Promise.all([
            redis.get("votes:tabs"),
            redis.get("votes:spaces"),
            redis.get("votes:last_updated"),
          ]);

          const payload = {
            tabs: parseInt(tabs || "0", 10),
            spaces: parseInt(spaces || "0", 10),
            last_updated: lastUpdated || null,
          };

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch (error) {
          console.error("[stream] Redis read failed:", error);
        }
      };

      await send();
      interval = setInterval(send, 500);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
