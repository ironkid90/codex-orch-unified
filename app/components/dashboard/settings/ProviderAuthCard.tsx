"use client";

import { useState } from "react";

import type { ProviderInventoryCardViewModel } from "@/app/hooks/useProviderAuthInventory";

import { AnthropicAuthSettings } from "./AnthropicAuthSettings";
import { GeminiAuthSettings } from "./GeminiAuthSettings";
import { OpenAIAuthSettings } from "./OpenAIAuthSettings";

interface ProviderAuthCardProps {
  provider: ProviderInventoryCardViewModel;
  onSaveToken?: (provider: string, options: { token: string; persistToEnv: boolean }) => Promise<void>;
  onRefresh?: (provider: string) => Promise<void>;
}

function renderProviderSettings(provider: ProviderInventoryCardViewModel) {
  if (provider.provider === "openai") return <OpenAIAuthSettings provider={provider} />;
  if (provider.provider === "gemini") return <GeminiAuthSettings provider={provider} />;
  if (provider.provider === "anthropic") return <AnthropicAuthSettings provider={provider} />;
  return <p className="provider-auth-summary">{provider.setupSummary}</p>;
}

/** Providers that support OAuth login flows */
const OAUTH_PROVIDERS: Record<string, { label: string; hint: string }> = {
  openai: { label: "Login with OpenAI OAuth", hint: "Uses ChatGPT / Codex session-based auth" },
  anthropic: { label: "Login with Anthropic OAuth", hint: "Uses Anthropic console OAuth" },
  gemini: { label: "Login with Google OAuth", hint: "Uses Google account for Gemini / Vertex" },
};

export function ProviderAuthCard({ provider, onSaveToken, onRefresh }: ProviderAuthCardProps) {
  const [token, setToken] = useState("");
  const [persistToEnv, setPersistToEnv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showOAuthInfo, setShowOAuthInfo] = useState(false);
  const [oauthInfo, setOAuthInfo] = useState<{ authUrl: string; scopes: string[] } | null>(null);

  async function handleSave() {
    if (!onSaveToken || !token.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await onSaveToken(provider.provider, { token: token.trim(), persistToEnv });
      setToken("");
      setMessage(persistToEnv ? "Saved to env." : "Saved for this dashboard session.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    if (!onRefresh) return;
    setBusy(true);
    setMessage(null);
    try {
      await onRefresh(provider.provider);
      setMessage("Status refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleOAuthInitiate() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/auth/oauth?provider=${encodeURIComponent(provider.provider)}&action=initiate`);
      const data = await res.json() as { authUrl?: string; scopes?: string[]; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.authUrl) {
        setOAuthInfo({ authUrl: data.authUrl, scopes: data.scopes || [] });
        setShowOAuthInfo(true);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const oauthDef = OAUTH_PROVIDERS[provider.provider];

  return (
    <article className="provider-auth-card">
      <div className="provider-auth-card-head">
        <div>
          <h3>{provider.title}</h3>
          <p className="provider-auth-source">
            {provider.statusLabel} · {provider.source}
          </p>
        </div>
        <span className={`badge ${provider.status === "active" ? "ok" : provider.status === "error" ? "err" : "warn"}`}>
          {provider.activeMode.replace(/_/g, " ")}
        </span>
      </div>

      {renderProviderSettings(provider)}

      {/* OAuth login button */}
      {oauthDef && (
        <div style={{ marginBottom: 12 }}>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            disabled={busy}
            onClick={() => void handleOAuthInitiate()}
          >
            <span style={{ fontSize: 14 }}>🔐</span>
            {oauthDef.label}
          </button>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>{oauthDef.hint}</p>

          {showOAuthInfo && oauthInfo && (
            <div style={{ marginTop: 8, padding: "10px 12px", background: "rgba(0,212,255,0.06)", borderRadius: "var(--radius-sm)", border: "1px solid rgba(0,212,255,0.15)" }}>
              <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--accent-cyan)", fontWeight: 600 }}>OAuth Authorization URL</p>
              <a
                href={oauthInfo.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, color: "var(--accent-cyan)", wordBreak: "break-all" }}
              >
                {oauthInfo.authUrl}
              </a>
              {oauthInfo.scopes.length > 0 && (
                <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
                  Scopes: {oauthInfo.scopes.join(", ")}
                </p>
              )}
              <p style={{ margin: "6px 0 0", fontSize: 10, color: "var(--text-secondary)" }}>
                After authorizing, paste the returned token in the field below and click Save.
              </p>
              <button
                type="button"
                style={{ marginTop: 6, fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                onClick={() => setShowOAuthInfo(false)}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      <div className="provider-token-entry">
        <label className="control-center-item">
          <span className="control-center-key">Token / API key</span>
          <span className="control-center-hint">Session only or optional env persistence — no manual .env.local editing required.</span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={`Enter ${provider.title} token or API key`}
          />
        </label>

        <div className="provider-auth-actions">
          <label className="feature-toggle provider-persist-toggle">
            <input
              type="checkbox"
              checked={persistToEnv}
              onChange={(event) => setPersistToEnv(event.target.checked)}
            />
            Save to env
          </label>
          <span className="provider-session-label">Session only</span>
          <button className="btn btn-secondary" disabled={busy || !token.trim() || !onSaveToken} onClick={() => void handleSave()}>
            Save token
          </button>
          <button className="btn btn-secondary" disabled={busy || !onRefresh} onClick={() => void handleRefresh()}>
            Refresh status
          </button>
        </div>
        {(message || provider.error) && <p className="control-center-message">{message || provider.error}</p>}
      </div>
    </article>
  );
}
