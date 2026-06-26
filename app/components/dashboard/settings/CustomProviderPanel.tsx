"use client";

import { useState, useEffect, useCallback } from "react";

export interface CustomProviderFormData {
  id: string;
  displayName: string;
  type: "openai-compatible" | "azure-openai" | "anthropic" | "custom";
  baseUrl: string;
  apiKey: string;
  model: string;
  authMode: "api_key" | "bearer_token" | "oauth_token" | "none";
  oauthClientId: string;
  oauthAuthUrl: string;
  oauthTokenUrl: string;
  oauthScopes: string;
  headers: string;
}

interface CustomProviderEntry {
  id: string;
  displayName: string;
  type: string;
  baseUrl: string;
  model: string;
  authMode?: string;
  status: "active" | "unconfigured" | "error";
  createdAt: string;
  updatedAt: string;
}

const EMPTY_FORM: CustomProviderFormData = {
  id: "",
  displayName: "",
  type: "openai-compatible",
  baseUrl: "",
  apiKey: "",
  model: "gpt-4o",
  authMode: "api_key",
  oauthClientId: "",
  oauthAuthUrl: "",
  oauthTokenUrl: "",
  oauthScopes: "",
  headers: "",
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseHeaders(raw: string): Record<string, string> | undefined {
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    // Try key: value format
    const result: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (key && value) result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
}

interface CustomProviderPanelProps {
  workspace?: string | null;
  onProviderSaved?: (id: string) => void;
}

export function CustomProviderPanel({ workspace, onProviderSaved }: CustomProviderPanelProps) {
  const [providers, setProviders] = useState<Record<string, CustomProviderEntry>>({});
  const [loadStatus, setLoadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [form, setForm] = useState<CustomProviderFormData>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const loadProviders = useCallback(async () => {
    setLoadStatus("loading");
    try {
      const params = new URLSearchParams();
      if (workspace) params.set("workspace", workspace);
      const res = await fetch(`/api/auth/custom-providers?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { customProviders: Record<string, CustomProviderEntry> };
      setProviders(data.customProviders || {});
      setLoadStatus("ready");
    } catch (err) {
      setLoadStatus("error");
    }
  }, [workspace]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  function handleEdit(id: string) {
    const p = providers[id];
    if (!p) return;
    setForm({
      id: p.id,
      displayName: p.displayName,
      type: (p.type as CustomProviderFormData["type"]) || "openai-compatible",
      baseUrl: p.baseUrl,
      apiKey: "",
      model: p.model,
      authMode: (p.authMode as CustomProviderFormData["authMode"]) || "api_key",
      oauthClientId: "",
      oauthAuthUrl: "",
      oauthTokenUrl: "",
      oauthScopes: "",
      headers: "",
    });
    setEditingId(id);
    setShowForm(true);
    setMessage(null);
  }

  function handleNew() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setMessage(null);
    setShowAdvanced(false);
  }

  function handleCancel() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setMessage(null);
  }

  function updateField<K extends keyof CustomProviderFormData>(key: K, value: CustomProviderFormData[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-generate ID from display name if creating new
      if (key === "displayName" && !editingId && !prev.id) {
        next.id = slugify(value as string);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!form.displayName.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      setMessage({ text: "Display name, Base URL, and Model are required.", type: "err" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const params = new URLSearchParams();
      if (workspace) params.set("workspace", workspace);
      const payload = {
        id: form.id || slugify(form.displayName),
        displayName: form.displayName.trim(),
        type: form.type,
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim() || undefined,
        model: form.model.trim(),
        authMode: form.authMode,
        oauthClientId: form.oauthClientId.trim() || undefined,
        oauthAuthUrl: form.oauthAuthUrl.trim() || undefined,
        oauthTokenUrl: form.oauthTokenUrl.trim() || undefined,
        oauthScopes: form.oauthScopes.trim() ? form.oauthScopes.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        headers: parseHeaders(form.headers),
      };
      const res = await fetch(`/api/auth/custom-providers?${params.toString()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json() as { customProvider: CustomProviderEntry };
      setMessage({ text: `Provider "${data.customProvider.displayName}" saved.`, type: "ok" });
      await loadProviders();
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      onProviderSaved?.(data.customProvider.id);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), type: "err" });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(`Delete custom provider "${providers[id]?.displayName}"?`)) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({ id });
      if (workspace) params.set("workspace", workspace);
      const res = await fetch(`/api/auth/custom-providers?${params.toString()}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadProviders();
      setMessage({ text: `Provider "${id}" deleted.`, type: "ok" });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), type: "err" });
    } finally {
      setBusy(false);
    }
  }

  async function handleTestOAuth(provider: "openai" | "anthropic" | "google" | string) {
    try {
      const params = new URLSearchParams({ provider, action: "initiate" });
      if (workspace) params.set("workspace", workspace);
      const res = await fetch(`/api/auth/oauth?${params.toString()}`);
      const data = await res.json() as { authUrl?: string; scopes?: string[]; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.authUrl) {
        setMessage({ text: `OAuth URL: ${data.authUrl} (scopes: ${(data.scopes || []).join(", ")})`, type: "ok" });
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), type: "err" });
    }
  }

  const providerList = Object.values(providers);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, color: "var(--text-primary)", fontWeight: 600 }}>Custom API Providers</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
            Add any OpenAI-compatible, Anthropic, or custom endpoint with full tool support.
          </p>
        </div>
        <button
          className="btn btn-primary"
          style={{ fontSize: 12, padding: "6px 14px" }}
          onClick={handleNew}
          disabled={busy}
        >
          + Add Provider
        </button>
      </div>

      {/* Message */}
      {message && (
        <p style={{ margin: 0, fontSize: 12, color: message.type === "ok" ? "var(--accent-emerald)" : "var(--accent-rose)", padding: "8px 12px", background: message.type === "ok" ? "rgba(16,185,129,0.08)" : "rgba(244,63,94,0.08)", borderRadius: "var(--radius-sm)", border: `1px solid ${message.type === "ok" ? "rgba(16,185,129,0.2)" : "rgba(244,63,94,0.2)"}` }}>
          {message.text}
        </p>
      )}

      {/* Existing providers list */}
      {loadStatus === "loading" && (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading custom providers…</p>
      )}
      {loadStatus === "ready" && providerList.length === 0 && !showForm && (
        <div style={{ padding: "24px 16px", textAlign: "center", background: "var(--glass)", borderRadius: "var(--radius-md)", border: "1px dashed var(--glass-border)" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>No custom providers yet. Click <strong>+ Add Provider</strong> to get started.</p>
        </div>
      )}
      {providerList.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {providerList.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--glass-border)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{p.displayName}</span>
                  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: p.status === "active" ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)", color: p.status === "active" ? "var(--accent-emerald)" : "var(--accent-amber)" }}>{p.status}</span>
                  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: "var(--glass)", color: "var(--text-muted)" }}>{p.type}</span>
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.baseUrl} · {p.model}</p>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-secondary" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => handleEdit(p.id)} disabled={busy}>Edit</button>
                <button className="btn btn-secondary" style={{ fontSize: 11, padding: "4px 10px", color: "var(--accent-rose)" }} onClick={() => void handleDelete(p.id)} disabled={busy}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit form */}
      {showForm && (
        <div style={{ padding: 16, background: "var(--bg-elevated)", borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border-hover)", display: "flex", flexDirection: "column", gap: 12 }}>
          <h4 style={{ margin: 0, fontSize: 14, color: "var(--text-primary)" }}>{editingId ? "Edit Provider" : "New Custom Provider"}</h4>

          {/* Basic fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>Display Name *</span>
              <input className="input" type="text" value={form.displayName} onChange={(e) => updateField("displayName", e.target.value)} placeholder="My Custom API" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>Provider ID</span>
              <input className="input" type="text" value={form.id} onChange={(e) => updateField("id", e.target.value)} placeholder="auto-generated" />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>Base URL *</span>
              <input className="input" type="url" value={form.baseUrl} onChange={(e) => updateField("baseUrl", e.target.value)} placeholder="https://api.example.com/v1" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>Default Model *</span>
              <input className="input" type="text" value={form.model} onChange={(e) => updateField("model", e.target.value)} placeholder="gpt-4o" />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>Provider Type</span>
              <select className="input" value={form.type} onChange={(e) => updateField("type", e.target.value as CustomProviderFormData["type"])}>
                <option value="openai-compatible">OpenAI-Compatible</option>
                <option value="azure-openai">Azure OpenAI</option>
                <option value="anthropic">Anthropic / Claude</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>Auth Mode</span>
              <select className="input" value={form.authMode} onChange={(e) => updateField("authMode", e.target.value as CustomProviderFormData["authMode"])}>
                <option value="api_key">API Key</option>
                <option value="bearer_token">Bearer Token</option>
                <option value="oauth_token">OAuth Token</option>
                <option value="none">No Auth</option>
              </select>
            </label>
          </div>

          {(form.authMode === "api_key" || form.authMode === "bearer_token") && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>API Key / Token</span>
              <input className="input" type="password" autoComplete="off" value={form.apiKey} onChange={(e) => updateField("apiKey", e.target.value)} placeholder="sk-..." />
            </label>
          )}

          {/* Advanced / OAuth section */}
          <button
            type="button"
            style={{ alignSelf: "flex-start", fontSize: 11, color: "var(--accent-cyan)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "▾ Hide advanced settings" : "▸ Show advanced settings (OAuth, custom headers)"}
          </button>

          {showAdvanced && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 0 0", borderTop: "1px solid var(--glass-border)" }}>
              {form.authMode === "oauth_token" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>OAuth Client ID</span>
                      <input className="input" type="text" value={form.oauthClientId} onChange={(e) => updateField("oauthClientId", e.target.value)} placeholder="client_id" />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>OAuth Scopes (comma-separated)</span>
                      <input className="input" type="text" value={form.oauthScopes} onChange={(e) => updateField("oauthScopes", e.target.value)} placeholder="openid,profile,email" />
                    </label>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>OAuth Auth URL</span>
                      <input className="input" type="url" value={form.oauthAuthUrl} onChange={(e) => updateField("oauthAuthUrl", e.target.value)} placeholder="https://provider.com/oauth/authorize" />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>OAuth Token URL</span>
                      <input className="input" type="url" value={form.oauthTokenUrl} onChange={(e) => updateField("oauthTokenUrl", e.target.value)} placeholder="https://provider.com/oauth/token" />
                    </label>
                  </div>
                </>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>Custom Headers (JSON or key: value per line)</span>
                <textarea
                  className="input"
                  rows={3}
                  value={form.headers}
                  onChange={(e) => updateField("headers", e.target.value)}
                  placeholder={'{"X-Custom-Header": "value"}\nor:\nX-Custom-Header: value'}
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11, resize: "vertical" }}
                />
              </label>

              {/* Built-in OAuth shortcuts */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>Quick OAuth Info (built-in providers)</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(["openai", "anthropic", "google"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 11, padding: "4px 10px" }}
                      onClick={() => void handleTestOAuth(p)}
                    >
                      {p === "openai" ? "OpenAI OAuth Info" : p === "anthropic" ? "Anthropic OAuth Info" : "Google OAuth Info"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Form actions */}
          <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
            <button className="btn btn-primary" onClick={() => void handleSave()} disabled={busy || !form.displayName.trim() || !form.baseUrl.trim()}>
              {busy ? "Saving…" : editingId ? "Update Provider" : "Add Provider"}
            </button>
            <button className="btn btn-secondary" onClick={handleCancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
