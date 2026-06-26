/**
 * Antigravity Provider — routes LLM calls through the Antigravity-Manager
 * local proxy gateway (OpenAI-compatible endpoint).
 *
 * Antigravity-Manager provides: account pool rotation, quota-aware scheduling,
 * model name mapping, thinking budget control, proxy pool load balancing, and
 * Cloudflare tunnel support — all transparently via a standard /v1 endpoint.
 *
 * Env vars:
 *   ANTIGRAVITY_BASE_URL  – proxy base URL  (default: http://127.0.0.1:8787/v1)
 *   ANTIGRAVITY_API_KEY   – proxy API key   (default: apifun)
 */

import type { ProviderConfig, ProviderType } from "./types";
import { OpenAIProvider } from "./openai-provider";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787/v1";
const DEFAULT_API_KEY = "apifun";

export class AntigravityProvider extends OpenAIProvider {
  // @ts-expect-error — override const literal 'openai' with 'antigravity'
  override readonly type = "antigravity" as const;

  constructor(config: ProviderConfig) {
    super({
      ...config,
      type: "openai-compatible",
      baseUrl:
        config.baseUrl ??
        process.env.ANTIGRAVITY_BASE_URL ??
        DEFAULT_BASE_URL,
      apiKey:
        config.apiKey ??
        process.env.ANTIGRAVITY_API_KEY ??
        DEFAULT_API_KEY,
    });
  }

  /**
   * Probe whether the Antigravity-Manager proxy is reachable.
   */
  override async validateConfig(): Promise<boolean> {
    try {
      const baseUrl =
        this.config.baseUrl ??
        process.env.ANTIGRAVITY_BASE_URL ??
        DEFAULT_BASE_URL;
      const res = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey ?? process.env.ANTIGRAVITY_API_KEY ?? DEFAULT_API_KEY}`,
        },
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
