#!/usr/bin/env node
// scripts/memory-refresh.ts
// CLI tool to manually trigger HAM inbox processing and merge

import fs from "fs";
import path from "path";
import { SubagentSummarizer } from "../lib/memory/summarizer";

const args = process.argv.slice(2);
const command = args[0] || "status";

const summarizer = new SubagentSummarizer("./.memory");

async function refresh() {
  console.log("🔄 Starting memory refresh...\n");

  try {
    const pending = await summarizer.getPendingEntries();
    const stats = await summarizer.getInboxStats();

    console.log("📊 Inbox Statistics:");
    console.log(`  NEW: ${stats.NEW} entries`);
    console.log(`  REVIEWED: ${stats.REVIEWED} entries`);
    console.log(`  MERGED: ${stats.MERGED} entries`);
    console.log("");

    if (pending.length === 0) {
      console.log("✅ No pending entries to process");
      return;
    }

    console.log(`📝 Processing ${pending.length} pending entries:\n`);

    // In a real scenario, this would:
    // 1. Auto-review entries based on heuristics
    // 2. Categorize and merge into appropriate files
    // For now, just list them
    for (const entryId of pending) {
      console.log(`  ⏳ ${entryId} (awaiting manual review)`);
    }

    console.log("\n📌 Next steps:");
    console.log("  1. Review ./.memory/inbox.md for NEW entries");
    console.log("  2. Update STATUS from NEW to REVIEWED");
    console.log("  3. Run: npm run memory:merge <entryId> <decisions|patterns>");
    console.log("");
  } catch (error) {
    console.error("❌ Refresh failed:", error);
    process.exit(1);
  }
}

async function status() {
  console.log("📍 Memory Status\n");

  try {
    const stats = await summarizer.getInboxStats();
    const timestamp = new Date().toISOString();

    console.log(`Generated: ${timestamp}`);
    console.log("");
    console.log("Inbox:");
    console.log(`  NEW: ${stats.NEW}`);
    console.log(`  REVIEWED: ${stats.REVIEWED}`);
    console.log(`  MERGED: ${stats.MERGED}`);
    console.log("");

    // Calculate token baseline
    const decisionsSize = fs.existsSync("./.memory/decisions.md")
      ? fs.statSync("./.memory/decisions.md").size
      : 0;
    const patternsSize = fs.existsSync("./.memory/patterns.md")
      ? fs.statSync("./.memory/patterns.md").size
      : 0;

    const estimatedTokens = Math.round(
      (decisionsSize + patternsSize) / 4.5
    );

    console.log("Token Usage:");
    console.log(`  Estimated tokens in decisions.md + patterns.md: ~${estimatedTokens}`);
    console.log("  Recommendation: Process inbox to keep under 8,000 token budget");
  } catch (error) {
    console.error("❌ Status check failed:", error);
    process.exit(1);
  }
}

async function merge() {
  const entryId = args[1];
  const targetFile = args[2] as "decisions" | "patterns";

  if (!entryId || !targetFile) {
    console.error(
      "Usage: npm run memory:merge <entryId> <decisions|patterns>"
    );
    process.exit(1);
  }

  if (!["decisions", "patterns"].includes(targetFile)) {
    console.error("Target file must be 'decisions' or 'patterns'");
    process.exit(1);
  }

  try {
    console.log(
      `\n🔀 Merging ${entryId} into ${targetFile}.md...\n`
    );
    await summarizer.reviewEntry(entryId);
    await summarizer.mergeEntry(entryId, targetFile);
    console.log(
      `✅ Successfully merged ${entryId} into ${targetFile}.md`
    );
    console.log("\n📌 Updated:");
    console.log(`  • ./.memory/${targetFile}.md`);
    console.log(`  • ./.memory/audit-log.md`);
  } catch (error) {
    console.error("❌ Merge failed:", error);
    process.exit(1);
  }
}

async function help() {
  console.log(`
HAM Memory Refresh CLI

Usage:
  npm run memory:refresh                    # Alias for 'status'
  npm run memory:status                    # Show inbox and token stats
  npm run memory:merge <id> <file>         # Merge entry into decisions/patterns

Example:
  npm run memory:merge user-001-1234567890 decisions
  npm run memory:merge user-001-1234567890 patterns
`);
}

async function main() {
  switch (command) {
    case "refresh":
      await refresh();
      break;
    case "status":
      await status();
      break;
    case "merge":
      await merge();
      break;
    case "help":
      await help();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      await help();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
