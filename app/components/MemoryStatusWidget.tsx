// app/components/MemoryStatusWidget.tsx
// Dashboard widget for HAM memory status and refresh controls

"use client";

import { useEffect, useState } from "react";

interface MemoryStatus {
  timestamp: string;
  inbox: {
    stats: {
      NEW: number;
      REVIEWED: number;
      MERGED: number;
    };
    pending: number;
    pendingEntries: string[];
  };
  tokens: {
    estimated: number;
    budget: number;
    percentUsed: number;
  };
  recommendation: string;
}

export function MemoryStatusWidget() {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/swarm/memory-refresh?action=status");
      if (!res.ok) throw new Error("Failed to fetch memory status");

      const data = await res.json();
      setStatus(data);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (error) {
      console.error("Memory status fetch error:", error);
    } finally {
      setLoading(false);
    }
  };

  const merge InboxEntry = async (entryId: string, targetFile: "decisions" | "patterns") => {
  const mergeInboxEntry = async (entryId: string, targetFile: "decisions" | "patterns") => {
    try {
      const res = await fetch("/api/swarm/memory-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "merge",
          entryId,
          targetFile,
        }),
      });

      if (!res.ok) throw new Error("Merge failed");

      alert(`✅ Merged ${entryId} into ${targetFile}.md`);
      await fetchStatus();
    } catch (error) {
      alert(`❌ Merge failed: ${error}`);
    }
  };

  if (!status) {
    return (
      <div className="border rounded-lg p-4 bg-gray-50">
        <p className="text-sm text-gray-500">Loading memory status...</p>
      </div>
    );
  }

  const { inbox, tokens, recommendation } = status;
  const tokenPercentUsed = tokens.percentUsed;
  const isWarning = tokenPercentUsed > 75;
  const isCritical = tokenPercentUsed > 90;

  return (
    <div className="border rounded-lg p-4 bg-gradient-to-br from-blue-50 to-indigo-50 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">🧠 Global HAM Memory Status</h3>
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {lastRefresh && (
        <p className="text-xs text-gray-500">Last checked: {lastRefresh}</p>
      )}

      {/* Inbox Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded p-3 border-l-4 border-yellow-400">
          <div className="text-xs font-semibold text-gray-600">NEW</div>
          <div className="text-2xl font-bold text-yellow-600">
            {inbox.stats.NEW}
          </div>
        </div>
        <div className="bg-white rounded p-3 border-l-4 border-blue-400">
          <div className="text-xs font-semibold text-gray-600">REVIEWED</div>
          <div className="text-2xl font-bold text-blue-600">
            {inbox.stats.REVIEWED}
          </div>
        </div>
        <div className="bg-white rounded p-3 border-l-4 border-green-400">
          <div className="text-xs font-semibold text-gray-600">MERGED</div>
          <div className="text-2xl font-bold text-green-600">
            {inbox.stats.MERGED}
          </div>
        </div>
      </div>

      {/* Token Usage */}
      <div className="bg-white rounded p-3 space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold">Token Budget</span>
          <span className="text-sm font-mono">
            {tokens.estimated} / {tokens.budget}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full transition-all ${
              isCritical
                ? "bg-red-500"
                : isWarning
                  ? "bg-yellow-500"
                  : "bg-green-500"
            }`}
            style={{ width: `${Math.min(tokenPercentUsed, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-600">
          <span>{tokenPercentUsed}% used</span>
          <span>Recommended: &lt;75%</span>
        </div>
      </div>

      {/* Recommendation */}
      <div
        className={`rounded p-3 text-sm ${
          isCritical
            ? "bg-red-100 text-red-700"
            : isWarning
              ? "bg-yellow-100 text-yellow-700"
              : "bg-green-100 text-green-700"
        }`}
      >
        {isCritical ? "🚨" : isWarning ? "⚠️" : "✅"} {recommendation}
      </div>

      {/* Actions */}
      {inbox.pending > 0 && (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          <p className="text-sm font-semibold">Pending Entries:</p>
          {inbox.pendingEntries.slice(0, 5).map((entryId) => (
            <div
              key={entryId}
              className="flex items-center justify-between bg-white rounded p-2 text-xs"
            >
              <code className="text-gray-600">{entryId}</code>
              <div className="flex gap-2">
                <button
                  onClick={() => mergeInboxEntry(entryId, "decisions")}
                  className="px-2 py-1 text-white bg-purple-500 rounded hover:bg-purple-600"
                >
                  Decisions
                </button>
                <button
                  onClick={() => mergeInboxEntry(entryId, "patterns")}
                  className="px-2 py-1 text-white bg-purple-500 rounded hover:bg-purple-600"
                >
                  Patterns
                </button>
              </div>
            </div>
          ))}
          {inbox.pending > 5 && (
            <p className="text-xs text-gray-500 font-semibold">
              +{inbox.pending - 5} more entries (see .memory/inbox.md)
            </p>
          )}
        </div>
      )}

      {/* Manual Commands */}
      <div className="bg-white rounded p-3 text-xs space-y-1 border border-gray-200">
        <p className="font-semibold text-gray-700">Manual Commands:</p>
        <code className="block text-gray-600 pl-2">
          npm run memory:status
        </code>
        <code className="block text-gray-600 pl-2">
          npm run memory:merge &lt;id&gt; &lt;decisions|patterns&gt;
        </code>
        <code className="block text-gray-600 pl-2">
          npm run memory:help
        </code>
      </div>

      {/* Links */}
      <div className="space-y-1 text-xs">
        <a
          href="/.memory/inbox.md"
          target="_blank"
          className="block text-blue-600 hover:underline"
        >
          📋 View Inbox
        </a>
        <a
          href="/.memory/decisions.md"
          target="_blank"
          className="block text-blue-600 hover:underline"
        >
          📌 View Decisions
        </a>
        <a
          href="/.memory/audit-log.md"
          target="_blank"
          className="block text-blue-600 hover:underline"
        >
          📜 View Audit Log
        </a>
      </div>
    </div>
  );
}
