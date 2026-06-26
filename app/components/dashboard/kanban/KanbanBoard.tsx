"use client";
import { useCallback, useEffect, useState } from "react";

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

const COLUMNS = [
  { id: "backlog", label: "Backlog", color: "var(--text-muted)" },
  { id: "todo", label: "Todo", color: "var(--accent-purple)" },
  { id: "in_progress", label: "In Progress", color: "var(--accent-cyan)" },
  { id: "review", label: "Review", color: "var(--accent-amber)" },
  { id: "done", label: "Done", color: "var(--accent-emerald)" },
];

const PRIORITY_COLORS: Record<string, string> = {
  critical: "var(--accent-rose)",
  high: "var(--accent-amber)",
  medium: "var(--accent-blue)",
  low: "var(--text-muted)",
};

export function KanbanBoard() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [newColumn, setNewColumn] = useState("backlog");

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch("/api/kanban/boards");
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  const moveTask = async (taskId: string, newCol: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.column === newCol) return;
    const updated = { ...task, column: newCol };
    setTasks(prev => prev.map(t => t.id === taskId ? updated : t));
    await fetch("/api/kanban/tasks", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: taskId, column: newCol }) });
  };

  const createTask = async () => {
    if (!newTitle.trim()) return;
    const res = await fetch("/api/kanban/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newTitle, description: newDesc, priority: newPriority, column: newColumn }) });
    const task = await res.json();
    setTasks(prev => [...prev, task]);
    setNewTitle(""); setNewDesc(""); setShowNewTask(false);
  };

  const deleteTask = async (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    await fetch(`/api/kanban/tasks?id=${id}`, { method: "DELETE" });
  };

  if (loading) return <div style={{ padding: 24, color: "var(--text-secondary)" }}>Loading board...</div>;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-primary)" }}>Kanban Board</h2>
        <button onClick={() => setShowNewTask(!showNewTask)} style={{ padding: "6px 14px", background: "var(--accent-cyan)", color: "#000", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>+ New Task</button>
      </div>
      {showNewTask && (
        <div style={{ padding: 16, background: "var(--bg-surface)", borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Task title" style={{ flex: 1, minWidth: 200, padding: "8px 12px", background: "var(--bg)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 13 }} />
          <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description" style={{ flex: 2, minWidth: 200, padding: "8px 12px", background: "var(--bg)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 13 }} />
          <select value={newPriority} onChange={e => setNewPriority(e.target.value)} style={{ padding: "8px 12px", background: "var(--bg)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 13 }}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
          </select>
          <select value={newColumn} onChange={e => setNewColumn(e.target.value)} style={{ padding: "8px 12px", background: "var(--bg)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 13 }}>
            {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <button onClick={createTask} style={{ padding: "8px 16px", background: "var(--accent-emerald)", color: "#000", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Create</button>
        </div>
      )}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${COLUMNS.length}, 1fr)`, gap: 12, overflow: "auto" }}>
        {COLUMNS.map(col => {
          const colTasks = tasks.filter(t => t.column === col.id);
          return (
            <div key={col.id} onDragOver={e => e.preventDefault()} onDrop={() => { if (draggedTask) moveTask(draggedTask, col.id); setDraggedTask(null); }}
              style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, background: "var(--glass)", borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)", minHeight: 200 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: col.color, textTransform: "uppercase", letterSpacing: "0.5px" }}>{col.label}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg)", padding: "2px 8px", borderRadius: 99 }}>{colTasks.length}</span>
              </div>
              {colTasks.map(task => (
                <div key={task.id} draggable onDragStart={() => setDraggedTask(task.id)}
                  style={{ padding: 12, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--glass-border)", cursor: "grab", transition: "all 0.2s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{task.title}</span>
                    <button onClick={() => deleteTask(task.id)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                  </div>
                  {task.description && <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "0 0 8px" }}>{task.description}</p>}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: PRIORITY_COLORS[task.priority] || "var(--text-muted)", color: "#000", fontWeight: 600 }}>{task.priority}</span>
                    {task.assignee && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>@{task.assignee}</span>}
                    {task.tags.map(tag => <span key={tag} style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "var(--glass-strong)", color: "var(--text-secondary)" }}>{tag}</span>)}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
