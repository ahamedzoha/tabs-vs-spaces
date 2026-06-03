"use client";

interface ScoreBarProps {
  tabs: number;
  spaces: number;
}

export function ScoreBar({ tabs, spaces }: ScoreBarProps) {
  const total = tabs + spaces;
  const tabsPct = total === 0 ? 50 : Math.round((tabs / total) * 100);
  const spacesPct = 100 - tabsPct;

  return (
    <div className="w-full space-y-2">
      {/* Bar */}
      <div className="relative h-8 w-full rounded-full overflow-hidden bg-slate-700">
        <div
          className="absolute left-0 top-0 h-full bg-blue-500 transition-all duration-500 ease-out"
          style={{ width: `${tabsPct}%` }}
        />
        <div
          className="absolute right-0 top-0 h-full bg-purple-500 transition-all duration-500 ease-out"
          style={{ width: `${spacesPct}%` }}
        />
      </div>

      {/* Labels */}
      <div className="flex justify-between text-sm font-medium">
        <span className="text-blue-400">Tabs {tabsPct}%</span>
        <span className="text-purple-400">{spacesPct}% Spaces</span>
      </div>
    </div>
  );
}
