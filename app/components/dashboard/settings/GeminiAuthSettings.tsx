import type { ProviderInventoryCardViewModel } from "@/app/hooks/useProviderAuthInventory";

interface GeminiAuthSettingsProps {
  provider: ProviderInventoryCardViewModel;
}

export function GeminiAuthSettings({ provider }: GeminiAuthSettingsProps) {
  return (
    <div className="provider-auth-settings">
      <p className="provider-auth-summary">{provider.setupSummary}</p>
      <div className="provider-mode-list" aria-label="Gemini supported auth modes">
        {provider.availableModes.map((mode) => (
          <span key={mode} className={`provider-mode-pill ${mode === provider.activeMode ? "active" : ""}`}>
            {mode === "adc" ? "Application Default Credentials" : mode.replace(/_/g, " ")}
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
