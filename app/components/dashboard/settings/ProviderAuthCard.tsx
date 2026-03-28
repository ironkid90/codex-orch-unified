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

export function ProviderAuthCard({ provider, onSaveToken, onRefresh }: ProviderAuthCardProps) {
  const [token, setToken] = useState("");
  const [persistToEnv, setPersistToEnv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
            placeholder={`Enter ${provider.title} token`}
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
