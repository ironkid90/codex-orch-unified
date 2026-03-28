import type { ProviderInventoryCardViewModel } from "@/app/hooks/useProviderAuthInventory";

interface AnthropicAuthSettingsProps {
  provider: ProviderInventoryCardViewModel;
}

export function AnthropicAuthSettings({ provider }: AnthropicAuthSettingsProps) {
  return (
    <div className="provider-auth-settings">
      <p className="provider-auth-summary">{provider.setupSummary}</p>
      <div className="provider-mode-list" aria-label="Anthropic supported auth modes">
        {provider.availableModes.map((mode) => (
          <span key={mode} className={`provider-mode-pill ${mode === provider.activeMode ? "active" : ""}`}>
            {mode.replace(/_/g, " ")}
          </span>
        ))}
      </div>
      <ul className="provider-guidance-list">
        {provider.guidance.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
