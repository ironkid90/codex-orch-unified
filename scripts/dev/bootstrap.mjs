import { cp } from "node:fs/promises";
import path from "node:path";

import { detectPythonLauncher, fileExists, getVenvPythonPath, run, ROOT } from "./common.mjs";

async function main() {
  const envLocal = path.join(ROOT, ".env.local");
  const envExample = path.join(ROOT, ".env.example");
  if (!(await fileExists(envLocal)) && (await fileExists(envExample))) {
    await cp(envExample, envLocal);
    console.log("Created .env.local from .env.example");
  }

  const venvPython = getVenvPythonPath();
  if (!(await fileExists(venvPython))) {
    const py = await detectPythonLauncher();
    console.log(`Creating virtual environment with ${py}...`);
    await run(py, ["-m", "venv", ".venv"]);
  }

  console.log("Installing Python dependencies...");
  await run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
  await run(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"]);

  console.log("Bootstrap complete.");
  console.log("Next step: npm run build:all");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
