"use client";

interface VoteButtonsProps {
  onVote: (choice: "tabs" | "spaces") => void;
  isLoading: boolean;
  lastVote: "tabs" | "spaces" | null;
}

export function VoteButtons({ onVote, isLoading, lastVote }: VoteButtonsProps) {
  return (
    <div className="flex gap-6">
      <button
        onClick={() => onVote("tabs")}
        disabled={isLoading}
        className={`
            relative flex-1 py-8 rounded-2xl text-white font-bold text-2xl
            transition-all duration-150 active:scale-95 disabled:opacity-60
            ${
              lastVote === "tabs"
                ? "bg-blue-500 ring-4 ring-blue-300 ring-offset-2 ring-offset-slate-900"
                : "bg-blue-600 hover:bg-blue-500"
            }
          `}
      >
        Tabs
        {lastVote === "tabs" && (
          <span className="absolute top-2 right-3 text-sm font-normal opacity-80">
            ✓ voted
          </span>
        )}
      </button>

      <button
        onClick={() => onVote("spaces")}
        disabled={isLoading}
        className={`
            relative flex-1 py-8 rounded-2xl text-white font-bold text-2xl
            transition-all duration-150 active:scale-95 disabled:opacity-60
            ${
              lastVote === "spaces"
                ? "bg-purple-500 ring-4 ring-purple-300 ring-offset-2 ring-offset-slate-900"
                : "bg-purple-600 hover:bg-purple-500"
            }
          `}
      >
        Spaces
        {lastVote === "spaces" && (
          <span className="absolute top-2 right-3 text-sm font-normal opacity-80">
            ✓ voted
          </span>
        )}
      </button>
    </div>
  );
}
