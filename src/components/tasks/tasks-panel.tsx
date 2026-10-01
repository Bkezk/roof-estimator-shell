/**
 * The tasks card: New task, and the open tasks as a list (Overdue / Today / This week / Later)
 * or a month calendar. The choice of view is remembered per browser.
 */
import { useState } from "react";
import { CalendarDays, List, Plus } from "lucide-react";

import type { TaskInput } from "@/lib/tasks";
import { TaskCalendar } from "@/components/tasks/task-calendar";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { TaskList } from "@/components/tasks/task-list";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const VIEW_KEY = "bid-o-matic:tasks-view";

export function TasksPanel(props: {
  mine?: boolean | undefined;
  defaults?: Partial<TaskInput> | undefined;
}) {
  const [view, setView] = useState<"list" | "calendar">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "calendar" ? "calendar" : "list";
    } catch {
      return "list";
    }
  });
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-foreground">Tasks</p>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={view}
            onValueChange={(v) => {
              if (v !== "list" && v !== "calendar") return;
              setView(v);
              try {
                localStorage.setItem(VIEW_KEY, v);
              } catch {
                /* private window */
              }
            }}
          >
            <ToggleGroupItem value="list" aria-label="List">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="calendar" aria-label="Calendar">
              <CalendarDays className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> New task
          </Button>
        </div>
      </div>
      {view === "list" ? (
        <TaskList mine={props.mine} defaults={props.defaults} />
      ) : (
        <TaskCalendar mine={props.mine} defaults={props.defaults} />
      )}
      <TaskDialog open={creating} onOpenChange={setCreating} defaults={props.defaults} />
    </div>
  );
}
