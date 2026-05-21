const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN (RSA|OPENSSH|PRIVATE) KEY-----/g,
  /(?:xoxb|xoxp|xoxs)-[A-Za-z0-9-]{10,48}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /AIza[0-9A-Za-z\-_]{35}/g,
  /\b(password|passwd|token|secret)\b\s*[:=]/gi,
];

const JSON_FENCE_PATTERN = /```(?:json|JSON)\s*([\s\S]*?)```/g;

export function verifyOutputSafety(text: string): string[] {
  const issues: string[] = [];

  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      issues.push(`Potential secret exposure matched pattern: ${pattern.source}`);
    }
  }

  const backtickCount = (text.match(/```/g) ?? []).length;
  if (backtickCount % 2 !== 0) {
    issues.push("Malformed markdown fences detected (odd number of ``` tokens).");
  }

  if (looksLikeJsonDocument(text)) {
    const jsonIssue = verifyJsonBlock(text, "JSON document");
    if (jsonIssue) {
      issues.push(jsonIssue);
    }
  }

  JSON_FENCE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(JSON_FENCE_PATTERN)) {
    const jsonIssue = verifyJsonBlock(match[1] || "", "fenced JSON block");
    if (jsonIssue) {
      issues.push(jsonIssue);
    }
  }

  return issues;
}

export function verifyTextArtifactSafety(pathLabel: string, text: string): string[] {
  return verifyOutputSafety(text).map((issue) => `${pathLabel}: ${issue}`);
}

function looksLikeJsonDocument(text: string): boolean {
  const trimmed = text.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function verifyJsonBlock(text: string, label: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (!hasBalancedJsonDelimiters(trimmed)) {
    return `Potential malformed ${label} detected (delimiter imbalance).`;
  }
  try {
    JSON.parse(trimmed);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Potential malformed ${label} detected (${message}).`;
  }
}

function hasBalancedJsonDelimiters(text: string): boolean {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = inString;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      const open = stack.pop();
      if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) {
        return false;
      }
    }
  }
  return stack.length === 0 && !inString;
}
