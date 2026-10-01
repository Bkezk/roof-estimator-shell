/**
 * New / edit task (owner, Sep 30, item 11): what you're going to do, company, property, date and
 * time (or all day), who it is assigned to, attendees (users) and outside attendee emails,
 * notes. Saving a new task emails everyone on it ("New task: …"); adding attendees later emails
 * the added ones. Mounted by the Prospecting page (TasksPanel, the building's Tasks card) and,
 * later, My Work — keep the props simple.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Trash2, X } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  cleanEmails,
  isValidEmail,
  taskInputSchema,
  taskToInput,
  type TaskInput,
  type TaskRow,
} from "@/lib/tasks";
import {
  deleteTask,
  listTaskSites,
  saveTask,
  userLabel,
  type TaskUser,
} from "@/lib/tasks.functions";
import { AccountPicker } from "@/components/crm/account-picker";
import { useInvalidateTasks, useTaskUsers } from "@/components/tasks/task-shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function blankInput(me: string | null): TaskInput {
  return {
    title: "",
    details: null,
    account_id: null,
    account_name: null,
    site_id: null,
    site_name: null,
    building_id: null,
    date: null,
    time: null,
    all_day: true,
    assignee: me,
    attendees: me ? [me] : [],
    external_emails: [],
    status: "open",
  };
}

const siteLabel = (s: { name: string; address1?: string | null; city?: string | null }) =>
  [s.name, s.address1, s.city].filter((x) => x && x.trim()).join(", ");

export function TaskDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this task; without it the dialog makes a new one. */
  task?: TaskRow | undefined;
  /** Prefill for a new task (a building from the map, a day on the calendar). */
  defaults?: Partial<TaskInput> | undefined;
  onSaved?: (() => void) | undefined;
}) {
  const { profile } = useAuth();
  const me = profile?.id ?? null;
  const [f, setF] = useState<TaskInput>(() => blankInput(me));
  const [emailText, setEmailText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<TaskInput>) => setF((cur) => ({ ...cur, ...patch }));

  // Reset each time the dialog opens (or opens on another task).
  const taskId = props.task?.id;
  useEffect(() => {
    if (!props.open) return;
    setF(props.task ? taskToInput(props.task) : { ...blankInput(me), ...(props.defaults ?? {}) });
    setEmailText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open / another task
  }, [props.open, taskId]);

  const usersQ = useTaskUsers();
  const roster: TaskUser[] = usersQ.data ?? [];
  const nameOf = (id: string) => userLabel(roster.find((u) => u.id === id)) || "(unknown user)";

  const sitesFn = useServerFn(listTaskSites);
  const sites = useQuery({
    queryKey: ["task-sites", f.account_id],
    queryFn: () => sitesFn({ data: { account_id: f.account_id! } }),
    enabled: props.open && !!f.account_id,
  });

  const invalidate = useInvalidateTasks();
  const saveFn = useServerFn(saveTask);
  const save = useMutation({
    mutationFn: (input: TaskInput) => saveFn({ data: input }),
    onSuccess: (r) => {
      toast.success(
        r.notified
          ? `Task saved — ${r.notified} notified`
          : props.task
            ? "Task saved"
            : "Task added",
      );
      if (r.notifyErrors.length)
        toast.warning(`Saved, but a notice did not go out: ${r.notifyErrors[0]}`);
      invalidate();
      props.onSaved?.();
      props.onOpenChange(false);
    },
    onError: (e) => toast.error(errText(e)),
  });
  const deleteFn = useServerFn(deleteTask);
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Task deleted");
      invalidate();
      props.onSaved?.();
      props.onOpenChange(false);
    },
    onError: (e) => toast.error(errText(e)),
  });

  const addEmails = (raw: string): boolean => {
    const parts = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const bad = parts.filter((p) => !isValidEmail(p));
    if (bad.length) {
      toast.error(`Not a valid email address: ${bad.join(", ")}`);
      return false;
    }
    set({ external_emails: cleanEmails([...f.external_emails, ...parts]) });
    setEmailText("");
    return true;
  };

  const submit = () => {
    // A typed but not yet added email is added (or refused) first.
    let emails = f.external_emails;
    if (emailText.trim()) {
      const parts = emailText.split(/[\s,;]+/).filter(Boolean);
      const bad = parts.filter((p) => !isValidEmail(p));
      if (bad.length) {
        toast.error(`Not a valid email address: ${bad.join(", ")}`);
        return;
      }
      emails = cleanEmails([...emails, ...parts]);
    }
    const parsed = taskInputSchema.safeParse({ ...f, external_emails: emails });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the task");
      return;
    }
    if (!parsed.data.all_day && parsed.data.date && !parsed.data.time) {
      toast.error("Pick a time, or turn on All day");
      return;
    }
    save.mutate(parsed.data);
  };

  const busy = save.isPending || remove.isPending;
  const others = roster.filter((u) => !f.attendees.includes(u.id));
  const accountValue = f.account_id
    ? { account_id: f.account_id, site_id: null, label: f.account_name ?? "" }
    : null;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (busy) return;
        props.onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{props.task ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            Everyone on the task gets an email when it is saved, the morning it is due, and the
            morning after if it is still open.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            submit();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="task-title">What are you going to do?</Label>
            <Input
              id="task-title"
              value={f.title}
              autoFocus={!props.task}
              maxLength={200}
              placeholder="e.g. Walk the roof with the facilities manager"
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="task-company">Company</Label>
              <AccountPicker
                id="task-company"
                value={accountValue}
                placeholder="Search customers…"
                onChange={(hit) =>
                  hit
                    ? set({
                        account_id: hit.account_id,
                        account_name: hit.account_name,
                        site_id: hit.site_id,
                        site_name: hit.site_id
                          ? [hit.site_name, hit.site_address].filter(Boolean).join(", ")
                          : null,
                      })
                    : set({ account_id: null, account_name: null, site_id: null, site_name: null })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Property</Label>
              <Select
                value={f.site_id ?? "none"}
                disabled={!f.account_id}
                onValueChange={(v) => {
                  if (v === "none") return set({ site_id: null, site_name: null });
                  const s = (sites.data ?? []).find((x) => x.id === v);
                  set({ site_id: v, site_name: s ? siteLabel(s) : f.site_name });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={f.account_id ? "Pick a site" : "Pick a company first"}>
                    {f.site_id ? (f.site_name ?? "Site") : f.account_id ? "No property" : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No property</SelectItem>
                  {(sites.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {siteLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sites.error && (
                <p className="text-xs text-destructive">
                  Could not load the sites: {errText(sites.error)}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor="task-date">Date</Label>
              <Input
                id="task-date"
                type="date"
                value={f.date ?? ""}
                onChange={(e) => set({ date: e.target.value || null })}
              />
            </div>
            <div className="order-last col-span-2 space-y-1 sm:order-none sm:col-span-1">
              <Label htmlFor="task-time">Time</Label>
              <Input
                id="task-time"
                type="time"
                value={f.all_day ? "" : (f.time ?? "")}
                disabled={f.all_day}
                onChange={(e) => set({ time: e.target.value || null })}
              />
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              <Switch
                checked={f.all_day}
                onCheckedChange={(v) => set({ all_day: v, time: v ? null : f.time })}
              />
              All day
            </label>
          </div>

          <div className="space-y-1">
            <Label>Assigned to</Label>
            <Select
              value={f.assignee ?? "none"}
              onValueChange={(v) => {
                const id = v === "none" ? null : v;
                set({
                  assignee: id,
                  attendees: id && !f.attendees.includes(id) ? [...f.attendees, id] : f.attendees,
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={usersQ.isLoading ? "Loading…" : "Nobody"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nobody</SelectItem>
                {roster.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {userLabel(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {usersQ.error && (
              <p className="text-xs text-destructive">
                Could not load the users: {errText(usersQ.error)}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label>Attendees</Label>
            <div className="flex flex-wrap gap-1.5">
              {f.attendees.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1 py-1 font-normal">
                  {nameOf(id)}
                  {id === f.assignee ? (
                    <span className="text-muted-foreground">(assigned)</span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Remove ${nameOf(id)}`}
                      className="rounded-sm text-muted-foreground hover:text-foreground"
                      onClick={() => set({ attendees: f.attendees.filter((x) => x !== id) })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
            <Select
              value=""
              disabled={!others.length}
              onValueChange={(v) => v && set({ attendees: [...f.attendees, v] })}
            >
              <SelectTrigger>
                <SelectValue placeholder={others.length ? "Add a person…" : "Everyone is on it"} />
              </SelectTrigger>
              <SelectContent>
                {others.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {userLabel(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="task-email">Outside attendees (email)</Label>
            {f.external_emails.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {f.external_emails.map((e) => (
                  <Badge key={e} variant="outline" className="gap-1 py-1 font-normal">
                    {e}
                    <button
                      type="button"
                      aria-label={`Remove ${e}`}
                      className="rounded-sm text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        set({ external_emails: f.external_emails.filter((x) => x !== e) })
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                id="task-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={emailText}
                placeholder="name@company.com"
                onChange={(e) => setEmailText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === ",") && emailText.trim()) {
                    e.preventDefault();
                    addEmails(emailText);
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!emailText.trim()}
                onClick={() => addEmails(emailText)}
              >
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              They get the task by email (no link to the app); not the morning-after reminder.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="task-notes">Notes</Label>
            <Textarea
              id="task-notes"
              rows={3}
              value={f.details ?? ""}
              onChange={(e) => set({ details: e.target.value || null })}
            />
          </div>

          {props.task && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={f.status === "done"}
                onCheckedChange={(v) => set({ status: v === true ? "done" : "open" })}
              />
              Done
            </label>
          )}
          {props.task?.notify_error && (
            <p className="text-xs text-destructive">
              Last notice problem: {props.task.notify_error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {props.task ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => props.onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !f.title.trim()}>
                {save.isPending ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              “{props.task?.title}” is removed for everyone on it. Nobody is emailed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (props.task) remove.mutate(props.task.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
