import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: ["**/*.d.ts", "**/__mocks__/**"],
      thresholds: { statements: 70, branches: 60, functions: 70, lines: 70 },
    },
    alias: { "@": path.resolve(process.cwd(), ".") },
  },
});
