// Ported from Roo Code src/core/tools/EditFileTool.ts

export type LineEnding = "\r\n" | "\n";

/**
 * Count occurrences of a substring in a string.
 * @param str The string to search in
 * @param substr The substring to count
 * @returns Number of non-overlapping occurrences
 */
export function countOccurrences(str: string, substr: string): number {
    if (substr === "") return 0;
    let count = 0;
    let pos = str.indexOf(substr);
    while (pos !== -1) {
        count++;
        pos = str.indexOf(substr, pos + substr.length);
    }
    return count;
}

/**
 * Safely replace all occurrences of a literal string, handling $ escape sequences.
 * Standard String.replaceAll treats $ specially in the replacement string.
 * This function ensures literal replacement.
 *
 * @param str The original string
 * @param oldString The string to replace
 * @param newString The replacement string
 * @returns The string with all occurrences replaced
 */
export function safeLiteralReplace(str: string, oldString: string, newString: string): string {
    if (oldString === "" || !str.includes(oldString)) {
        return str;
    }

    // If newString doesn't contain $, we can use replaceAll directly
    if (!newString.includes("$")) {
        return str.replaceAll(oldString, newString);
    }

    // Escape $ to prevent ECMAScript GetSubstitution issues
    // $$ becomes a single $ in the output, so we double-escape
    const escapedNewString = newString.replaceAll("$", "$$$$");
    return str.replaceAll(oldString, escapedNewString);
}

export function detectLineEnding(content: string): LineEnding {
    return content.includes("\r\n") ? "\r\n" : "\n";
}

export function normalizeToLF(content: string): string {
    return content.replace(/\r\n/g, "\n");
}

export function restoreLineEnding(contentLF: string, eol: LineEnding): string {
    if (eol === "\n") return contentLF;
    return contentLF.replace(/\n/g, "\r\n");
}

export function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildWhitespaceTolerantRegex(oldLF: string): RegExp {
    if (oldLF === "") {
        // Never match empty string
        return new RegExp("(?!)", "g");
    }

    const parts = oldLF.match(/(\s+|\S+)/g) ?? [];
    const whitespacePatternForRun = (run: string): string => {
        // If the whitespace run includes a newline, allow matching any whitespace (including newlines)
        // to tolerate wrapping changes across lines.
        if (run.includes("\n")) {
            return "\\s+";
        }

        // Otherwise, limit matching to horizontal whitespace so we don't accidentally consume
        // line breaks that precede indentation.
        return "[\\t ]+";
    };

    const pattern = parts
        .map((part) => {
            if (/^\s+$/.test(part)) {
                return whitespacePatternForRun(part);
            }
            return escapeRegExp(part);
        })
        .join("");

    return new RegExp(pattern, "g");
}

export function buildTokenRegex(oldLF: string): RegExp {
    const tokens = oldLF.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
        return new RegExp("(?!)", "g");
    }

    const pattern = tokens.map(escapeRegExp).join("\\s+");
    return new RegExp(pattern, "g");
}

export function countRegexMatches(content: string, regex: RegExp): number {
    const stable = new RegExp(regex.source, regex.flags);
    return Array.from(content.matchAll(stable)).length;
}

export function applyReplaceEdit(
    currentContent: string,
    oldString: string,
    newString: string,
    expectedReplacements: number = 1
): string {
    if (oldString === "") {
        // Treat as full replacement if no old_string context is provided? 
        // Wait, in Roo-Code empty old_string means creates new file. 
        // Here we'll just throw an error as this should be handled upstream.
        throw new Error("old_string cannot be empty for applyReplaceEdit");
    }

    const originalEol = detectLineEnding(currentContent);
    let currentContentLF = normalizeToLF(currentContent);
    const oldLF = normalizeToLF(oldString);
    const newLF = normalizeToLF(newString);

    if (oldLF === newLF) {
        return currentContent; // No changes
    }

    const wsRegex = buildWhitespaceTolerantRegex(oldLF);
    const tokenRegex = buildTokenRegex(oldLF);

    const exactOccurrences = countOccurrences(currentContentLF, oldLF);

    if (exactOccurrences === expectedReplacements) {
        currentContentLF = safeLiteralReplace(currentContentLF, oldLF, newLF);
    } else {
        const wsOccurrences = countRegexMatches(currentContentLF, wsRegex);
        if (wsOccurrences === expectedReplacements) {
            currentContentLF = currentContentLF.replace(wsRegex, () => newLF);
        } else {
            const tokenOccurrences = countRegexMatches(currentContentLF, tokenRegex);
            if (tokenOccurrences === expectedReplacements) {
                currentContentLF = currentContentLF.replace(tokenRegex, () => newLF);
            } else {
                const anyMatches = exactOccurrences > 0 || wsOccurrences > 0 || tokenOccurrences > 0;
                if (!anyMatches) {
                    throw new Error(`The provided old_string could not be found.`);
                }
                if (exactOccurrences > 0) {
                    throw new Error(`Expected ${expectedReplacements} occurrence(s) but found ${exactOccurrences} exact match(es).`);
                }
                throw new Error(`Expected ${expectedReplacements} occurrence(s), but matching found ${wsOccurrences} (whitespace-tolerant) and ${tokenOccurrences} (token-based).`);
            }
        }
    }

    return restoreLineEnding(currentContentLF, originalEol);
}
