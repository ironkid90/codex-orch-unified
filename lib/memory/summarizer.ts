// lib/memory/summarizer.ts
// Subagent coordination for HAM inbox processing

import fs from "fs";
import path from "path";

export interface SubagentSummary {
  id: string;
  status: "NEW" | "REVIEWED" | "MERGED";
  createdAt: string; // ISO 8601 UTC
  submittedBy: string;
  summary: string;
  category: "decision" | "pattern" | "finding" | "other";
  relatedFiles?: string[];
  notes?: string;
  mergedAt?: string;
  mergedBy?: string;
}

export interface InboxEntry {
  entryId: string;
  timestamp: string; // ISO 8601 UTC
  status: "NEW" | "REVIEWED" | "MERGED";
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Manages subagent summary submissions to the inbox
 */
export class SubagentSummarizer {
  private memoryDir: string;
  private inboxFile: string;
  private auditLogFile: string;

  constructor(memoryDir = "./.memory") {
    this.memoryDir = memoryDir;
    this.inboxFile = path.join(memoryDir, "inbox.md");
    this.auditLogFile = path.join(memoryDir, "audit-log.md");

    // Ensure memory directory exists
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
  }

  /**
   * Submit a summary from a subagent
   */
  async submitSummary(summary: SubagentSummary): Promise<void> {
    const inboxContent = await this.readInbox();

    // Append to inbox with NEW status
    const timestamp = new Date().toISOString();
    const entryId = `${summary.submittedBy}-${Date.now()}`;
    const inboxEntry = `| ${entryId} | ${summary.category.toUpperCase()} | ${summary.submittedBy} | ${timestamp} | NEW |
\`\`\`
${summary.summary}
\`\`\``;

    const updatedInbox = inboxContent
      ? `${inboxContent}\n\n${inboxEntry}`
      : `## Subagent Summaries Inbox\n\n${inboxEntry}`;

    fs.writeFileSync(this.inboxFile, updatedInbox, "utf-8");

    // Log audit entry
    await this.logAudit(
      "INBOX_APPEND",
      `New summary from ${summary.submittedBy}: ${summary.category}`,
      entryId
    );
  }

  /**
   * Mark inbox entry as REVIEWED
   */
  async reviewEntry(entryId: string): Promise<void> {
    const content = fs.readFileSync(this.inboxFile, "utf-8");
    const updated = content.replace(
      new RegExp(`\\| ${entryId}.*\\| NEW \\|`),
      `| ${entryId} | ${entryId.split("-")[0].toUpperCase()} | ${entryId.split("-")[0]} | ${new Date().toISOString()} | REVIEWED |`
    );

    fs.writeFileSync(this.inboxFile, updated, "utf-8");
    await this.logAudit("INBOX_REVIEWED", `Entry marked REVIEWED: ${entryId}`, entryId);
  }

  /**
   * Merge REVIEWED entries into decisions.md or patterns.md
   */
  async mergeEntry(
    entryId: string,
    targetFile: "decisions" | "patterns"
  ): Promise<void> {
    const inboxContent = fs.readFileSync(this.inboxFile, "utf-8");

    // Extract the entry
    const entryMatch = inboxContent.match(
      new RegExp(`\\| ${entryId}.*?(?=\\n\\| |$)`, "s")
    );
    if (!entryMatch) {
      throw new Error(`Entry ${entryId} not found in inbox`);
    }

    const targetPath = path.join(
      this.memoryDir,
      `${targetFile}.md`
    );

    // Append to target file
    const targetContent = fs.readFileSync(targetPath, "utf-8");
    const timestamp = new Date().toISOString();
    const appendContent = `\n\n## [${timestamp.split("T")[0]}] Entry from ${entryId.split("-")[0]}\n${entryMatch[0]}`;

    fs.writeFileSync(
      targetPath,
      `${targetContent}${appendContent}`,
      "utf-8"
    );

    // Mark as MERGED in inbox
    const updated = inboxContent.replace(
      new RegExp(`\\| ${entryId}.*\\| REVIEWED \\|`),
      `| ${entryId} | MERGED | ${timestamp} |`
    );
    fs.writeFileSync(this.inboxFile, updated, "utf-8");

    await this.logAudit(
      "INBOX_MERGED",
      `Entry merged into ${targetFile}.md: ${entryId}`,
      entryId
    );
  }

  /**
   * Get all NEW entries in inbox (pending review)
   */
  async getPendingEntries(): Promise<string[]> {
    const content = await this.readInbox();
    const entries = content.match(/\| ([a-zA-Z0-9-]+) \|.*?\| NEW \|/g) || [];
    return entries
      .map((e) => e.match(/\| ([a-zA-Z0-9-]+) \|/)?.[1])
      .filter(Boolean) as string[];
  }

  /**
   * Get count of entries by status
   */
  async getInboxStats(): Promise<{
    NEW: number;
    REVIEWED: number;
    MERGED: number;
  }> {
    const content = await this.readInbox();
    return {
      NEW: (content.match(/\| NEW \|/g) || []).length,
      REVIEWED: (content.match(/\| REVIEWED \|/g) || []).length,
      MERGED: (content.match(/\| MERGED \|/g) || []).length,
    };
  }

  /**
   * Log entry to audit-log.md
   */
  private async logAudit(
    action: string,
    description: string,
    entryId: string
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const auditEntry = `| ${timestamp} | ${action} | ${entryId} | ${description} |`;

    let content = await this.readAuditLog();
    if (!content.includes("| Timestamp")) {
      content = `## Audit Log

| Timestamp | Action | Entry ID | Description |
|-----------|--------|----------|-------------|
${auditEntry}`;
    } else {
      content += `\n${auditEntry}`;
    }

    fs.writeFileSync(this.auditLogFile, content, "utf-8");
  }

  private async readInbox(): Promise<string> {
    if (!fs.existsSync(this.inboxFile)) {
      return "";
    }
    return fs.readFileSync(this.inboxFile, "utf-8");
  }

  private async readAuditLog(): Promise<string> {
    if (!fs.existsSync(this.auditLogFile)) {
      return "";
    }
    return fs.readFileSync(this.auditLogFile, "utf-8");
  }
}

/**
 * REST API handler integration
 */
export const createSummarizerAPI = (summarizer: SubagentSummarizer) => ({
  async submitSummary(body: SubagentSummary) {
    try {
      await summarizer.submitSummary(body);
      return { success: true, id: body.id };
    } catch (error) {
      throw new Error(`Failed to submit summary: ${error}`);
    }
  },

  async getPending() {
    const entries = await summarizer.getPendingEntries();
    const stats = await summarizer.getInboxStats();
    return { pending: entries, stats };
  },

  async reviewAndMerge(entryId: string, targetFile: "decisions" | "patterns") {
    try {
      await summarizer.reviewEntry(entryId);
      await summarizer.mergeEntry(entryId, targetFile);
      return { success: true, merged: entryId, into: targetFile };
    } catch (error) {
      throw new Error(`Failed to merge entry: ${error}`);
    }
  },
});
