"use client";

import { useEffect, useMemo, useState } from "react";

import {
  applyRoutingPreset,
  buildRoutingAssignmentDiff,
  buildRoutingProviderCatalog,
  formatRoutingPreference,
  normalizeRoutingConfig,
  ROUTING_PROVIDERS,
  validateRoutingDraft,
  type RoutingConfigShape,
  type RoutingPreference,
  type RoutingPresetId,
} from "@/app/lib/antigravity/routing-console";
import { AGENT_IDS, type AgentId } from "@/lib/swarm/types";

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

interface RoutingResponse extends RoutingConfigShape {
  error?: string;
}

function summarizeProbeHealth(routing: RoutingConfigShape | null): { total: number; available: number } {
  const probes = routing?.probes ?? [];
  return {
    total: probes.length,
    available: probes.filter((probe) => probe.available).length,
  };
}

export function AntigravityPanel() {
  const [status, setStatus] = useState<AntigravityStatus | null>(null);
  const [accountsPayload, setAccountsPayload] = useState<AntigravityAccountsPayload | null>(null);
  const [routing, setRouting] = useState<RoutingConfigShape | null>(null);
  const [draftAssignments, setDraftAssignments] = useState<Partial<Record<AgentId, RoutingPreference>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      setMessage(null);

      const [statusRes, accountsRes, routingRes] = await Promise.all([
        fetch("/api/antigravity/status", { cache: "no-store" }).then((response) => response.json()),
        fetch("/api/antigravity/accounts", { cache: "no-store" }).then((response) => response.json()),
        fetch("/api/antigravity/routing", { cache: "no-store" }).then((response) => response.json()),
      ]);

      const nextRouting = normalizeRoutingConfig(routingRes as RoutingResponse);
      setStatus(statusRes as AntigravityStatus);
      setAccountsPayload(accountsRes as AntigravityAccountsPayload);
      setRouting(nextRouting);
      setDraftAssignments({ ...(nextRouting.assignments ?? {}) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Antigravity data.");
    } finally {
      setLoading(false);
    }
  };

  const catalog = useMemo(
    () => buildRoutingProviderCatalog({ statusModels: status?.models, probes: routing?.probes, routing }),
    [routing, status?.models],
  );
  const validation = useMemo(
    () => validateRoutingDraft({ assignments: draftAssignments, catalog }),
    [catalog, draftAssignments],
  );
  const diff = useMemo(
    () => buildRoutingAssignmentDiff(routing?.assignments, draftAssignments),
    [draftAssignments, routing?.assignments],
  );
  const probeHealth = summarizeProbeHealth(routing);

  const updateAssignment = (agentId: AgentId, patch: Partial<RoutingPreference>) => {
    setDraftAssignments((current) => {
      const previous = current[agentId] ?? routing?.assignments?.[agentId] ?? { provider: "openai", model: undefined };
      return {
        ...current,
        [agentId]: {
          ...previous,
          ...patch,
        },
      };
    });
    setMessage(null);
  };

  const updateProvider = (agentId: AgentId, nextProvider: RoutingPreference["provider"]) => {
    const providerCatalog = catalog.find((entry) => entry.provider === nextProvider);
    const previous = draftAssignments[agentId] ?? routing?.assignments?.[agentId];
    const nextModel = previous?.provider === nextProvider
      ? previous.model
      : providerCatalog?.availableModels[0] ?? providerCatalog?.models[0] ?? "";

    updateAssignment(agentId, {
      provider: nextProvider,
      model: nextModel,
    });
  };

  const applyPreset = (preset: RoutingPresetId) => {
    const nextAssignments = applyRoutingPreset({
      preset,
      assignments: draftAssignments,
      catalog,
    });
    setDraftAssignments(nextAssignments);
    setMessage(
      preset === "proxy-first"
        ? "Proxy-first preset applied. Review the draft before saving."
        : preset === "throughput"
          ? "Throughput preset applied. Workers were shifted toward faster candidates."
          : "Balanced preset applied.",
    );
  };

  const resetDraft = () => {
    setDraftAssignments({ ...(routing?.assignments ?? {}) });
    setMessage("Draft changes discarded.");
  };

  const saveMapping = async () => {
    if (!routing) return;
    try {
      setSaving(true);
      setError(null);
      setMessage(null);

      const response = await fetch("/api/antigravity/routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignments: draftAssignments,
          statusModels: status?.models ?? [],
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save routing.");
      }

      const nextRouting = normalizeRoutingConfig(payload.config ?? payload);
      setRouting(nextRouting);
      setDraftAssignments({ ...(nextRouting.assignments ?? {}) });
      setMessage(diff.length > 0 ? `Saved ${diff.length} routing change${diff.length === 1 ? "" : "s"}.` : "Routing saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save routing.");
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
    <div className="glass-card antigravity-console" data-testid="ag-status-widget">
      <div className="glass-card-head">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2>🌌 Antigravity Routing Console</h2>
            <span className={`badge ${isConnected ? "ok" : "err"}`}>
              {isConnected ? "Connected" : "Disconnected"}
            </span>
            <span className={`badge ${status.health ? "ok" : "warn"}`}>
              {status.health ? "Proxy healthy" : "Proxy degraded"}
            </span>
          </div>
          <div className="agent-detail">Endpoint: {status.baseUrl}</div>
        </div>
        <div className="antigravity-console__actions">
          <button onClick={() => applyPreset("throughput")} className="btn btn-secondary" disabled={saving || loading}>
            Throughput preset
          </button>
          <button onClick={() => applyPreset("proxy-first")} className="btn btn-secondary" disabled={saving || loading || !status.models.length}>
            Proxy-first preset
          </button>
          <button onClick={resetDraft} className="btn btn-secondary" disabled={saving || loading || diff.length === 0}>
            Reset draft
          </button>
          <button onClick={() => void fetchData()} disabled={loading || saving} className="btn btn-secondary">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            onClick={() => void saveMapping()}
            disabled={saving || loading || diff.length === 0 || !validation.valid}
            className="btn btn-primary"
          >
            {saving ? "Saving…" : diff.length > 0 ? `Save ${diff.length} change${diff.length === 1 ? "" : "s"}` : "Save routing"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-banner" style={{ marginTop: 12 }}>
          <p>{error}</p>
        </div>
      ) : null}
      {message ? (
        <div className="round-row antigravity-console__message" style={{ marginTop: 12 }}>
          <p style={{ margin: 0 }}>{message}</p>
        </div>
      ) : null}

      <div className="dashboard-metric-strip" style={{ marginTop: 14 }}>
        <div className="metric-card">
          <span className="label">Draft changes</span>
          <span className="value">{diff.length}</span>
          <span className="sub">Assignments modified</span>
        </div>
        <div className="metric-card">
          <span className="label">Probe health</span>
          <span className="value">{probeHealth.available}/{probeHealth.total || 0}</span>
          <span className="sub">Available candidates</span>
        </div>
        <div className="metric-card">
          <span className="label">Proxy models</span>
          <span className="value">{status.models.length}</span>
          <span className="sub">Live Antigravity catalog</span>
        </div>
        <div className="metric-card">
          <span className="label">Accounts</span>
          <span className="value">{accountsPayload?.accounts.length ?? 0}</span>
          <span className="sub">Proxy pool entries</span>
        </div>
      </div>

      {validation.errors.length > 0 ? (
        <div className="error-banner" style={{ marginTop: 12 }}>
          <strong>Validation blockers</strong>
          <ul className="round-notes" style={{ marginTop: 8 }}>
            {validation.errors.map((entry) => <li key={entry}>{entry}</li>)}
          </ul>
        </div>
      ) : null}

      {validation.warnings.length > 0 ? (
        <div className="round-row" style={{ marginTop: 12, background: "rgba(245, 158, 11, 0.10)" }}>
          <strong style={{ display: "block", marginBottom: 6 }}>Warnings</strong>
          <ul className="round-notes">
            {validation.warnings.map((entry) => <li key={entry}>{entry}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="content-grid equal" style={{ marginTop: 14 }}>
        <section className="glass-card antigravity-console__section">
          <div className="glass-card-head">
            <h2>Probe health</h2>
            <span className="badge info">{routing?.probes?.length ?? 0}</span>
          </div>
          <div className="round-list antigravity-console__list">
            {routing?.probes?.length ? (
              routing.probes.map((probe) => (
                <div key={`${probe.provider}-${probe.model}-${probe.candidateId}`} className="round-row">
                  <div className="round-head">
                    <strong>{probe.candidateId || `${probe.provider}/${probe.model}`}</strong>
                    <span className={`badge ${probe.available ? "ok" : "warn"}`}>{probe.available ? "available" : "offline"}</span>
                  </div>
                  <div className="round-detail">
                    {probe.provider || "unknown"}/{probe.model || "unknown"}
                    {probe.latencyMs ? ` · ${probe.latencyMs}ms` : ""}
                    <br />
                    {probe.detail || "No probe details provided."}
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-text">No routing probes found in model-routing.json.</p>
            )}
          </div>
        </section>

        <section className="glass-card antigravity-console__section">
          <div className="glass-card-head">
            <h2>Account pool overview</h2>
            <span className={`badge ${accountsPayload?.available ? "ok" : "warn"}`}>
              {accountsPayload?.available ? "live" : "unavailable"}
            </span>
          </div>
          {accountsPayload?.available ? (
            <div className="round-list antigravity-console__list">
              {accountsPayload.accounts.length === 0 ? (
                <p className="empty-text">No accounts loaded in the Antigravity proxy.</p>
              ) : (
                accountsPayload.accounts.map((account, index) => (
                  <div key={account.id || index} className="round-row">
                    <div className="round-head">
                      <strong>{account.id || `Account ${index + 1}`}</strong>
                      <span className={`badge ${account.status === "active" ? "ok" : "info"}`}>{account.status || "unknown"}</span>
                    </div>
                    <div className="round-detail">
                      {account.provider || "unknown provider"}
                      {account.tier ? ` · ${account.tier}` : ""}
                      {typeof account.rpm === "number" ? ` · ${account.rpm} rpm` : ""}
                      {typeof account.tpm === "number" ? ` · ${account.tpm} tpm` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <p className="empty-text">{accountsPayload?.message || "Account pool data not available via the proxy."}</p>
          )}
        </section>
      </div>

      <section className="glass-card antigravity-console__section" style={{ marginTop: 14 }}>
        <div className="glass-card-head">
          <h2>Role assignments</h2>
          <span className={`badge ${diff.length > 0 ? "warn" : "info"}`}>{diff.length > 0 ? "draft modified" : "in sync"}</span>
        </div>

        <div className="antigravity-console__role-grid">
          {AGENT_IDS.map((agentId) => {
            const currentAssignment = routing?.assignments?.[agentId] ?? null;
            const draftAssignment = draftAssignments[agentId] ?? currentAssignment ?? { provider: "openai", model: "" };
            const providerCatalog = catalog.find((entry) => entry.provider === draftAssignment.provider);
            const availableModels = providerCatalog?.availableModels.length
              ? providerCatalog.availableModels
              : providerCatalog?.models ?? [];
            const fallbackEntries = routing?.fallback?.[agentId] ?? [];
            const changed = diff.some((entry) => entry.agentId === agentId);

            return (
              <article key={agentId} className={`antigravity-console__role-card ${changed ? "changed" : ""}`}>
                <div className="antigravity-console__role-head">
                  <div>
                    <strong>{agentId}</strong>
                    <div className="agent-detail">Current: {formatRoutingPreference(currentAssignment)}</div>
                  </div>
                  <span className={`badge ${changed ? "warn" : "info"}`}>{changed ? "changed" : "stable"}</span>
                </div>

                <label className="control-label">Provider</label>
                <select
                  className="select"
                  value={draftAssignment.provider}
                  onChange={(event) => updateProvider(agentId, event.target.value as RoutingPreference["provider"])}
                >
                  {ROUTING_PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>{provider}</option>
                  ))}
                </select>

                <label className="control-label" style={{ marginTop: 10 }}>Model</label>
                <select
                  className="select"
                  value={draftAssignment.model ?? ""}
                  onChange={(event) => updateAssignment(agentId, { model: event.target.value })}
                >
                  <option value="">Select a model</option>
                  {availableModels.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>

                <div className="round-detail" style={{ marginTop: 10 }}>
                  Known models: {providerCatalog?.models.length ?? 0}
                  {providerCatalog?.availableModels.length ? ` · ${providerCatalog.availableModels.length} available now` : ""}
                </div>
                {draftAssignment.rationale ? (
                  <div className="round-detail">{draftAssignment.rationale}</div>
                ) : null}

                <div className="antigravity-console__fallbacks">
                  <div className="control-label">Fallback chain</div>
                  {fallbackEntries.length > 0 ? (
                    <ul className="round-notes">
                      {fallbackEntries.map((entry, index) => (
                        <li key={`${agentId}-${entry.provider}-${entry.model}-${index}`}>
                          {formatRoutingPreference(entry)}
                          {entry.rationale ? ` — ${entry.rationale}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty-text">No fallback chain configured.</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="glass-card antigravity-console__section" style={{ marginTop: 14 }}>
        <div className="glass-card-head">
          <h2>Pending diff</h2>
          <span className="badge info">{diff.length}</span>
        </div>
        {diff.length > 0 ? (
          <div className="round-list">
            {diff.map((entry) => (
              <div key={entry.agentId} className="round-row">
                <div className="round-head">
                  <strong>{entry.agentId}</strong>
                  <span className="badge warn">pending</span>
                </div>
                <div className="round-detail">
                  {formatRoutingPreference(entry.before)} → {formatRoutingPreference(entry.after)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-text">No unsaved routing changes.</p>
        )}
      </section>
    </div>
  );
}
