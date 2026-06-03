"use client";

import { LiveStats } from "@/components/LiveStats";
import { ScoreBar } from "@/components/ScoreBar";
import { VoteButtons } from "@/components/VoteButtons";
import { useEffect, useRef, useState } from "react";

interface VoteState {
  tabs: number;
  spaces: number;
  last_updated: string | null;
}

export default function VotingPage() {
  const [votes, setVotes] = useState<VoteState>({
    tabs: 0,
    spaces: 0,
    last_updated: null,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [lastVote, setLastVote] = useState<"tabs" | "spaces" | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // ─── SSE connection ──────────────────────────────────────────────────────

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const es = new EventSource("/api/stream");
      eventSourceRef.current = es;

      es.onopen = () => setIsConnected(true);

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as VoteState;
          setVotes(data);
          setIsConnected(true);
        } catch (error) {
          console.error("[SSE] Error:", error);
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        es.close();
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      eventSourceRef.current?.close();
    };
  }, []);

  // ─── Vote handler ────────────────────────────────────────────────────────
  const handleVote = async (choice: "tabs" | "spaces") => {
    // Guard against double-submits; the buttons read `isLoading` to disable.
    if (isLoading) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ choice, user_id: crypto.randomUUID() }),
      });
      if (!response.ok) {
        throw new Error("Failed to submit vote");
      }
      setLastVote(choice);
    } catch (error) {
      console.error("[Vote] Failed to submit vote:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-5xl font-extrabold text-white tracking-tight">
            Tabs <span className="text-slate-500">vs</span> Spaces
          </h1>
          <p className="text-slate-400 text-sm">
            A distributed systems learning project disguised as a debate
          </p>
        </div>

        {/* Score bar */}
        <ScoreBar tabs={votes.tabs} spaces={votes.spaces} />

        {/* Vote buttons */}
        <VoteButtons
          onVote={handleVote}
          isLoading={isLoading}
          lastVote={lastVote}
        />

        {/* Live stats */}
        <LiveStats
          tabs={votes.tabs}
          spaces={votes.spaces}
          lastUpdated={votes.last_updated}
          isConnected={isConnected}
        />
      </div>
    </main>
  );
}
