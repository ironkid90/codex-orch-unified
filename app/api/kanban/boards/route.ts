import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const STATE_DIR = path.join(process.cwd(), "runs", "_runtime", "kanban");
const BOARD_FILE = path.join(STATE_DIR, "board.json");

interface KanbanTask {
  id: string;
  title: string;
  description: string;
  column: string;
  priority: string;
  assignee?: string;
  dueDate?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface KanbanBoard {
  id: string;
  name: string;
  tasks: KanbanTask[];
  createdAt: string;
  updatedAt: string;
}

async function ensureDir() {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
}

async function loadBoard(): Promise<KanbanBoard> {
  await ensureDir();
  if (!existsSync(BOARD_FILE)) {
    const defaultBoard: KanbanBoard = {
      id: "main",
      name: "ShanLab Operations",
      tasks: [
        { id: "k1", title: "Deploy Hermes Node", description: "Set up Hermes proxy on local network", column: "in_progress", priority: "high", assignee: "engineer", tags: ["infra"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "k2", title: "Configure Model Routing", description: "Set up multi-provider routing with fallbacks", column: "todo", priority: "medium", assignee: "architect", tags: ["config"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "k3", title: "Pentest Agent Integration", description: "Connect Havoc C2 bridge to orchestrator", column: "backlog", priority: "high", assignee: "mcp-agent", tags: ["security"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "k4", title: "Vector Index Setup", description: "Initialize LanceDB with repo context", column: "todo", priority: "medium", tags: ["memory"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "k5", title: "Self-Diagnostics Module", description: "Implement preflight checks and self-improvement", column: "review", priority: "high", assignee: "qa-tester", tags: ["core"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeFile(BOARD_FILE, JSON.stringify(defaultBoard, null, 2));
    return defaultBoard;
  }
  try { return JSON.parse(await readFile(BOARD_FILE, "utf8")); } catch { return { id: "main", name: "Operations", tasks: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; }
}

async function saveBoard(board: KanbanBoard) {
  await ensureDir();
  board.updatedAt = new Date().toISOString();
  await writeFile(BOARD_FILE, JSON.stringify(board, null, 2));
}

export async function GET() {
  const board = await loadBoard();
  return NextResponse.json(board);
}

export async function PUT(req: Request) {
  const data = await req.json();
  const board = await loadBoard();
  if (data.name) board.name = data.name;
  if (data.tasks) board.tasks = data.tasks;
  await saveBoard(board);
  return NextResponse.json(board);
}
