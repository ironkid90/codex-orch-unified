"use client";

import { useEffect, useState } from "react";
import { AGENT_IDS } from "@/lib/swarm/types";
import type { AgentId } from "@/lib/swarm/types";

interface AntigravityStatus {
  connected: boolean;
  baseUrl: string;
  models: string[];
  health: boolean;
  error?: string;
}

interface AntigravityAccount {
  id: string;
  provider?: string;
  status?: string;
  tier?: string;
  rpm?: number;
  tpm?: number;
}

interface AntigravityAccountsPayload {
  available: boolean;
  accounts: AntigravityAccount[];
  message?: string;
}

interface RoutingConfig {
  assignments?: Record<string, { provider: string; model: string }>;
}

export function AntigravityPanel() {
  const [status, setStatus] = useState<AntigravityStatus | null>(null);
  const [accountsPayload, setAccountsPayload] = useState<AntigravityAccountsPayload | null>(null);
  const [routing, setRouting] = useState<RoutingConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [statusRes, accountsRes, routingRes] = await Promise.all([
        fetch("/api/antigravity/status").then((r) => r.json()),
        fetch("/api/antigravity/accounts").then((r) => r.json()),
        fetch("/api/antigravity/routing").then((r) => r.json()),
      ]);

      setStatus(statusRes);
      setAccountsPayload(accountsRes);
      setRouting(routingRes);
    } catch (err) {
      console.error("Failed to load Antigravity data", err);
    } finally {
      setLoading(false);
    }
  };

  const updateMapping = async (agentId: AgentId, model: string) => {
    if (!routing) return;
    
    // Default to the first available models if removing/changing
    const newProvider = model ? "antigravity" : "openai"; 
    
    const newAssignments = {
      ...(routing.assignments || {}),
      [agentId]: { provider: newProvider, model },
    };

    setRouting({ ...routing, assignments: newAssignments });
  };

  const saveMapping = async () => {
    if (!routing) return;
    try {
      setSaving(true);
      const res = await fetch("/api/antigravity/routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments: routing.assignments }),
      });
      if (!res.ok) throw new Error("Failed to save routing");
      alert("✅ Agent models mapped via Antigravity Proxy.");
    } catch (err) {
      alert(`❌ Error saving mapping: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  if (!status) {
    return (
      <div className="glass-card" data-testid="ag-status-widget">
        <p className="empty-text">Loading Antigravity status...</p>
      </div>
    );
  }

  const isConnected = status.connected;

  return (
    <div className="glass-card" data-testid="ag-status-widget">
      <div className="glass-card-head">
        <div className="flex items-center gap-2">
          <h2>🌌 Antigravity Proxy Status</h2>
          <span className={`badge ${isConnected ? "ok" : "err"}`}>
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="btn btn-secondary"
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      <div className="round-list" style={{ marginTop: 0 }}>
        <div className="round-row">
          <div className="round-detail">
            Endpoint: <code className="header-meta">{status.baseUrl}</code>
          </div>
        </div>

        {accountsPayload?.available && (
          <div className="round-row" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="round-head"><strong>Account Pool Overview</strong></div>
            <div className="grid gap-2 text-xs">
              {accountsPayload.accounts.length === 0 ? (
                <p className="empty-text" style={{ margin: 0 }}>No accounts loaded in proxy.</p>
              ) : (
                accountsPayload.accounts.map((acc, i) => (
                  <div key={acc.id || i} className="flex justify-between items-center bg-[rgba(255,255,255,0.03)] p-2 rounded">
                    <span className="font-mono">{acc.id || `Account ${i+1}`} {acc.provider && `(${acc.provider})`}</span>
                    <span className={`badge ${acc.status === 'active' ? 'ok' : 'info'}`}>
                      {acc.status || 'unknown'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {!accountsPayload?.available && (
           <div className="error-banner">
             <p>{accountsPayload?.message || "Account pool data not available via proxy."}</p>
           </div>
        )}

        {isConnected && (
          <div className="round-row" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="round-head"><strong>Agent → Model Mapping</strong></div>
            <div className="grid grid-cols-2 gap-3">
              {AGENT_IDS.map((agent) => {
                const currentAssignment = routing?.assignments?.[agent] || { provider: "openai", model: "gpt-4o" };
                const currentModel = currentAssignment.model;
                return (
                  <div key={agent} className="flex flex-col gap-1">
                    <label className="control-label">{agent}</label>
                    <select 
                      value={currentAssignment.provider === "antigravity" ? currentModel : ""}
                      onChange={(e) => updateMapping(agent, e.target.value)}
                      className="select"
                    >
                      <option value="" disabled>-- Use Default Config --</option>
                      {status.models.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end pt-2">
              <button 
                onClick={saveMapping} 
                disabled={saving}
                className="btn btn-primary"
              >
                {saving ? "Saving..." : "Save Route Mapping"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
