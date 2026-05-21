import assert from "node:assert/strict";
import test from "node:test";

import { verifyOutputSafety, verifyTextArtifactSafety } from "../../../lib/swarm/verifier";

test("verifyOutputSafety reports secret patterns deterministically across repeated scans", () => {
  const first = verifyOutputSafety("token=abc123");
  const second = verifyOutputSafety("token=abc123");

  assert.equal(first.length, 1);
  assert.deepEqual(second, first);
});

test("verifyOutputSafety reports malformed markdown fences", () => {
  const issues = verifyOutputSafety("```ts\nconst value = 1;\n");

  assert.match(issues.join("\n"), /Malformed markdown fences/);
});

test("verifyOutputSafety parses JSON documents and fenced JSON blocks", () => {
  assert.deepEqual(verifyOutputSafety('{"ok": true}'), []);

  const docIssues = verifyOutputSafety('{"ok": }');
  assert.match(docIssues.join("\n"), /malformed JSON document/i);

  const fenceIssues = verifyOutputSafety("```json\n{\"ok\": }\n```");
  assert.match(fenceIssues.join("\n"), /malformed fenced JSON block/i);
});

test("verifyTextArtifactSafety prefixes findings with file path evidence", () => {
  const issues = verifyTextArtifactSafety("config/example.json", "```json\n{\"ok\": }\n```");

  assert.equal(issues.length, 1);
  assert.match(issues[0], /^config\/example\.json:/);
});