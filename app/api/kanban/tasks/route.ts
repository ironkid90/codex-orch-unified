import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const STATE_DIR = path.join(process.cwd(), "runs", "_runtime", "kanban");
const BOARD_FILE = path.join(STATE_DIR, "board.json");

async function ensureDir() {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
}

async function loadBoard(): Promise<{ id: string; name: string; tasks: Record<string, unknown>[]; createdAt: string; updatedAt: string }> {
  await ensureDir();
  if (!existsSync(BOARD_FILE)) return { id: "main", name: "Operations", tasks: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  try { return JSON.parse(await readFile(BOARD_FILE, "utf8")); } catch { return { id: "main", name: "Operations", tasks: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; }
}

async function saveBoard(board: { id: string; name: string; tasks: Record<string, unknown>[]; createdAt: string; updatedAt: string }) {
  await ensureDir();
  board.updatedAt = new Date().toISOString();
  await writeFile(BOARD_FILE, JSON.stringify(board, null, 2));
}

export async function POST(req: Request) {
  const data = await req.json();
  const board = await loadBoard();
  const task = {
    id: `k-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: data.title || "New Task",
    description: data.description || "",
    column: data.column || "backlog",
    priority: data.priority || "medium",
    assignee: data.assignee || undefined,
    dueDate: data.dueDate || undefined,
    tags: data.tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  board.tasks.push(task);
  await saveBoard(board);
  return NextResponse.json(task);
}

export async function PUT(req: Request) {
  const data = await req.json();
  if (!data.id) return NextResponse.json({ error: "task id required" }, { status: 400 });
  const board = await loadBoard();
  const idx = board.tasks.findIndex((t) => t.id === data.id);
  if (idx === -1) return NextResponse.json({ error: "task not found" }, { status: 404 });
  board.tasks[idx] = { ...board.tasks[idx], ...data, updatedAt: new Date().toISOString() };
  await saveBoard(board);
  return NextResponse.json(board.tasks[idx]);
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const board = await loadBoard();
  board.tasks = board.tasks.filter((t) => t.id !== id);
  await saveBoard(board);
  return NextResponse.json({ deleted: id });
}
