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
      <div className="glass-card" data-testid="memory-status-widget">
        <p className="empty-text">Loading memory status...</p>
      </div>
    );
  }

  const { inbox, tokens, recommendation } = status;
  const tokenPercentUsed = tokens.percentUsed;
  const isWarning = tokenPercentUsed > 75;
  const isCritical = tokenPercentUsed > 90;

  return (
    <div className="glass-card" data-testid="memory-status-widget">
      <div className="glass-card-head">
        <h2 data-testid="memory-status-heading">🧠 Global HAM Memory Status</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastRefresh && (
            <span className="header-meta">Checked: {lastRefresh}</span>
          )}
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="btn btn-secondary"
          >
            {loading ? "..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="round-list" style={{ marginTop: 0 }}>
        {/* Inbox Stats */}
        <div className="round-row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: '3px solid var(--accent-amber)' }}>
            <div className="control-label">NEW</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--accent-amber)' }}>
              {inbox.stats.NEW}
            </div>
          </div>
          <div style={{ flex: 1, padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: '3px solid var(--accent-cyan)' }}>
            <div className="control-label">REVIEWED</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--accent-cyan)' }}>
              {inbox.stats.REVIEWED}
            </div>
          </div>
          <div style={{ flex: 1, padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: '3px solid var(--accent-emerald)' }}>
            <div className="control-label">MERGED</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--accent-emerald)' }}>
              {inbox.stats.MERGED}
            </div>
          </div>
        </div>

        {/* Token Usage */}
        <div className="round-row" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="round-head" style={{ margin: 0 }}><strong>Token Budget</strong></span>
            <span className="header-meta">
              {tokens.estimated} / {tokens.budget}
            </span>
          </div>
          <div style={{ width: '100%', background: 'rgba(255,255,255,0.1)', borderRadius: 999, height: 6, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                background: isCritical ? 'var(--status-failed)' : isWarning ? 'var(--status-thinking)' : 'var(--status-completed)',
                width: `${Math.min(tokenPercentUsed, 100)}%`,
                transition: 'width 0.3s ease'
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            <span>{tokenPercentUsed}% used</span>
            <span>Recommended: &lt;75%</span>
          </div>
        </div>

        {/* Recommendation */}
        <div className={isCritical ? "error-banner" : "round-row"} style={!isCritical ? { background: isWarning ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.1)' } : {}}>
          <p style={{ margin: 0, fontSize: '0.82rem', color: isCritical ? 'var(--accent-rose)' : isWarning ? 'var(--accent-amber)' : 'var(--accent-emerald)' }}>
            {isCritical ? "🚨" : isWarning ? "⚠️" : "✅"} {recommendation}
          </p>
        </div>

        {/* Actions */}
        {inbox.pending > 0 && (
          <div className="round-row" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="round-head" style={{ margin: 0 }}><strong>Pending Entries</strong></div>
            <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {inbox.pendingEntries.slice(0, 5).map((entryId) => (
                <div
                  key={entryId}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: 6 }}
                >
                  <code className="header-meta">{entryId}</code>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => mergeInboxEntry(entryId, "decisions")}
                      className="badge info" style={{ border: 'none', cursor: 'pointer' }}
                    >
                      Decisions
                    </button>
                    <button
                      onClick={() => mergeInboxEntry(entryId, "patterns")}
                      className="badge info" style={{ border: 'none', cursor: 'pointer' }}
                    >
                      Patterns
                    </button>
                  </div>
                </div>
              ))}
              {inbox.pending > 5 && (
                <p className="empty-text">
                  +{inbox.pending - 5} more entries (see .memory/inbox.md)
                </p>
              )}
            </div>
          </div>
        )}

        {/* Manual Commands & Links */}
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="round-row" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="control-label">Manual Commands</div>
            <code className="empty-text" style={{ fontSize: '0.7rem' }}>npm run memory:status</code>
            <code className="empty-text" style={{ fontSize: '0.7rem' }}>npm run memory:merge &lt;id&gt;...</code>
            <code className="empty-text" style={{ fontSize: '0.7rem' }}>npm run memory:help</code>
          </div>
          <div className="round-row" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="control-label">Links</div>
            <a href="/.memory/inbox.md" target="_blank" className="badge ok" style={{ textDecoration: 'none', display: 'inline-block', width: 'fit-content' }}>
              📋 View Inbox
            </a>
            <a href="/.memory/decisions.md" target="_blank" className="badge warn" style={{ textDecoration: 'none', display: 'inline-block', width: 'fit-content' }}>
              📌 View Decisions
            </a>
            <a href="/.memory/audit-log.md" target="_blank" className="badge info" style={{ textDecoration: 'none', display: 'inline-block', width: 'fit-content' }}>
              📜 View Audit Log
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
