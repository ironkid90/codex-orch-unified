import path from "node:path";

import { fileExists, getVenvPythonPath, ROOT } from "./common.mjs";

async function checkFile(label, target) {
  const ok = await fileExists(target);
  const mark = ok ? "OK" : "MISSING";
  console.log(`${mark}  ${label}: ${path.relative(ROOT, target)}`);
  return ok;
}

async function main() {
  const checks = [
    ["Node package manifest", path.join(ROOT, "package.json")],
    ["Swarm engine", path.join(ROOT, "lib", "swarm", "engine.ts")],
    ["Batch runner", path.join(ROOT, "scripts", "batch", "run_batches.mjs")],
    ["Foundry workflow", path.join(ROOT, "foundry_agents", "workflow_server.py")],
    ["Model router", path.join(ROOT, "scripts", "swarm-models.ts")],
    ["Model routing config", path.join(ROOT, "config", "model-routing.json")],
    [".env.example", path.join(ROOT, ".env.example")],
    [".env.local", path.join(ROOT, ".env.local")],
    [".venv python", getVenvPythonPath()],
    ["VS Code tasks", path.join(ROOT, ".vscode", "tasks.json")],
  ];

  let allOk = true;
  for (const [label, target] of checks) {
    const ok = await checkFile(label, target);
    if (!ok && label !== ".env.local") {
      allOk = false;
    }
  }

  console.log("");
  if (allOk) {
    console.log("Workspace looks healthy.");
    console.log("Run: npm run build:all");
  } else {
    console.log("Workspace is missing required files.");
    console.log("Run: npm install && npm run bootstrap");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
