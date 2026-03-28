import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildProviderAuthInventoryUrl,
  buildProviderInventoryViewModel,
  createProviderTokenSavePayload,
} from "../../../app/hooks/useProviderAuthInventory";
import { OpenAIAuthSettings } from "../../../app/components/dashboard/settings/OpenAIAuthSettings";
import { ProviderStatusInventory } from "../../../app/components/dashboard/settings/ProviderStatusInventory";

test("buildProviderInventoryViewModel surfaces OpenAI ChatGPT/Codex and gateway-aware onboarding guidance", () => {
  const inventory = buildProviderInventoryViewModel({
    providers: {
      openai: {
        provider: "openai",
        status: "active",
        source: "~/.codex/auth.json",
        updatedAt: "2026-03-28T05:00:00.000Z",
        metadata: {
          mode: "codex_oauth",
          baseUrl: "https://ai-gateway.vercel.sh/v1",
          supportsGateway: true,
          availableModes: ["api_key", "bearer_token", "chatgpt_oauth", "codex_oauth", "auto"],
        },
      },
      gemini: {
        provider: "gemini",
        status: "active",
        source: "Application Default Credentials",
        updatedAt: "2026-03-28T05:00:00.000Z",
        metadata: {
          availableModes: ["api_key", "oauth_token", "adc", "vertex"],
          useAdc: true,
          useVertexAi: true,
          vertexProject: "demo-project",
          vertexLocation: "global",
        },
      },
      anthropic: {
        provider: "anthropic",
        status: "unconfigured",
        source: "unconfigured",
        updatedAt: "2026-03-28T05:00:00.000Z",
        metadata: {
          availableModes: ["api_key"],
        },
      },
    },
  });

  assert.equal(inventory.providers.openai.title, "OpenAI");
  assert.equal(inventory.providers.openai.activeMode, "codex_oauth");
  assert.deepEqual(inventory.providers.openai.availableModes, [
    "auto",
    "api_key",
    "bearer_token",
    "chatgpt_oauth",
    "codex_oauth",
  ]);
  assert.match(inventory.providers.openai.setupSummary, /chatgpt/i);
  assert.match(inventory.providers.openai.setupSummary, /codex/i);
  assert.match(inventory.providers.openai.setupSummary, /gateway/i);
  assert.ok(inventory.providers.openai.guidance.some((item) => /codex login/i.test(item)));
  assert.ok(inventory.providers.openai.guidance.some((item) => /chatgpt/i.test(item)));

  assert.equal(inventory.providers.gemini.title, "Google / Gemini");
  assert.equal(inventory.providers.gemini.activeMode, "adc");
  assert.deepEqual(inventory.providers.gemini.availableModes, ["api_key", "oauth_token", "adc", "vertex"]);
  assert.match(inventory.providers.gemini.setupSummary, /vertex/i);
  assert.ok(
    inventory.providers.gemini.guidance.some((item) => /gcloud auth application-default login/i.test(item)),
  );
  assert.ok(inventory.providers.gemini.guidance.some((item) => /oauth/i.test(item)));

  assert.equal(inventory.providers.anthropic.title, "Anthropic");
  assert.equal(inventory.providers.anthropic.activeMode, "api_key");
  assert.deepEqual(inventory.providers.anthropic.availableModes, ["api_key"]);
  assert.match(inventory.providers.anthropic.setupSummary, /api key only/i);
  assert.equal(inventory.providers.anthropic.guidance.some((item) => /oauth/i.test(item)), false);
});

test("createProviderTokenSavePayload supports session-only and env persistence without forcing manual env edits", () => {
  assert.deepEqual(
    createProviderTokenSavePayload({ token: "sk-demo", persistToEnv: false }),
    {
      token: "sk-demo",
      writeToEnv: false,
    },
  );

  assert.deepEqual(
    createProviderTokenSavePayload({ token: "sk-demo", persistToEnv: true }),
    {
      token: "sk-demo",
      writeToEnv: true,
    },
  );
});

test("buildProviderAuthInventoryUrl scopes provider-auth requests to the selected workspace when present", () => {
  const workspace = "C:/Users/Gabi/Documents/GitHub/codex-orch-unified/.swarm-workspaces/issue-123";

  assert.equal(
    buildProviderAuthInventoryUrl("openai", workspace),
    "/api/auth/openai?workspace=C%3A%2FUsers%2FGabi%2FDocuments%2FGitHub%2Fcodex-orch-unified%2F.swarm-workspaces%2Fissue-123",
  );
  assert.equal(
    buildProviderAuthInventoryUrl("openai", workspace, true),
    "/api/auth/openai?workspace=C%3A%2FUsers%2FGabi%2FDocuments%2FGitHub%2Fcodex-orch-unified%2F.swarm-workspaces%2Fissue-123&all=true",
  );
});

test("ProviderStatusInventory renders provider setup visibility and external-login guidance", () => {
  const inventory = buildProviderInventoryViewModel({
    providers: {
      openai: {
        provider: "openai",
        status: "active",
        source: "~/.codex/auth.json",
        updatedAt: "2026-03-28T05:00:00.000Z",
        metadata: {
          mode: "chatgpt_oauth",
          availableModes: ["api_key", "bearer_token", "chatgpt_oauth", "codex_oauth"],
          supportsGateway: true,
        },
      },
      gemini: {
        provider: "gemini",
        status: "active",
        source: "Application Default Credentials",
        updatedAt: "2026-03-28T05:00:00.000Z",
        metadata: {
          useAdc: true,
          availableModes: ["api_key", "oauth_token", "adc", "vertex"],
        },
      },
      anthropic: {
        provider: "anthropic",
        status: "unconfigured",
        source: "unconfigured",
        updatedAt: "2026-03-28T05:00:00.000Z",
        metadata: {
          availableModes: ["api_key"],
        },
      },
    },
  });

  const html = renderToStaticMarkup(
    React.createElement(ProviderStatusInventory, {
      inventory,
      status: "ready",
      error: null,
    }),
  );

  assert.match(html, /OpenAI/);
  assert.match(html, /ChatGPT OAuth/i);
  assert.match(html, /Codex OAuth/i);
  assert.match(html, /codex login/i);
  assert.match(html, /Google \/ Gemini/);
  assert.match(html, /Application Default Credentials/i);
  assert.match(html, /gcloud auth application-default login/i);
  assert.match(html, /Anthropic/);
  assert.match(html, /API key only/i);
  assert.match(html, /Save to env/i);
  assert.match(html, /Session only/i);
});

test("OpenAIAuthSettings renders ChatGPT OAuth and Codex OAuth as distinct supported modes", () => {
  const inventory = buildProviderInventoryViewModel({
    providers: {
      openai: {
        provider: "openai",
        status: "active",
        source: "~/.codex/auth.json",
        updatedAt: "2026-03-28T05:00:00.000Z",
        metadata: {
          mode: "chatgpt_oauth",
          availableModes: ["api_key", "bearer_token", "chatgpt_oauth", "codex_oauth"],
        },
      },
    },
  });

  const html = renderToStaticMarkup(
    React.createElement(OpenAIAuthSettings, {
      provider: inventory.providers.openai,
    }),
  );

  assert.match(html, /ChatGPT OAuth/);
  assert.match(html, /Codex OAuth/);
  assert.doesNotMatch(html, /ChatGPT\/Codex/);
});
