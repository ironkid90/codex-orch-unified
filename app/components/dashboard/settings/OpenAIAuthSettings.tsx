import type { ProviderInventoryCardViewModel } from "@/app/hooks/useProviderAuthInventory";

interface OpenAIAuthSettingsProps {
  provider: ProviderInventoryCardViewModel;
}

function formatOpenAiModeLabel(mode: ProviderInventoryCardViewModel["availableModes"][number]): string {
  switch (mode) {
    case "chatgpt_oauth":
      return "ChatGPT OAuth";
    case "codex_oauth":
      return "Codex OAuth";
    default:
      return mode.replace(/_/g, " ");
  }
}

export function OpenAIAuthSettings({ provider }: OpenAIAuthSettingsProps) {
  return (
    <div className="provider-auth-settings">
      <p className="provider-auth-summary">{provider.setupSummary}</p>
      <div className="provider-mode-list" aria-label="OpenAI supported auth modes">
        {provider.availableModes.map((mode) => (
          <span key={mode} className={`provider-mode-pill ${mode === provider.activeMode ? "active" : ""}`}>
            {formatOpenAiModeLabel(mode)}
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
