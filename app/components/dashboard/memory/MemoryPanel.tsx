"use client";
import { useCallback, useEffect, useState } from "react";

interface InboxStats {
  total?: number;
  reviewed?: number;
  pending?: number;
}

interface MemoryStatus {
  timestamp: string;
  inbox: {
    stats: InboxStats;
    pending: number;
    pendingEntries: { id: string; summary: string; category?: string; timestamp?: string }[];
  };
  tokens: {
    estimated: number;
    budget: number;
    percentUsed: number;
  };
  recommendation: string;
}

export function MemoryPanel() {
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/swarm/memory-refresh?action=status");
      if (res.ok) {
        const data = await res.json();
        setMemoryStatus(data);
        setError(null);
      } else {
        setError("Failed to fetch memory status");
      }
    } catch { setError("Network error"); }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const triggerReview = async (entryId: string) => {
    setRefreshing(true);
    try {
      await fetch("/api/swarm/memory-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review", entryId }) });
      await fetchStatus();
    } catch { /* ignore */ }
    setRefreshing(false);
  };

  const triggerMerge = async (entryId: string, targetFile: string) => {
    setRefreshing(true);
    try {
      await fetch("/api/swarm/memory-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "merge", entryId, targetFile }) });
      await fetchStatus();
    } catch { /* ignore */ }
    setRefreshing(false);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 16, gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-primary)" }}>Long-term Memory</h2>
        <button onClick={fetchStatus} disabled={refreshing} style={{ padding: "6px 12px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", fontSize: 12, opacity: refreshing ? 0.5 : 1 }}>Refresh Status</button>
      </div>

      {error && <div style={{ padding: 10, background: "rgba(248,113,113,0.1)", border: "1px solid #f87171", borderRadius: "var(--radius-sm)", fontSize: 12, color: "#f87171" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <div style={{ padding: 16, background: "var(--bg-surface)", borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)", textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#22d3ee" }}>{memoryStatus?.inbox.stats.total ?? "—"}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Total Entries</div>
        </div>
        <div style={{ padding: 16, background: "var(--bg-surface)", borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)", textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#fbbf24" }}>{memoryStatus?.inbox.pending ?? "—"}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Pending</div>
        </div>
        <div style={{ padding: 16, background: "var(--bg-surface)", borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)", textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#a855f7" }}>{memoryStatus?.tokens.estimated ?? "—"}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Tokens Used</div>
        </div>
        <div style={{ padding: 16, background: "var(--bg-surface)", borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)", textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: memoryStatus && memoryStatus.tokens.percentUsed > 75 ? "#f87171" : "#34d399" }}>{memoryStatus?.tokens.percentUsed ?? "—"}%</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Budget Used</div>
        </div>
      </div>

      {memoryStatus?.recommendation && (
        <div style={{ padding: 12, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--glass-border)", fontSize: 12, color: "var(--text-secondary)" }}>
          💡 {memoryStatus.recommendation}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
        <div style={{ padding: 16, background: "var(--bg-surface)", borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)" }}>
          <h3 style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 8px" }}>HAM Protocol</h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
            Hierarchical Agent Memory (HAM) manages context across sessions. Inbox items from subagents are reviewed and merged into decisions and patterns. The system auto-refreshes on startup and periodically compresses old context into long-term storage.
          </p>
        </div>

        {memoryStatus?.inbox.pendingEntries && memoryStatus.inbox.pendingEntries.length > 0 && (
          <div>
            <h3 style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 8px" }}>Pending Entries</h3>
            {memoryStatus.inbox.pendingEntries.map((entry) => (
              <div key={entry.id} style={{ padding: 12, marginBottom: 8, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--glass-border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <span style={{ fontSize: 12, color: "#22d3ee" }}>[{entry.category || "note"}]</span>
                    <span style={{ fontSize: 12, color: "var(--text-primary)", marginLeft: 8 }}>{entry.summary}</span>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => triggerReview(entry.id)} disabled={refreshing} style={{ padding: "3px 8px", fontSize: 10, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}>Review</button>
                    <button onClick={() => triggerMerge(entry.id, "decisions")} disabled={refreshing} style={{ padding: "3px 8px", fontSize: 10, background: "#a855f7", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}>→ Decisions</button>
                    <button onClick={() => triggerMerge(entry.id, "patterns")} disabled={refreshing} style={{ padding: "3px 8px", fontSize: 10, background: "#34d399", color: "#000", border: "none", borderRadius: 3, cursor: "pointer" }}>→ Patterns</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
