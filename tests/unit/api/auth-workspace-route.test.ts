import * as assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { NextRequest } from "next/server";

import { providerAuthManager } from "../../../lib/providers/auth-manager";

const REPO_ROOT = process.cwd();

function normalizePathForAssertion(targetPath: string): string {
  return process.platform === "win32" ? targetPath.toLowerCase() : targetPath;
}

async function loadRouteModule(relativePath: string) {
  const moduleUrl = `${pathToFileURL(path.join(REPO_ROOT, relativePath)).href}?t=${Date.now()}-${Math.random()}`;
  return import(moduleUrl);
}

test("auth route forwards the validated dashboard workspace to provider auth operations", async () => {
  const workspaceRoot = path.join(REPO_ROOT, ".swarm-workspaces");
  mkdirSync(workspaceRoot, { recursive: true });
  const selectedWorkspace = mkdtempSync(path.join(workspaceRoot, "auth-route-"));

  const captures: Array<{ method: string; workspaceRoot?: string | null }> = [];
  const originalMethods = {
    getAllProviderStatuses: providerAuthManager.getAllProviderStatuses,
    getProviderStatus: providerAuthManager.getProviderStatus,
    refreshProvider: providerAuthManager.refreshProvider,
    storeOAuthToken: providerAuthManager.storeOAuthToken,
    writeTokenToEnv: providerAuthManager.writeTokenToEnv,
  };

  providerAuthManager.getAllProviderStatuses = (async (options?: { workspaceRoot?: string }) => {
    captures.push({ method: "getAll", workspaceRoot: options?.workspaceRoot });
    return {};
  }) as typeof providerAuthManager.getAllProviderStatuses;
  providerAuthManager.getProviderStatus = (async (_provider, options?: { workspaceRoot?: string }) => {
    captures.push({ method: "getOne", workspaceRoot: options?.workspaceRoot });
    return {
      provider: "openai",
      source: "test",
      updatedAt: new Date().toISOString(),
      status: "active",
    };
  }) as typeof providerAuthManager.getProviderStatus;
  providerAuthManager.refreshProvider = (async (_provider, options?: { workspaceRoot?: string }) => {
    captures.push({ method: "refresh", workspaceRoot: options?.workspaceRoot });
    return {
      provider: "openai",
      source: "test",
      updatedAt: new Date().toISOString(),
      status: "active",
    };
  }) as typeof providerAuthManager.refreshProvider;
  providerAuthManager.storeOAuthToken = (async (_provider, _token, _refreshToken, _expiresIn, options?: { workspaceRoot?: string }) => {
    captures.push({ method: "store", workspaceRoot: options?.workspaceRoot });
    return {
      provider: "openai",
      source: "oauth_callback",
      updatedAt: new Date().toISOString(),
      status: "active",
      token: "sk-demo...",
    };
  }) as typeof providerAuthManager.storeOAuthToken;
  providerAuthManager.writeTokenToEnv = (async (_provider, _token, options?: { workspaceRoot?: string }) => {
    captures.push({ method: "writeEnv", workspaceRoot: options?.workspaceRoot });
  }) as typeof providerAuthManager.writeTokenToEnv;

  try {
    const route = await loadRouteModule("app/api/auth/[provider]/route.ts");

    await route.GET(
      new NextRequest(`http://localhost/api/auth/openai?all=true&workspace=${encodeURIComponent(selectedWorkspace)}`),
      { params: Promise.resolve({ provider: "openai" }) },
    );
    await route.GET(
      new NextRequest(`http://localhost/api/auth/openai?workspace=${encodeURIComponent(selectedWorkspace)}`),
      { params: Promise.resolve({ provider: "openai" }) },
    );
    await route.POST(
      new NextRequest(`http://localhost/api/auth/openai?workspace=${encodeURIComponent(selectedWorkspace)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      }),
      { params: Promise.resolve({ provider: "openai" }) },
    );
    await route.POST(
      new NextRequest(`http://localhost/api/auth/openai?workspace=${encodeURIComponent(selectedWorkspace)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "sk-demo", writeToEnv: true }),
      }),
      { params: Promise.resolve({ provider: "openai" }) },
    );

    assert.deepEqual(
      captures.map((capture) => capture.method),
      ["getAll", "getOne", "refresh", "store", "writeEnv"],
    );
    for (const capture of captures) {
      assert.equal(
        normalizePathForAssertion(capture.workspaceRoot || ""),
        normalizePathForAssertion(selectedWorkspace),
      );
    }
  } finally {
    providerAuthManager.getAllProviderStatuses = originalMethods.getAllProviderStatuses;
    providerAuthManager.getProviderStatus = originalMethods.getProviderStatus;
    providerAuthManager.refreshProvider = originalMethods.refreshProvider;
    providerAuthManager.storeOAuthToken = originalMethods.storeOAuthToken;
    providerAuthManager.writeTokenToEnv = originalMethods.writeTokenToEnv;
    rmSync(selectedWorkspace, { force: true, recursive: true });
  }
});

test("auth route rejects remote mutation requests without the operator token", async () => {
  const originalStore = providerAuthManager.storeOAuthToken;

  providerAuthManager.storeOAuthToken = (async () => {
    throw new Error("storeOAuthToken should not be called for unauthorized requests");
  }) as typeof providerAuthManager.storeOAuthToken;

  try {
    const route = await loadRouteModule("app/api/auth/[provider]/route.ts");
    const response = await route.POST(
      new NextRequest("https://example.com/api/auth/openai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "sk-demo" }),
      }),
      { params: Promise.resolve({ provider: "openai" }) },
    );
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.match(payload.error, /DASHBOARD_OPERATOR_TOKEN/i);
  } finally {
    providerAuthManager.storeOAuthToken = originalStore;
  }
});

test("auth route accepts remote mutation requests with a valid operator token", async () => {
  const captures: Array<{ workspaceRoot?: string | null }> = [];
  const originalStore = providerAuthManager.storeOAuthToken;
  const originalEnv = process.env.DASHBOARD_OPERATOR_TOKEN;

  process.env.DASHBOARD_OPERATOR_TOKEN = "test-operator-token";
  providerAuthManager.storeOAuthToken = (async (_provider, _token, _refreshToken, _expiresIn, options?: { workspaceRoot?: string }) => {
    captures.push({ workspaceRoot: options?.workspaceRoot });
    return {
      provider: "openai",
      source: "oauth_callback",
      updatedAt: new Date().toISOString(),
      status: "active",
      token: "sk-demo...",
    };
  }) as typeof providerAuthManager.storeOAuthToken;

  try {
    const route = await loadRouteModule("app/api/auth/[provider]/route.ts");
    const response = await route.POST(
      new NextRequest("https://example.com/api/auth/openai", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-operator-token",
        },
        body: JSON.stringify({ token: "sk-demo" }),
      }),
      { params: Promise.resolve({ provider: "openai" }) },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(captures.length, 1);
  } finally {
    providerAuthManager.storeOAuthToken = originalStore;
    if (originalEnv === undefined) {
      delete process.env.DASHBOARD_OPERATOR_TOKEN;
    } else {
      process.env.DASHBOARD_OPERATOR_TOKEN = originalEnv;
    }
  }
});
