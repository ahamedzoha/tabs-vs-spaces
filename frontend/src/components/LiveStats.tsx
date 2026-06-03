"use client";

interface LiveStatsProps {
  tabs: number;
  spaces: number;
  lastUpdated: string | null;
  isConnected: boolean;
}

export function LiveStats({
  tabs,
  spaces,
  lastUpdated,
  isConnected,
}: LiveStatsProps) {
  const total = tabs + spaces;

  return (
    <div className="grid grid-cols-3 gap-4 text-center">
      <div className="bg-slate-800 rounded-xl p-4">
        <div className="text-3xl font-bold text-blue-400">
          {tabs.toLocaleString()}
        </div>
        <div className="text-slate-400 text-sm mt-1">Tabs votes</div>
      </div>

      <div className="bg-slate-800 rounded-xl p-4">
        <div className="text-3xl font-bold text-slate-300">
          {total.toLocaleString()}
        </div>
        <div className="text-slate-400 text-sm mt-1">Total</div>
      </div>

      <div className="bg-slate-800 rounded-xl p-4">
        <div className="text-3xl font-bold text-purple-400">
          {spaces.toLocaleString()}
        </div>
        <div className="text-slate-400 text-sm mt-1">Spaces votes</div>
      </div>

      {/* Connection status */}
      <div className="col-span-3 flex items-center justify-center gap-2 text-xs text-slate-500">
        <span
          className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-400 animate-pulse" : "bg-red-400"}`}
        />
        {isConnected ? "Live" : "Reconnecting..."}
        {lastUpdated && (
          <span className="ml-2">
            Last update: {new Date(lastUpdated).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
