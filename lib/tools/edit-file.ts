import fs from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "./types";
import { applyReplaceEdit } from "../swarm/file-editing";

export const EditFileTool: Tool = {
    name: "edit_file",
    description: "Edit an existing file by replacing a specific string (old_string) with a new string (new_string). It handles whitespace and token tolerance. Can also be used to create a new file with content.",
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "The path of the file to edit, relative to the workspace.",
            },
            old_string: {
                type: "string",
                description: "The exact string to find and replace. Leave undefined if creating a new file.",
            },
            new_string: {
                type: "string",
                description: "The string to replace old_string with. Also used as the content when creating a new file.",
            },
        },
        required: ["path", "new_string"],
    },
    async execute(args, ctx: ToolContext): Promise<ToolResult> {
        const relativePath = args.path as string;
        const oldString = args.old_string as string | undefined;
        const newString = args.new_string as string;

        const fullPath = path.resolve(ctx.workspaceRoot, relativePath);
        if (!fullPath.startsWith(path.resolve(ctx.workspaceRoot))) {
            return {
                success: false,
                output: "Access denied. Path is outside the workspace.",
            };
        }

        try {
            let fileExists = false;
            try {
                await fs.access(fullPath);
                fileExists = true;
            } catch { }

            if (!fileExists) {
                if (oldString) {
                    return {
                        success: false,
                        output: "File does not exist, but old_string was provided. old_string should be omitted when creating a new file.",
                    };
                }
                await fs.mkdir(path.dirname(fullPath), { recursive: true });
                await fs.writeFile(fullPath, newString, "utf8");
                return {
                    success: true,
                    output: `Successfully created file ${relativePath}.`,
                };
            }

            if (typeof oldString !== "string") {
                return {
                    success: false,
                    output: "File already exists. You must provide old_string to replace content in an existing file.",
                };
            }

            const currentContent = await fs.readFile(fullPath, "utf8");
            const updatedContent = applyReplaceEdit(currentContent, oldString, newString, 1);
            await fs.writeFile(fullPath, updatedContent, "utf8");

            return {
                success: true,
                output: `Successfully edited ${relativePath}.`,
            };
        } catch (error) {
            return {
                success: false,
                output: `Failed to edit file: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    },
};
