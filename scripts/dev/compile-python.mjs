import path from "node:path";

import { detectPythonLauncher, fileExists, getVenvPythonPath, run, ROOT } from "./common.mjs";

async function main() {
  const target = path.join(ROOT, "foundry_agents", "workflow_server.py");
  const venvPython = getVenvPythonPath();

  if (await fileExists(venvPython)) {
    await run(venvPython, ["-m", "py_compile", target]);
    return;
  }

  const launcher = await detectPythonLauncher();
  await run(launcher, ["-m", "py_compile", target]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
