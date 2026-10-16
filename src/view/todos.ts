// Claude's to-do list, as its tool calls left it. Claude Code keeps it with TaskCreate, TaskUpdate
// and TaskList; older versions wrote it whole with TodoWrite.
import type { Item } from "./state";
import { field } from "./tools";

export type Todo = { id: string; content: string; status: "pending" | "in_progress" | "completed" };

const STATUSES = new Set(["pending", "in_progress", "completed"]);

/** The list after every finished call that changed it, or null if Claude hasn't made one. */
export function todoList(items: Item[]): Todo[] | null {
  let list: Todo[] | null = null;
  for (const item of items) {
    if (item.kind !== "tool" || item.call.status !== "done") continue;
    const { name, input, output } = item.call;
    if (name === "TodoWrite" && Array.isArray(input.todos)) {
      list = input.todos.map((todo, i) => ({ id: String(i + 1), content: String(field(todo, "content") ?? ""), status: statusOf(field(todo, "status")) }));
    } else if (name === "TaskList" && Array.isArray(field(output, "tasks"))) {
      list = (field(output, "tasks") as unknown[]).map((task) => ({
        id: String(field(task, "id")),
        content: String(field(task, "subject") ?? ""),
        status: statusOf(field(task, "status")),
      }));
    } else if (name === "TaskCreate") {
      const current: Todo[] = list ?? [];
      // A replayed call has no structured output. Claude Code numbers tasks from 1, in order.
      const id = field(field(output, "task"), "id");
      list = [...current, { id: typeof id === "string" ? id : String(current.length + 1), content: String(input.subject ?? ""), status: "pending" }];
    } else if (name === "TaskUpdate" && list) {
      const id = String(input.taskId);
      if (input.status === "deleted") list = list.filter((todo) => todo.id !== id);
      else {
        list = list.map((todo) =>
          todo.id === id
            ? {
                ...todo,
                content: typeof input.subject === "string" ? input.subject : todo.content,
                status: STATUSES.has(String(input.status)) ? statusOf(input.status) : todo.status,
              }
            : todo,
        );
      }
    }
  }
  return list;
}

function statusOf(value: unknown): Todo["status"] {
  return value === "in_progress" || value === "completed" ? value : "pending";
}
