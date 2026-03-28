import type { ProviderInventoryViewModel } from "@/app/hooks/useProviderAuthInventory";

import { ProviderAuthCard } from "./ProviderAuthCard";

interface ProviderStatusInventoryProps {
  inventory: ProviderInventoryViewModel;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  onSaveToken?: (provider: string, options: { token: string; persistToEnv: boolean }) => Promise<void>;
  onRefresh?: (provider: string) => Promise<void>;
}

export function ProviderStatusInventory({
  inventory,
  status,
  error,
  onSaveToken,
  onRefresh,
}: ProviderStatusInventoryProps) {
  return (
    <section className="glass-card provider-status-inventory" data-testid="provider-status-inventory">
      <div className="glass-card-head">
        <h2>Provider Auth Inventory</h2>
        <span className={`badge ${status === "ready" ? "ok" : status === "error" ? "err" : "info"}`}>{status}</span>
      </div>
      <p className="provider-inventory-lead">
        Visible setup for OpenAI / ChatGPT / Codex, Google / Gemini / Vertex / ADC, and Anthropic API keys.
      </p>
      {error && <p className="control-center-message">{error}</p>}
      <div className="provider-auth-grid">
        {inventory.orderedProviders.map((provider) => (
          <ProviderAuthCard
            key={provider.provider}
            provider={provider}
            onSaveToken={onSaveToken}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </section>
  );
}
