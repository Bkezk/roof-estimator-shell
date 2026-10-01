/**
 * Follow-ups (docs/service-module-design.md §11): every open follow-up timer the signed-in user
 * may see — their own, or everyone's for admins and Customers users (the server decides) —
 * overdue first, then due today, then upcoming. Each row snoozes the next reminder (1 / 3 / 7
 * days) or closes the timer by hand; the item itself keeps its status.
 *
 * The snooze menu and the close dialog are exported for the opportunity page's follow-up strip;
 * the non-component helpers live in followups-shared.ts.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlarmClockOff, BellRing, CheckCircle2, Loader2, Users } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { seesEveryone } from "@/lib/access";
import { listFollowups, type FollowupWithName } from "@/lib/followups.functions";
import { isPastLimit, listUntouched } from "@/lib/contact-log.functions";
import { followupsKey, useFollowupActions, whenDay, whenTime } from "@/components/followups-shared";
import { NeedsActionStrip } from "@/components/crm/contact-log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Bucket = "overdue" | "today" | "upcoming" | "closed";
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "closed", label: "Closed" },
];

/** Overdue = due before today (local), Due today = due today, else Upcoming. */
function bucketOf(f: FollowupWithName, now: Date): Bucket {
  if (f.status !== "open") return "closed";
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = new Date(f.due_at).getTime();
  if (due < start) return "overdue";
  if (due < start + 86400000) return "today";
  return "upcoming";
}

export function SnoozeMenu(props: {
  disabled?: boolean;
  onSnooze: (days: number) => void;
  size?: "sm" | "default";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={props.size ?? "sm"} disabled={props.disabled}>
          <AlarmClockOff className="mr-1 h-4 w-4" /> Snooze
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Next reminder in
        </DropdownMenuLabel>
        {[1, 3, 7].map((d) => (
          <DropdownMenuItem key={d} onSelect={() => props.onSnooze(d)}>
            {d} day{d === 1 ? "" : "s"}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Close a follow-up by hand with an optional reason. `target` null = closed dialog. */
export function CloseFollowupDialog(props: {
  target: { id: string; title: string } | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={!!props.target}
      onOpenChange={(o) => {
        if (!o && !props.pending) {
          setReason("");
          props.onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close this follow-up?</DialogTitle>
          <DialogDescription>
            Reminders for “{props.target?.title}” stop. The item itself keeps its status.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onConfirm(reason.trim());
            setReason("");
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="followup-close-reason">Reason (optional)</Label>
            <Input
              id="followup-close-reason"
              value={reason}
              maxLength={200}
              autoFocus
              placeholder="e.g. Spoke with the customer, no longer needed"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={props.pending}
              onClick={() => {
                setReason("");
                props.onCancel();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={props.pending}>
              {props.pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Close follow-up
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A follow-up's item link: in-app navigation for relative urls, plain text otherwise. */
function ItemLink({ url, children }: { url: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  if (!url.startsWith("/")) return <span className="font-medium">{children}</span>;
  return (
    <a
      href={url}
      className="font-medium underline-offset-2 hover:underline"
      title="Open this item"
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        void navigate({ href: url });
      }}
    >
      {children}
    </a>
  );
}

function Chip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={props.active ? "default" : "outline"}
      className="h-7 rounded-full px-3 text-xs"
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

export function FollowupsPage() {
  const { session, profile } = useAuth();
  const listFn = useServerFn(listFollowups);
  // Admins and managers see everyone's follow-ups ("Mine" off by default); the rest their own.
  const isAdmin = seesEveryone(profile);
  const [showClosed, setShowClosed] = useState(false);
  // "Mine" defaults on for everyone but admins; null = not touched yet (follow the role).
  const [mineOverride, setMineOverride] = useState<boolean | null>(null);
  const mine = mineOverride ?? !isAdmin;
  const [assignee, setAssignee] = useState<string>("all");
  const [closing, setClosing] = useState<FollowupWithName | null>(null);
  const { snooze, close } = useFollowupActions();

  const list = useQuery({
    queryKey: followupsKey(showClosed),
    queryFn: () => listFn({ data: { include_closed: showClosed } }),
    enabled: !!session,
  });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  // Assigned and neither contacted nor started (shared with the strip, query key ["untouched"]).
  const untouchedFn = useServerFn(listUntouched);
  const untouched = useQuery({
    queryKey: ["untouched"],
    queryFn: () => untouchedFn(),
    enabled: !!session,
  });
  const untouchedRows = useMemo(() => untouched.data ?? [], [untouched.data]);

  const assignees = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of rows) m.set(f.assignee_id, f.assignee_name);
    // An admin can pick someone from the By person card who only has untouched items.
    if (isAdmin)
      for (const u of untouchedRows)
        if (u.assignee_id && !m.has(u.assignee_id))
          m.set(u.assignee_id, u.assignee_name ?? "(user)");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows, untouchedRows, isAdmin]);

  // Admin: one line per person — open follow-ups, untouched items, overdue follow-ups.
  const byPerson = useMemo(() => {
    if (!isAdmin) return [];
    const now = Date.now();
    const m = new Map<
      string,
      { id: string; name: string; assigned: number; untouched: number; overdue: number }
    >();
    const row = (id: string, name: string) => {
      let r = m.get(id);
      if (!r) {
        r = { id, name, assigned: 0, untouched: 0, overdue: 0 };
        m.set(id, r);
      }
      return r;
    };
    for (const f of rows) {
      if (f.status !== "open") continue;
      const r = row(f.assignee_id, f.assignee_name);
      r.assigned += 1;
      if (new Date(f.due_at).getTime() < now) r.overdue += 1;
    }
    // Untouched = past the limit (the strip's rule); inside the limit it is not a mark yet.
    const nowDate = new Date(now);
    for (const u of untouchedRows) {
      if (!u.assignee_id || !isPastLimit(u, nowDate)) continue;
      row(u.assignee_id, u.assignee_name ?? "(user)").untouched += 1;
    }
    return [...m.values()].sort(
      (a, b) => b.untouched - a.untouched || b.overdue - a.overdue || a.name.localeCompare(b.name),
    );
  }, [isAdmin, rows, untouchedRows]);
  const showAssigneeSelect = !mine && (isAdmin || assignees.length > 1);

  const filtered = rows.filter((f) => {
    if (mine) return f.assignee_id === profile?.id;
    if (showAssigneeSelect && assignee !== "all") return f.assignee_id === assignee;
    return true;
  });
  const now = new Date();
  const groups = BUCKETS.map(({ key, label }) => {
    const items = filtered.filter((f) => bucketOf(f, now) === key);
    if (key === "closed")
      items.sort((a, b) =>
        (b.closed_at ?? b.updated_at).localeCompare(a.closed_at ?? a.updated_at),
      );
    else items.sort((a, b) => a.due_at.localeCompare(b.due_at));
    return { key, label, items };
  }).filter((g) => g.items.length > 0);
  const openCount = filtered.filter((f) => f.status === "open").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <BellRing className="h-6 w-6" /> Follow-ups
        </h1>
        <p className="text-sm text-muted-foreground">
          Every assigned ticket and opportunity keeps reminding its assignee until it is closed.
          Snooze pushes the next reminder out; Close stops it by hand.
        </p>
      </div>

      <NeedsActionStrip />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
        <Chip active={mine} onClick={() => setMineOverride(!mine)}>
          Mine
        </Chip>
        {showAssigneeSelect && (
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger className="h-8 w-[200px] bg-background" aria-label="Assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {assignees.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                  {id === profile?.id ? " (me)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showClosed} onCheckedChange={setShowClosed} />
          Show closed
        </label>
        {list.data && (
          <span className="ml-auto text-xs text-muted-foreground">
            {openCount} open follow-up{openCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {isAdmin && byPerson.length > 0 && (
        <section className="space-y-2 rounded-lg border p-4" aria-label="By person">
          <h2 className="flex items-center gap-2 font-semibold">
            <Users className="h-4 w-4" /> By person
          </h2>
          <p className="text-xs text-muted-foreground">
            Assigned = open follow-ups; Untouched = assigned with no contact logged and not started;
            Overdue = open follow-ups past their due date. Click a name to see only theirs.
          </p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Assigned</TableHead>
                  <TableHead className="text-right">Untouched</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byPerson.map((p) => (
                  <TableRow key={p.id} data-state={assignee === p.id ? "selected" : undefined}>
                    <TableCell>
                      <button
                        type="button"
                        className="font-medium underline-offset-2 hover:underline"
                        title={`Show only ${p.name}'s follow-ups`}
                        onClick={() => {
                          setMineOverride(false);
                          setAssignee(p.id);
                        }}
                      >
                        {p.name}
                        {p.id === profile?.id ? " (me)" : ""}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.assigned}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${p.untouched ? "font-medium text-destructive" : ""}`}
                    >
                      {p.untouched}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${p.overdue ? "font-medium text-destructive" : ""}`}
                    >
                      {p.overdue}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {list.error ? (
        <p className="text-sm text-destructive">
          Could not load follow-ups ({errText(list.error)}). Try refreshing, or sign in again.
        </p>
      ) : list.isLoading || !list.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading follow-ups…
        </p>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            {mine
              ? "Nothing to follow up on for you. Assigned tickets and opportunities show up here."
              : "No follow-ups match."}
          </p>
          {mine && rows.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setMineOverride(false)}
            >
              Show everyone&apos;s
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-8">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2
                className={`mb-3 flex items-center gap-2 border-b pb-1.5 ${
                  g.key === "overdue" ? "border-destructive/50 text-destructive" : "border-border"
                }`}
              >
                <span className="text-sm font-semibold uppercase tracking-wide">{g.label}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {g.items.length} follow-up{g.items.length === 1 ? "" : "s"}
                </span>
              </h2>
              <div className="grid gap-3">
                {g.items.map((f) => (
                  <FollowupListRow
                    key={f.id}
                    row={f}
                    overdue={g.key === "overdue"}
                    busy={
                      (snooze.isPending && snooze.variables?.id === f.id) ||
                      (close.isPending && close.variables?.id === f.id)
                    }
                    onSnooze={(days) => snooze.mutate({ id: f.id, days })}
                    onClose={() => setClosing(f)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <CloseFollowupDialog
        target={closing}
        pending={close.isPending}
        onCancel={() => setClosing(null)}
        onConfirm={(reason) => {
          if (!closing) return;
          close.mutate(
            { id: closing.id, ...(reason ? { reason } : {}) },
            { onSuccess: () => setClosing(null) },
          );
        }}
      />
    </div>
  );
}

function FollowupListRow(props: {
  row: FollowupWithName;
  overdue: boolean;
  busy: boolean;
  onSnooze: (days: number) => void;
  onClose: () => void;
}) {
  const f = props.row;
  const open = f.status === "open";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 transition-colors duration-150 hover:border-primary/40 hover:bg-muted/40">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-medium">
            {f.kind === "ticket"
              ? "Ticket"
              : f.kind === "opportunity"
                ? "Opportunity"
                : f.kind === "invoice"
                  ? "To invoice"
                  : f.kind}
          </Badge>
          <ItemLink url={f.url}>{f.title}</ItemLink>
          {!open && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Closed
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {f.assignee_name} ·{" "}
          <span className={props.overdue ? "font-medium text-destructive" : undefined}>
            Due {whenDay(f.due_at)}
          </span>
          {open ? ` · Next reminder ${whenTime(f.next_remind_at)}` : ""} · {f.reminders_sent}{" "}
          reminder{f.reminders_sent === 1 ? "" : "s"} sent
        </p>
        {!open && (
          <p className="text-xs text-muted-foreground">
            Closed {whenTime(f.closed_at)}
            {f.closed_reason ? ` · ${f.closed_reason}` : ""}
          </p>
        )}
      </div>
      {open && (
        <div className="flex items-center gap-1">
          {props.busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <SnoozeMenu disabled={props.busy} onSnooze={props.onSnooze} />
          <Button variant="outline" size="sm" disabled={props.busy} onClick={props.onClose}>
            <CheckCircle2 className="mr-1 h-4 w-4" /> Close
          </Button>
        </div>
      )}
    </div>
  );
}
