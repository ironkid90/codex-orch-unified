import type { ProviderInventoryViewModel } from "@/app/hooks/useProviderAuthInventory";

import { ProviderAuthCard } from "./ProviderAuthCard";
import { CustomProviderPanel } from "./CustomProviderPanel";

interface ProviderStatusInventoryProps {
  inventory: ProviderInventoryViewModel;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  workspace?: string | null;
  onSaveToken?: (provider: string, options: { token: string; persistToEnv: boolean }) => Promise<void>;
  onRefresh?: (provider: string) => Promise<void>;
  onProviderAdded?: (id: string) => void;
}

export function ProviderStatusInventory({
  inventory,
  status,
  error,
  workspace,
  onSaveToken,
  onRefresh,
  onProviderAdded,
}: ProviderStatusInventoryProps) {
  return (
    <section className="glass-card provider-status-inventory" data-testid="provider-status-inventory">
      <div className="glass-card-head">
        <h2>Provider Auth Inventory</h2>
        <span className={`badge ${status === "ready" ? "ok" : status === "error" ? "err" : "info"}`}>{status}</span>
      </div>
      <p className="provider-inventory-lead">
        Configure API keys, OAuth tokens, and custom endpoints for OpenAI, Anthropic, Gemini, and any OpenAI-compatible provider.
      </p>
      {error && <p className="control-center-message">{error}</p>}

      {/* Built-in provider cards */}
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

      {/* Divider */}
      <div style={{ margin: "24px 0 0", borderTop: "1px solid var(--glass-border)" }} />

      {/* Custom providers panel */}
      <div style={{ marginTop: 20 }}>
        <CustomProviderPanel workspace={workspace} onProviderSaved={onProviderAdded} />
      </div>
    </section>
  );
}
