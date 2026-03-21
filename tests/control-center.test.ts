import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectControlCenter } from "../lib/swarm/control-center.ts";

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{
  close: () => Promise<void>;
  port: number;
}> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP port.");
  }

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

test("inspectControlCenter records unreachable required MCP servers as blocking issues", async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-control-center-"));

  try {
    writeJson(path.join(workspaceRoot, "mcp-settings.json"), {
      mcpServers: {
        failing: {
          command: process.execPath,
          args: ["-e", "process.exit(2)"],
        },
      },
    });

    const snapshot = await inspectControlCenter(workspaceRoot);

    assert.equal(snapshot.mcpServerStatus.failing?.reachable, false);
    assert.ok(snapshot.mcpServerStatus.failing?.error);
    assert.ok(snapshot.blockingIssues.some((issue) => issue.includes("failing")));
  } finally {
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
});

test("inspectControlCenter falls back to GET when an MCP HEAD probe is unsupported", async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-control-center-"));
  let sawHead = false;
  let sawGet = false;
  const server = await listen((req, res) => {
    if (req.url !== "/mcp") {
      res.statusCode = 404;
      res.end();
      return;
    }

    if (req.method === "HEAD") {
      sawHead = true;
      res.statusCode = 405;
      res.end();
      return;
    }

    if (req.method === "GET") {
      sawGet = true;
      res.statusCode = 200;
      res.end("ok");
      return;
    }

    res.statusCode = 500;
    res.end();
  });

  try {
    writeJson(path.join(workspaceRoot, "mcp-settings.json"), {
      mcpServers: {
        remote: {
          url: `http://127.0.0.1:${server.port}/mcp`,
          transport: "sse",
        },
      },
    });

    const snapshot = await inspectControlCenter(workspaceRoot);

    assert.equal(snapshot.mcpServerStatus.remote?.reachable, true);
    assert.equal(sawHead, true);
    assert.equal(sawGet, true);
  } finally {
    await server.close();
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
});

test("inspectControlCenter keeps optional unreachable MCP servers as warnings", async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-control-center-"));

  try {
    writeJson(path.join(workspaceRoot, "mcp-settings.json"), {
      mcpServers: {
        optionalServer: {
          command: process.execPath,
          args: ["-e", "process.exit(2)"],
          required: false,
        },
      },
    });

    const snapshot = await inspectControlCenter(workspaceRoot);

    assert.equal(snapshot.mcpServerStatus.optionalServer?.reachable, false);
    assert.equal(snapshot.blockingIssues.some((issue) => issue.includes("optionalServer")), false);
    assert.ok(snapshot.warnings.some((issue) => issue.includes("optionalServer")));
  } finally {
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
});

test("inspectControlCenter treats optional docker registry servers with missing manifests as warnings", async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-control-center-"));
  const registryRoot = path.join(workspaceRoot, "registry");
  mkdirSync(registryRoot, { recursive: true });

  try {
    writeJson(path.join(workspaceRoot, "mcp-settings.json"), {
      dockerRegistry: {
        registryPath: "./registry",
        servers: {
          optionalRegistryServer: {
            enabled: true,
            required: false,
          },
        },
      },
    });

    const snapshot = await inspectControlCenter(workspaceRoot);

    assert.deepEqual(snapshot.dockerRegistry.missingManifests, ["optionalRegistryServer"]);
    assert.equal(snapshot.mcpServerStatus.optionalRegistryServer?.reachable, false);
    assert.match(snapshot.mcpServerStatus.optionalRegistryServer?.error || "", /Missing Docker registry manifest/);
    assert.equal(snapshot.blockingIssues.some((issue) => issue.includes("optionalRegistryServer")), false);
    assert.ok(snapshot.warnings.some((issue) => issue.includes("optionalRegistryServer")));
  } finally {
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
});

test("inspectControlCenter treats required docker registry servers with missing manifests as blocking", async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-control-center-"));
  const registryRoot = path.join(workspaceRoot, "registry");
  mkdirSync(registryRoot, { recursive: true });

  try {
    writeJson(path.join(workspaceRoot, "mcp-settings.json"), {
      dockerRegistry: {
        registryPath: "./registry",
        servers: {
          requiredRegistryServer: {
            enabled: true,
          },
        },
      },
    });

    const snapshot = await inspectControlCenter(workspaceRoot);

    assert.deepEqual(snapshot.dockerRegistry.missingManifests, ["requiredRegistryServer"]);
    assert.equal(snapshot.mcpServerStatus.requiredRegistryServer?.reachable, false);
    assert.ok(snapshot.blockingIssues.some((issue) => issue.includes("requiredRegistryServer")));
  } finally {
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
});

test("inspectControlCenter treats optional docker registry manifest parse failures as warnings", async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-control-center-"));
  const manifestPath = path.join(
    workspaceRoot,
    "registry",
    "servers",
    "optionalMalformedRegistryServer",
    "server.yaml",
  );
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, "config: [broken\n", "utf8");

  try {
    writeJson(path.join(workspaceRoot, "mcp-settings.json"), {
      dockerRegistry: {
        registryPath: "./registry",
        servers: {
          optionalMalformedRegistryServer: {
            enabled: true,
            required: false,
          },
        },
      },
    });

    const snapshot = await inspectControlCenter(workspaceRoot);

    assert.equal(snapshot.mcpServerStatus.optionalMalformedRegistryServer?.reachable, false);
    assert.match(snapshot.mcpServerStatus.optionalMalformedRegistryServer?.error || "", /Unable to parse Docker registry manifest/);
    assert.equal(snapshot.blockingIssues.some((issue) => issue.includes("optionalMalformedRegistryServer")), false);
    assert.ok(snapshot.warnings.some((issue) => issue.includes("optionalMalformedRegistryServer")));
  } finally {
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
});

test("inspectControlCenter does not treat long-lived non-MCP stdio processes as reachable", async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-control-center-"));

  try {
    writeJson(path.join(workspaceRoot, "mcp-settings.json"), {
      mcpServers: {
        fakeStdioServer: {
          command: process.execPath,
          args: ["-e", "setInterval(() => {}, 1000)"],
        },
      },
    });

    const snapshot = await inspectControlCenter(workspaceRoot);

    assert.equal(snapshot.mcpServerStatus.fakeStdioServer?.reachable, false);
    assert.ok(snapshot.mcpServerStatus.fakeStdioServer?.error);
    assert.ok(snapshot.blockingIssues.some((issue) => issue.includes("fakeStdioServer")));
  } finally {
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
});

test("inspectControlCenter keeps required compatibility skips as blocking issues when they apply", async () => {
  const nodeMajor = Number(process.versions.node.split(".")[0] || "0");
  if (Number.isNaN(nodeMajor) || nodeMajor < 25) {
    return;
  }

  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-control-center-"));

  try {
    writeJson(path.join(workspaceRoot, "mcp-settings.json"), {
      mcpServers: {
        sequentialthinking: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
        },
      },
    });

    const snapshot = await inspectControlCenter(workspaceRoot);

    assert.equal(snapshot.mcpServerStatus.sequentialthinking?.reachable, false);
    assert.ok(snapshot.blockingIssues.some((issue) => issue.includes("sequentialthinking")));
  } finally {
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
});

test("inspectControlCenter reports reachable Qdrant health and collections", async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-control-center-"));
  const server = await listen((req, res) => {
    if (req.url === "/collections" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ result: { collections: [{ name: "workspace" }, { name: "docs" }] } }));
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  try {
    writeJson(path.join(workspaceRoot, "config", "qdrant.json"), {
      qdrant: {
        host: "127.0.0.1",
        port: server.port,
        defaultCollection: "workspace",
      },
      collections: {},
    });

    const snapshot = await inspectControlCenter(workspaceRoot);

    assert.equal(snapshot.qdrantHealth.configured, true);
    assert.equal(snapshot.qdrantHealth.reachable, true);
    assert.deepEqual(snapshot.qdrantHealth.collections, ["workspace", "docs"]);
    assert.equal(snapshot.qdrantHealth.error, undefined);
  } finally {
    await server.close();
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
});

test("inspectControlCenter reports unreachable Qdrant as a warning instead of a blocking issue", async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-control-center-"));
  const server = await listen((_req, res) => {
    res.statusCode = 200;
    res.end();
  });
  const unavailablePort = server.port;
  await server.close();

  try {
    writeJson(path.join(workspaceRoot, "config", "qdrant.json"), {
      qdrant: {
        host: "127.0.0.1",
        port: unavailablePort,
        defaultCollection: "workspace",
      },
      collections: {},
    });

    const snapshot = await inspectControlCenter(workspaceRoot);

    assert.equal(snapshot.qdrantHealth.configured, true);
    assert.equal(snapshot.qdrantHealth.reachable, false);
    assert.ok(snapshot.qdrantHealth.error);
    assert.equal(snapshot.blockingIssues.some((issue) => issue.toLowerCase().includes("qdrant")), false);
    assert.ok(snapshot.warnings.some((issue) => issue.toLowerCase().includes("qdrant")));
  } finally {
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
});
