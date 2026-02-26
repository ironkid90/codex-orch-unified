import path from "node:path";

import { detectPythonLauncher, fileExists, getVenvPythonPath, run, ROOT } from "./common.mjs";

async function main() {
  const args = process.argv.slice(2);
  const script = path.join(ROOT, "foundry_agents", "workflow_server.py");
  const venvPython = getVenvPythonPath();

  if (await fileExists(venvPython)) {
    await run(venvPython, [script, ...args]);
    return;
  }

  const launcher = await detectPythonLauncher();
  console.warn("No .venv detected. Running with system Python.");
  if (launcher === "py") {
    await run("py", [script, ...args]);
    return;
  }
  await run(launcher, [script, ...args]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
