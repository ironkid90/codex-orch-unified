import assert from "node:assert/strict";
import test from "node:test";
import { assignNextActions } from "../../../lib/swarm/engine";

test("assignNextActions routes actions based on explicit tags", () => {
  const actions = [
    "@engineer: write a typescript helper",
    "[architect] update the UML and design",
    "(dev-team-ai) update backlog priority",
    "qa-tester: check for memory leaks",
    "test-runner: run the pytest suite",
    "@browser: fix frontend CSS alignment",
    "[mcp] run bigquery select query",
    "@w1: implement user registration",
    "[w2] audit code changes",
  ];

  const assignments = assignNextActions(actions);

  assert.deepEqual(assignments.engineer, ["@engineer: write a typescript helper"]);
  assert.deepEqual(assignments.architect, ["[architect] update the UML and design"]);
  assert.deepEqual(assignments["dev-team-ai"], ["(dev-team-ai) update backlog priority"]);
  assert.deepEqual(assignments["qa-tester"], ["qa-tester: check for memory leaks"]);
  assert.deepEqual(assignments["test-runner"], ["test-runner: run the pytest suite"]);
  assert.deepEqual(assignments["browser-agent"], ["@browser: fix frontend CSS alignment"]);
  assert.deepEqual(assignments["mcp-agent"], ["[mcp] run bigquery select query"]);
  assert.deepEqual(assignments.worker1, ["@w1: implement user registration"]);
  assert.deepEqual(assignments.worker2, ["[w2] audit code changes"]);
});

test("assignNextActions routes actions based on smart scoring pattern matching", () => {
  const actions = [
    "design the new system layout and sequence diagram",
    "implement the registration logic in helper.ts with typescript classes",
    "run vitest suite to check code coverage",
    "verify validation boundaries and check for memory leakages",
    "style the Next.js visual page using CSS rules",
    "execute google cloud bigquery query for user statistics",
  ];

  const assignments = assignNextActions(actions);

  assert.equal(assignments.architect.length, 1);
  assert.match(assignments.architect[0], /design/i);

  assert.equal(assignments.engineer.length, 1);
  assert.match(assignments.engineer[0], /typescript/i);

  assert.equal(assignments["test-runner"].length, 1);
  assert.match(assignments["test-runner"][0], /vitest/i);

  assert.equal(assignments["qa-tester"].length, 1);
  assert.match(assignments["qa-tester"][0], /leakages/i);

  assert.equal(assignments["browser-agent"].length, 1);
  assert.match(assignments["browser-agent"][0], /style/i);

  assert.equal(assignments["mcp-agent"].length, 1);
  assert.match(assignments["mcp-agent"][0], /bigquery/i);
});

test("assignNextActions defaults to worker1 as fallback when no routing matches", () => {
  const actions = [
    "do some random work that doesn't match any keyword",
  ];

  const assignments = assignNextActions(actions);
  assert.deepEqual(assignments.worker1, ["do some random work that doesn't match any keyword"]);
});
