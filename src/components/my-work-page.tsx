/**
 * Work Overview (owner, Sep 30): the signed-in person's own tickets (as lead technician), open tasks
 * and open follow-ups in one list, grouped Overdue / This week / Later / Waiting (Waiting since
 * Oct 9: a follow-up on hold; since Oct 12 no "No date" group — an undated item sits under Later —
 * and no "Done" group — a Done ticket is finished work, not listed), or on a month calendar where
 * a click on a day lists that day.
 * Every signed-in user lands here. Admins and managers also get a "Show" picker (Mine /
 * Everyone / one person); the server returns only the caller's own items to anyone else.
 *
 * Each row links to the ticket, the task's building or the follow-up's item. The Follow-ups page
 * is folded in here (owner, Oct 1): a ticket, opportunity or follow-up row shows its follow-up
 * state (Due / Overdue N days / On hold until … · reason · held by … / Reminders every N days)
 * and, once a hold has ended and nothing was logged since, a "Back from hold" badge with the
 * reason (owner, Oct 9). Snooze (a hold with a date and a reason) is for admins and managers
 * only (seesEveryone; the server and the database refuse anyone else) — no Close on this page
 * since Oct 15 (owner: "it may cause more issues than not"; the Opportunities page keeps its
 * own); everyone else sees the state with one line saying their manager manages follow-ups. The rules
 * (merge, sort, buckets, calendar grid, scoping) are pure in src/lib/my-work.ts, the follow-up
 * state in src/lib/followup-rules.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  CalendarDays,
  Eye,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Info,
  List,
  ListTodo,
  Loader2,
  MapPin,
  Plus,
  RotateCcw,
  Users,
  X,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  canClaim,
  dispatchesTickets,
  isAdmin,
  seesEveryone,
  seesOpportunitiesList,
} from "@/lib/access";
import { backFromHold } from "@/lib/followup-holds";
import { followupStateText } from "@/lib/followup-rules";
import { listMyWork } from "@/lib/my-work.functions";
import { claimServiceJob } from "@/lib/service.functions";
import { claimOpportunity } from "@/lib/opportunities.functions";
import { claimTask } from "@/lib/tasks.functions";
import {
  KIND_LABELS,
  addMonths,
  cellItems,
  dayIsOverdue,
  effectiveWho,
  flagUnassigned,
  initials,
  itemsByDay,
  listGroups,
  localYmd,
  mergeWork,
  monthGrid,
  resolveWho,
  whoParam,
  compareWork,
  defaultBucket,
  presetBucket,
  waitingDays,
  ymdParts,
  splitEmptyGroups,
  BUCKET_EMPTY,
  BUCKET_HELP,
  BUCKET_LABELS,
  type BucketPreset,
  type WorkBucket,
  type WorkFollowup,
  type WorkGroup,
  type WorkItem,
  type WorkKind,
} from "@/lib/my-work";
import {
  NEW_OPPORTUNITY_HREF,
  UNASSIGNED_TASK_HINT,
  monthDay,
  newTicketHref,
  taskMapHref,
} from "@/lib/my-work-actions";
import { effectiveView, type MyWorkView } from "@/lib/owner-view";
import {
  applyKinds,
  applyWorkLayout,
  defaultWorkLayout,
  hideBucket,
  isDefaultWorkLayout,
  isEmptyWorkLayout,
  keepRemembered,
  KIND_PLURALS,
  kindsSummary,
  landingSearch,
  moveBucket,
  readStoredWorkLayout,
  rememberView,
  rememberWho,
  shouldSeedWorkLayout,
  showBucket,
  toggleKind,
  type WorkLayout,
  WORK_KINDS,
  writeStoredWorkLayout,
} from "@/lib/work-layout";
import { LAYOUT_SAVE_FAILED, getMyWorkLayout, setMyWorkLayout } from "@/lib/work-layout.functions";
import { SnoozeMenu } from "@/components/followup-controls";
import { useFollowupActions } from "@/components/followups-shared";
import { OwnerView } from "@/components/owner-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { useWorkActions, type WorkActions } from "@/components/my-work-actions";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A real link's click: the browser keeps its modifier-clicks (a new tab, a window); the page's
 * router takes a plain one.
 */
const followLink =
  (navigate: ReturnType<typeof useNavigate>, href: string) => (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void navigate({ href });
  };

const KIND_CLASS: Record<WorkKind, string> = {
  ticket:
    "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
  inspection:
    "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200",
  task: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  followup:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  opportunity:
    "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
  // Draft bids by due date (owner, Oct 12): sky, the one colour no other kind uses.
  bid: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
};
const KIND_DOT: Record<WorkKind, string> = {
  ticket: "bg-blue-500",
  inspection: "bg-violet-500",
  task: "bg-amber-500",
  followup: "bg-emerald-500",
  opportunity: "bg-rose-500",
  bid: "bg-sky-500",
};
/** A calendar item's left bar: its kind's badge colour. */
const KIND_BAR: Record<WorkKind, string> = {
  ticket: "border-l-blue-500",
  inspection: "border-l-violet-500",
  task: "border-l-amber-500",
  followup: "border-l-emerald-500",
  opportunity: "border-l-rose-500",
  bid: "border-l-sky-500",
};

/** How many columns the desktop List grid needs for the columns shown (one to eight). */
const GRID_COLS: Record<number, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
  6: "xl:grid-cols-6",
  7: "xl:grid-cols-7",
  // Eight since Oct 9 (Waiting); nine since Oct 12 (Authorized — to invoice): every column an
  // admin can show at once.
  8: "xl:grid-cols-8",
  9: "xl:grid-cols-9",
};
const listGridClass = (count: number): string =>
  GRID_COLS[Math.min(9, Math.max(1, count))] ?? "xl:grid-cols-9";

/** "Wed, Sep 30" for a YYYY-MM-DD day (read as a calendar day, no time zone shift). */
const dayLabel = (ymd: string) => {
  const [y, m, d] = ymdParts(ymd);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};
const monthLabel = (month: string) => {
  const [y, m] = ymdParts(month);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

/** Snooze for one row's follow-up: admins and managers only (null for everyone else). */
type ManageFollowup = (f: WorkFollowup) => React.ReactNode;

/**
 * A row's follow-up state: "Overdue 3 days · On hold until Fri, Oct 24 · <reason> · held by <name>
 * · Reminders every 3 days"; after a hold has ended, a "Back from hold" badge with the reason until
 * a contact is logged (owner, Oct 9; lib/followup-holds.ts backFromHold).
 */
function FollowupState({ f, today }: { f: WorkFollowup; today: string }) {
  const parts = followupStateText(f, today);
  const back = backFromHold(f, today);
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
      {back && (
        <span className="flex w-full flex-wrap items-center gap-1.5" data-badge="back-from-hold">
          <Badge
            variant="outline"
            className="border-amber-400 bg-amber-50 px-1.5 py-0 text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          >
            Back from hold
          </Badge>
          <span className="text-muted-foreground">{f.hold_reason}</span>
        </span>
      )}
      {parts.map((p, i) => (
        <span
          key={p.text}
          className={
            p.tone === "overdue" ? "font-medium text-destructive" : "text-muted-foreground"
          }
        >
          {i > 0 && <span className="mr-2 text-muted-foreground">·</span>}
          {p.text}
        </span>
      ))}
    </div>
  );
}

/**
 * One item: type badge, title, customer / property, date, status (and whose, when not mine), the
 * follow-up state, and — for admins and managers — Snooze under the link.
 */
/** How an unassigned item is taken: the row's Claim button (no date) or a drop on a calendar day. */
type ClaimWork = (item: WorkItem, date: string | null) => void;

function WorkRow({
  item,
  showWho,
  today,
  manage,
  claim = null,
  actions = null,
}: {
  item: WorkItem;
  showWho: boolean;
  today: string;
  manage: ManageFollowup | null;
  /** Owner, Oct 8: people ticked Technician who see the unassigned list take it for themselves. */
  claim?: ClaimWork | null;
  /** Owner, Oct 15: a task opens in place, its Done tick, "Assign to…" on an unassigned row. */
  actions?: WorkActions | null;
}) {
  const navigate = useNavigate();
  const f = item.followup && item.followup.status === "open" ? item.followup : null;
  // Owner, Oct 15: every task row opens the task in place (the TaskDialog) — its link led to the
  // Prospecting map, a bare one for a task without a building. The map is the "Open on map" link
  // below, for a task with a building (taskMapHref). Every other kind stays a real link. One
  // task row opens nowhere (lib/my-work-actions.ts taskOpensInPlace): nobody's task for a viewer
  // who can neither Claim nor assign it — getTask would refuse — is plain text with a hint.
  const act = actions && actions.opensInPlace(item) ? actions : null;
  const inert = !!actions && item.kind === "task" && !act;
  const busy = !!actions?.busy(item);
  const mapHref = act || inert ? taskMapHref(item) : null;
  const tick = !!act && act.canEditTask(item);
  const assignNode = item.unassigned && actions ? actions.assign(item) : null;
  const showClaim = !!item.unassigned && !!claim;
  const body = (
    <>
      <div className="flex items-start gap-2">
        <Badge variant="outline" className={`shrink-0 ${KIND_CLASS[item.kind]}`}>
          {KIND_LABELS[item.kind]}
        </Badge>
        <span className="min-w-0 flex-1 break-words font-medium leading-snug">{item.title}</span>
      </div>
      {item.where && (
        <div className="mt-1 break-words text-sm text-muted-foreground">{item.where}</div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>{item.date ? dayLabel(item.date) : "No date"}</span>
        <span>{item.status}</span>
        {/* Whose it is, always (owner, Oct 9: "why doesnt this show who its assigned to on
            the card?"); the Everyone view also names an item whose person is unknown. */}
        {item.unassigned ? (
          <span className="font-medium text-destructive">Unassigned</span>
        ) : (
          (showWho || item.assigneeName) && <span>{item.assigneeName ?? "(unknown)"}</span>
        )}
        {/* Nobody's and past its day, or waiting longer than Setup's "needs assignment" timer
            (owner, Oct 7): say so on the row, since it sits under Unassigned, not Overdue. */}
        {item.flag && <span className="font-medium text-destructive">Overdue</span>}
        {/* An Authorized ticket (owner, Oct 12): how long it has waited for its invoice — the
            Invoices queue's number. Opening the ticket shows "Make the invoice". A Done ticket
            under Needs authorization (Oct 12: managers authorize too): since its close-out. */}
        {(item.toInvoice || item.needsAuth) && (
          <WaitingSince since={item.waitingSince ?? null} today={today} />
        )}
      </div>
      {f && <FollowupState f={f} today={today} />}
    </>
  );
  return (
    <div
      className={`rounded-lg border bg-card transition-colors hover:bg-muted/50 ${
        item.done ? "opacity-70" : ""
      }`}
    >
      {act ? (
        <button
          type="button"
          className="block w-full p-3 text-left"
          title="Open the task"
          disabled={busy}
          onClick={() => act.openTask(item)}
        >
          {body}
        </button>
      ) : inert ? (
        <div className="p-3" data-row="inert-task">
          {body}
          <p className="mt-1 text-xs text-muted-foreground">{UNASSIGNED_TASK_HINT}</p>
        </div>
      ) : (
        <a href={item.href} className="block p-3" onClick={followLink(navigate, item.href)}>
          {body}
        </a>
      )}
      {f && manage && (
        <div className="flex flex-wrap items-center justify-end gap-1 border-t px-3 py-2">
          {manage(f)}
        </div>
      )}
      {(tick || mapHref || assignNode || showClaim) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {/* The Done tick (owner, Oct 15): no confirm; the toast's Undo reopens it. */}
            {act && tick && (
              <label className="flex items-center gap-2" data-tick="task">
                <Checkbox
                  checked={busy}
                  disabled={busy}
                  aria-label={`Mark ${item.title} done`}
                  onCheckedChange={(v) => {
                    if (v === true) act.markDone(item);
                  }}
                />
                Done
              </label>
            )}
            {mapHref && (
              <a
                href={mapHref}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                onClick={followLink(navigate, mapHref)}
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Open on map
              </a>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {assignNode}
            {showClaim && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                title="Take it for yourself; it keeps its date"
                disabled={busy}
                onClick={() => claim(item, null)}
              >
                Claim
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "Waiting 3 days" for an Authorized ticket (to invoice) or a Done one (to authorize) — my-work.ts
 * waitingDays; nothing without a stamp.
 */
function WaitingSince({ since, today }: { since: string | null; today: string }) {
  const days = waitingDays(since, today);
  if (days === null) return null;
  return (
    <span className="font-medium" data-line="waiting">
      Waiting {days} day{days === 1 ? "" : "s"}
    </span>
  );
}

/**
 * The ⓘ beside a column title, a tab or an empty-column chip (owner, Oct 12): a tooltip saying
 * in one or two plain sentences what the column holds (my-work.ts BUCKET_HELP). A button, so a
 * keyboard or a phone (tap / focus) opens it too; the shell's TooltipProvider (ui/sidebar)
 * supplies the delay. It stops the click so a heading's drag or a tab's pick is not started.
 */
function BucketHelp({ bucket, label }: { bucket: WorkBucket; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}`}
          onClick={(e) => e.stopPropagation()}
          className="rounded text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs font-normal">
        {BUCKET_HELP[bucket]}
      </TooltipContent>
    </Tooltip>
  );
}

function ListView({
  items,
  today,
  showWho,
  manage,
  preset,
  onClearPreset,
  authorize = false,
  invoice = false,
  unassigned = false,
  layout,
  onLayout,
  claim = null,
  actions = null,
}: {
  items: WorkItem[];
  claim?: ClaimWork | null;
  /** Owner, Oct 15: open a task in place, Done tick, "Assign to…" (components/my-work-actions). */
  actions?: WorkActions | null;
  today: string;
  /** The caller reviews Done tickets: the Needs authorization tab shows, empty or not (M9). */
  authorize?: boolean;
  /** The caller invoices (seesInvoices): "Authorized — to invoice" shows, empty or not (Oct 12). */
  invoice?: boolean;
  /** Everyone but a technician-only user: the Unassigned group shows, empty or not (Oct 7). */
  unassigned?: boolean;
  showWho: boolean;
  manage: ManageFollowup | null;
  /** ?bucket=today|overdue: the tab to open on (the Owner view's links). */
  preset: BucketPreset | null;
  onClearPreset: () => void;
  /** The user's column order and hidden columns (owner, Oct 7), and how to change them. */
  layout: WorkLayout;
  onLayout: (next: WorkLayout) => void;
}) {
  // Owner (Oct 1): every heading, always, in the same order, across the top — five since Oct 6
  // (no Today: what is due today tops This week). On a desktop (lg and up) they are columns side
  // by side, each with its items under it ("all 6 across the top instead of having to click
  // each one"); on a phone they are a row of tabs and the
  // selected tab's items show below. An empty group shows its muted line. A preset (?bucket=)
  // picks the tab and marks the column; picking another tab clears it.
  // Owner (Oct 7): the columns are the user's to arrange — drag a heading onto another column
  // to move it, the X in a heading hides that column, the "Hidden" chips bring one back, and
  // "Reset layout" restores the default order (lib/work-layout.ts).
  // Owner (Oct 12): a shown group with nothing in it folds into a small "Label 0" chip on an
  // "Empty:" row above the columns (splitEmptyGroups) instead of a whole empty column; the
  // layout (order, hidden) is untouched by the fold, and the "Hidden:" row stays its own.
  const groups = useMemo(
    () => listGroups(items, today, { authorize, invoice, unassigned }),
    [items, today, authorize, invoice, unassigned],
  );
  const keep = preset ? presetBucket(preset) : null;
  const { shown, hidden } = useMemo(
    () => applyWorkLayout(groups, layout, keep),
    [groups, layout, keep],
  );
  const { columns, empty } = useMemo(() => splitEmptyGroups(shown, keep), [shown, keep]);
  const [picked, setPicked] = useState<WorkBucket | null>(null);
  // A new preset (an Owner-view link while already here) wins over an earlier pick.
  const [prevPreset, setPrevPreset] = useState(preset);
  if (prevPreset !== preset) {
    setPrevPreset(preset);
    setPicked(null);
  }
  const bucket = picked ?? defaultBucket(shown, preset);
  // The shown groups cover every pick; the fallback is for the types.
  const group = shown.find((g) => g.bucket === bucket) ??
    groups.find((g) => g.bucket === bucket) ?? {
      bucket,
      label: BUCKET_LABELS[bucket],
      items: [],
    };
  const pick = (b: WorkBucket) => {
    setPicked(b);
    if (preset && b !== preset) onClearPreset();
  };
  // Red: anything overdue, or unassigned work past the "needs assignment" timer.
  const isAlert = (g: WorkGroup) =>
    g.bucket === "overdue"
      ? g.items.length > 0
      : g.bucket === "unassigned" && g.items.some((i) => i.flag);
  const rows = (g: WorkGroup) =>
    g.items.length === 0 ? (
      <p className="text-sm text-muted-foreground">{BUCKET_EMPTY[g.bucket]}</p>
    ) : (
      g.items.map((it) => (
        <WorkRow
          key={it.key}
          item={it}
          showWho={showWho}
          today={today}
          manage={manage}
          claim={claim}
          actions={actions}
        />
      ))
    );

  // Drag a heading onto another column: it lands before a column that was ahead of it, after
  // one that was behind it (moveBucket), so dropping on the last column makes it last.
  const [dragging, setDragging] = useState<WorkBucket | null>(null);
  const [over, setOver] = useState<WorkBucket | null>(null);
  const endDrag = () => {
    setDragging(null);
    setOver(null);
  };
  const drop = (target: WorkBucket) => {
    if (dragging && dragging !== target) onLayout(moveBucket(layout, dragging, target));
    endDrag();
  };
  const customized = !isDefaultWorkLayout(layout);
  const layoutBar = (hidden.length > 0 || customized) && (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {hidden.length > 0 && <span>Hidden:</span>}
      {hidden.map((g) => (
        <Button
          key={g.bucket}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onLayout(showBucket(layout, g.bucket))}
        >
          <Plus className="h-3.5 w-3.5" /> {g.label}
          {g.items.length > 0 && (
            <span className="tabular-nums text-muted-foreground">({g.items.length})</span>
          )}
        </Button>
      ))}
      {customized && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onLayout(defaultWorkLayout())}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset layout
        </Button>
      )}
    </div>
  );
  // The empty groups as chips (owner, Oct 12), in order, each with its ⓘ; they wrap on a phone.
  // Not the Hidden row: a hidden column is out of the list entirely until its chip brings it back.
  const emptyBar = empty.length > 0 && (
    <div
      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      data-row="empty"
    >
      <span>Empty:</span>
      {empty.map((g) => (
        <span
          key={g.bucket}
          data-chip="empty"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1"
        >
          <span>{g.label}</span>
          <span className="tabular-nums">{g.items.length}</span>
          <BucketHelp bucket={g.bucket} label={g.label} />
        </span>
      ))}
    </div>
  );
  const nothing = columns.length === 0 && (
    <p className="text-sm text-muted-foreground">Nothing to do: every group is empty.</p>
  );

  return (
    <>
      {/* Desktop: the shown columns across, every group's items in view at once. */}
      <div className="hidden space-y-3 lg:block">
        {layoutBar}
        {emptyBar}
        {nothing}
        {/* Owner (Oct 7): a column grows with its items until it reaches the bottom of the screen,
          then scrolls inside itself, heading and count staying put (items-start keeps a short
          column short beside a long one). The 13rem is the shell header, the title, the toolbar
          and the paddings above the columns. */}
        <div className={`grid items-start gap-3 lg:grid-cols-3 ${listGridClass(columns.length)}`}>
          {columns.map((g) => (
            <section
              key={g.bucket}
              aria-labelledby={`work-col-${g.bucket}`}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== g.bucket) setOver(g.bucket);
              }}
              onDragLeave={() => {
                if (over === g.bucket) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(g.bucket);
              }}
              className={`flex max-h-[calc(100vh-13rem)] min-w-0 flex-col rounded-lg border transition-shadow ${
                preset && presetBucket(preset) === g.bucket ? "ring-2 ring-primary" : ""
              } ${over === g.bucket && dragging && dragging !== g.bucket ? "ring-2 ring-primary/60" : ""} ${
                dragging === g.bucket ? "opacity-60" : ""
              }`}
            >
              <h2
                id={`work-col-${g.bucket}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", g.bucket);
                  setDragging(g.bucket);
                }}
                onDragEnd={endDrag}
                className={`flex shrink-0 cursor-grab items-center justify-between gap-1 border-b px-3 py-2 text-sm font-semibold active:cursor-grabbing ${
                  isAlert(g) ? "text-destructive" : ""
                }`}
              >
                <span className="flex min-w-0 items-center gap-1">
                  {/* The browser's hover text sits on the grip and the title only, not on the
                      whole heading, so it never covers the ⓘ tooltip (owner, Oct 12). */}
                  <GripVertical
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 break-words" title="Drag to move this column">
                    {g.label}
                  </span>
                  <BucketHelp bucket={g.bucket} label={g.label} />
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="font-normal tabular-nums text-muted-foreground">
                    {g.items.length}
                  </span>
                  <button
                    type="button"
                    aria-label={`Hide ${g.label}`}
                    title="Hide this column (bring it back from the Hidden chips)"
                    onClick={() => onLayout(hideBucket(layout, g.bucket))}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              </h2>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">{rows(g)}</div>
            </section>
          ))}
        </div>
      </div>

      {/* Phone and tablet: a row of tabs, the selected group's items below. */}
      <div className="space-y-4 lg:hidden">
        {layoutBar}
        {emptyBar}
        {nothing}
        {columns.length > 0 && (
          <>
            <div role="tablist" aria-label="Group" className="flex flex-wrap gap-1 border-b">
              {columns.map((g) => {
                const selected = g.bucket === bucket;
                const alert = isAlert(g);
                return (
                  // The ⓘ sits beside the tab, not inside it (a button holds no button).
                  <span key={g.bucket} className="-mb-px flex items-center gap-1">
                    <button
                      type="button"
                      role="tab"
                      id={`work-tab-${g.bucket}`}
                      aria-selected={selected}
                      aria-controls="work-tab-panel"
                      onClick={() => pick(g.bucket)}
                      className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                        selected
                          ? "border-primary font-semibold"
                          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                      } ${alert ? "text-destructive" : ""}`}
                    >
                      {g.label}{" "}
                      <span
                        className={`font-normal tabular-nums ${alert ? "" : "text-muted-foreground"}`}
                      >
                        ({g.items.length})
                      </span>
                    </button>
                    <BucketHelp bucket={g.bucket} label={g.label} />
                  </span>
                );
              })}
            </div>
            <section
              id="work-tab-panel"
              role="tabpanel"
              aria-labelledby={`work-tab-${group.bucket}`}
              className="space-y-2"
            >
              {rows(group)}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function CalendarView({
  items,
  today,
  showWho,
  manage,
  claim = null,
  unassignedPane = false,
  month: urlMonth,
  onMonth,
  actions = null,
  day,
  onDay,
}: {
  items: WorkItem[];
  today: string;
  showWho: boolean;
  manage: ManageFollowup | null;
  /** Owner, Oct 8: the unassigned list beside the calendar; a drop on a day claims it for that day. */
  claim?: ClaimWork | null;
  unassignedPane?: boolean;
  /** The month shown (?month=YYYY-MM; owner, Oct 15), null for this month, and how to change it. */
  month: string | null;
  onMonth: (month: string) => void;
  /**
   * Owner, Oct 15: an assigned ticket or task dragged onto another day is rescheduled
   * (actions.movable / actions.move; nobody's work is still claimed by its drop), and the rows'
   * Done tick / open in place / "Assign to…".
   */
  actions?: WorkActions | null;
  /** The selected day (the page's, so New ticket / New task can carry it). */
  day: string;
  onDay: (day: string) => void;
}) {
  const unassigned = useMemo(() => items.filter((i) => i.unassigned), [items]);
  const dragKey = "text/x-work-key";
  // The month lives in the URL (the route), so List ↔ Calendar and Back keep it (Oct 15).
  const month = urlMonth ?? today.slice(0, 7);
  const setMonth = (next: string | ((m: string) => string)) =>
    onMonth(typeof next === "function" ? next(month) : next);
  // A drop takes any row the page knows: nobody's work is claimed for that day (owner, Oct 8),
  // an assigned ticket or task is moved to it (owner, Oct 15; lib/my-work-actions.ts dropPlan).
  const dropTargets = !!claim || !!actions;
  const dropOn = (key: string, d: string) => {
    const it = items.find((i) => i.key === key);
    if (!it) return false;
    if (it.unassigned) {
      if (claim) claim(it, d);
    } else actions?.move(it, d);
    return true;
  };
  const startDrag = (e: React.DragEvent, it: WorkItem) => {
    e.dataTransfer.setData(dragKey, it.key);
    e.dataTransfer.effectAllowed = "move";
  };
  const byDay = useMemo(() => itemsByDay(items), [items]);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const dayItems = useMemo(() => [...(byDay.get(day) ?? [])].sort(compareWork), [byDay, day]);
  const undated = items.filter((i) => !i.date).length;

  return (
    // Owner (Oct 1): "a tad smaller so I don't have to scroll": on a desktop the month and the
    // day's items share one screen — the grid is sized to the viewport (the 15rem is the shell
    // header, the page title and toolbar, this row of month buttons and the paddings), the weeks
    // divide that height, and the day's items sit beside the grid on xl and up, scrolling inside.
    // Owner, Oct 14 (RoAnna's login: "the calendar view became really compressed"): on a short
    // window or at a higher browser zoom the viewport share left the weeks a few lines tall. The
    // block is never under 36rem (the page scrolls instead) and a week never under 5.5rem (the
    // grid scrolls instead), so a day always shows its number and three lines.
    <div className="flex flex-col gap-4 xl:h-[calc(100vh-15rem)] xl:min-h-[36rem] xl:flex-row">
      {/* Owner, Oct 8: "the unassigned list on the left of the calendar so people can drag and
        drop it onto their own calendar". Dragging a row onto a day takes it and dates it there. */}
      {claim && unassignedPane && (
        <aside className="flex min-h-0 flex-col gap-2 xl:w-64 xl:shrink-0" aria-label="Unassigned">
          <h2 className="flex h-10 shrink-0 items-center text-sm font-semibold">
            Unassigned{" "}
            <span className="ml-1 font-normal text-muted-foreground">({unassigned.length})</span>
          </h2>
          <p className="shrink-0 text-xs text-muted-foreground">
            Drag one onto a day to take it and put it there, or Claim to take it as is.
          </p>
          <div className="min-h-0 flex-1 space-y-2 xl:overflow-y-auto xl:pr-1">
            {unassigned.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing waiting.</p>
            ) : (
              unassigned.map((it) => (
                <div
                  key={it.key}
                  draggable
                  className="cursor-grab active:cursor-grabbing"
                  onDragStart={(e) => startDrag(e, it)}
                >
                  <WorkRow
                    item={it}
                    showWho={false}
                    today={today}
                    manage={null}
                    claim={claim}
                    actions={actions}
                  />
                </div>
              ))
            )}
          </div>
        </aside>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonth((m) => addMonths(m, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{monthLabel(month)}</span>
            {(month !== today.slice(0, 7) || day !== today) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMonth(today.slice(0, 7));
                  onDay(today);
                }}
              >
                Today
              </Button>
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* The whole width (owner: "a bigger calendar", then "wider but shorter"); on xl the weeks
          share the height above, each day clipping past its "+N more" line. */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border xl:flex-1">
          <div className="grid shrink-0 grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-1.5">
                <span className="sm:hidden">{d[0]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 auto-rows-[minmax(5.5rem,1fr)] overflow-y-auto">
            {weeks.map((week) => (
              <div key={week[0]} className="grid grid-cols-7 border-b last:border-b-0">
                {week.map((d) => {
                  const list = byDay.get(d) ?? [];
                  const { shown, more } = cellItems(list);
                  const inMonth = d.slice(0, 7) === month;
                  // Red only for truly overdue work (my-work.ts dayIsOverdue, Oct 15): a Done
                  // ticket waiting to be authorized, one waiting for its invoice or a held
                  // follow-up still shows in the cell, but never colours the day.
                  const overdue = dayIsOverdue(list, d, today);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onDay(d)}
                      onDragOver={
                        dropTargets
                          ? (e) => {
                              if (e.dataTransfer.types.includes(dragKey)) e.preventDefault();
                            }
                          : undefined
                      }
                      onDrop={
                        dropTargets
                          ? (e) => {
                              if (dropOn(e.dataTransfer.getData(dragKey), d)) e.preventDefault();
                            }
                          : undefined
                      }
                      aria-pressed={d === day}
                      aria-label={`${dayLabel(d)}: ${list.length} item${list.length === 1 ? "" : "s"}`}
                      className={`flex min-h-24 min-w-0 flex-col items-stretch gap-1 overflow-hidden border-r p-1 text-left last:border-r-0 xl:min-h-0 ${
                        inMonth ? "" : "bg-muted/30 text-muted-foreground"
                      } ${d === day ? "bg-primary/10 ring-2 ring-inset ring-primary" : "hover:bg-muted/50"}`}
                    >
                      <span
                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-full text-xs ${
                          d === today ? "bg-primary font-semibold text-primary-foreground" : ""
                        } ${overdue && d !== today ? "text-destructive" : ""}`}
                      >
                        {Number(d.slice(8))}
                      </span>
                      {/* Phone: coloured dots; wider screens: up to five titles, each with its
                        kind's colour as a left bar (and whose, in the Everyone view). */}
                      {list.length > 0 && (
                        <>
                          <span className="flex flex-wrap gap-0.5 sm:hidden">
                            {shown.map((i) => (
                              <span
                                key={i.key}
                                className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[i.kind]}`}
                              />
                            ))}
                            {more > 0 && <span className="text-[10px] leading-none">+{more}</span>}
                          </span>
                          <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                            {shown.map((i) => (
                              // Owner, Oct 15: an assigned ticket or task is dragged to another
                              // day from its cell (whoever may move it: actions.movable).
                              <span
                                key={i.key}
                                title={showWho ? `${i.title} — ${i.assigneeName ?? ""}` : i.title}
                                draggable={!!actions?.movable(i)}
                                onDragStart={
                                  actions?.movable(i) ? (e) => startDrag(e, i) : undefined
                                }
                                className={`flex min-w-0 items-center gap-1 rounded-sm border-l-4 bg-muted/60 pl-1 pr-0.5 text-[11px] leading-4 ${KIND_BAR[i.kind]} ${
                                  i.done ? "opacity-60" : ""
                                } ${actions?.movable(i) ? "cursor-grab active:cursor-grabbing" : ""}`}
                              >
                                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                                {showWho && (
                                  <span className="shrink-0 rounded bg-background px-1 text-[9px] font-semibold leading-3 text-muted-foreground">
                                    {initials(i.assigneeName)}
                                  </span>
                                )}
                              </span>
                            ))}
                            {more > 0 && (
                              <span className="text-[11px] text-muted-foreground">
                                +{more} more
                              </span>
                            )}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The day's items: under the grid, or beside it on xl and up (a 20rem column). */}
      <section className="flex min-h-0 flex-col gap-2 xl:w-80 xl:shrink-0">
        <h2 className="flex h-10 shrink-0 items-center text-sm font-semibold">
          {dayLabel(day)}{" "}
          <span className="ml-1 font-normal text-muted-foreground">({dayItems.length})</span>
        </h2>
        <div className="min-h-0 flex-1 space-y-2 xl:overflow-y-auto xl:pr-1">
          {dayItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing on this day.</p>
          ) : (
            <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-1">
              {dayItems.map((it) =>
                // The day's rows drag too (owner, Oct 15), like the Unassigned aside's.
                actions?.movable(it) ? (
                  <div
                    key={it.key}
                    draggable
                    className="cursor-grab active:cursor-grabbing"
                    onDragStart={(e) => startDrag(e, it)}
                  >
                    <WorkRow
                      item={it}
                      showWho={showWho}
                      today={today}
                      manage={manage}
                      claim={claim}
                      actions={actions}
                    />
                  </div>
                ) : (
                  <WorkRow
                    key={it.key}
                    item={it}
                    showWho={showWho}
                    today={today}
                    manage={manage}
                    claim={claim}
                    actions={actions}
                  />
                ),
              )}
            </div>
          )}
          {undated > 0 && (
            <p className="text-xs text-muted-foreground">
              {undated} item{undated === 1 ? " has" : "s have"} no date — see the List.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

export function MyWorkPage(props: {
  /** The URL's ?view, ?who and ?month as they are — null when absent (the remembered ones apply). */
  view: MyWorkView | null;
  who: string | null;
  month: string | null;
  bucket: BucketPreset | null;
  onView: (v: MyWorkView) => void;
  onWho: (who: string) => void;
  onMonth: (month: string | null) => void;
  onBucket: (b: BucketPreset | null) => void;
}) {
  const { session, profile } = useAuth();
  const qc = useQueryClient();
  const [newTask, setNewTask] = useState(false);
  // The user's layout (owner, Oct 7): the browser's copy first, then the profile's copy once the
  // list brings it (it wins; below); every change goes to both. Since Oct 15 it also remembers
  // the view and whose work (lib/work-layout.ts): the URL's ?view / ?who win, and when the URL is
  // silent — the sidebar's link, the sign-in landing — the remembered ones apply (landingSearch).
  const userId = profile?.id ?? session?.user.id ?? "";
  const storage = typeof window === "undefined" ? null : window.localStorage;
  const [layout, setLayout] = useState<WorkLayout>(
    () => (userId && readStoredWorkLayout(storage, userId)) || defaultWorkLayout(),
  );
  useEffect(() => {
    if (!userId) return;
    const stored = readStoredWorkLayout(storage, userId);
    if (stored) setLayout(stored);
  }, [storage, userId]);
  const landing = landingSearch(layout, { view: props.view, who: props.who });
  // ?view=owner is honoured for admins only; anyone else gets the list.
  const view = effectiveView(landing.view, profile);
  // No ?who: the remembered person, else Everyone for admins and managers, Mine for anyone else.
  const who = resolveWho(landing.who, profile);
  // The Owner toggle: admins only (the server's listOwnerView refuses anyone else too).
  const ownerToggle = isAdmin(profile);
  const listFn = useServerFn(listMyWork);
  const q = useQuery({
    queryKey: ["my-work", who],
    queryFn: () => listFn({ data: { who } }),
    enabled: !!session && view !== "owner",
    // Owner, Oct 15: "do every 5 minutes just so we're not constantly refreshing" — the list
    // refreshes itself while the page sits open, not while the tab is in the background.
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });

  // Errors toast the server's message (and stay on the page until the next try).
  const errMsg = q.error ? errText(q.error) : null;
  useEffect(() => {
    if (errMsg) toast.error(`Could not load your work: ${errMsg}`);
  }, [errMsg]);

  // Owner, Oct 8: claiming unassigned work (the row's Claim, or a drop on a calendar day).
  const claimTicketFn = useServerFn(claimServiceJob);
  const claimOppFn = useServerFn(claimOpportunity);
  const claimTaskFn = useServerFn(claimTask);
  const claimMut = useMutation({
    /** Resolves to the expected close an opportunity KEPT when the caller may not move it. */
    mutationFn: async (v: { item: WorkItem; date: string | null }): Promise<string | null> => {
      const id = v.item.key.slice(v.item.key.indexOf(":") + 1);
      if (v.item.kind === "opportunity") {
        // Owner, Oct 15: a non-manager's drop on a day still claims an opportunity that has an
        // expected close — the date stays, and the server says so (dateKept).
        const r = await claimOppFn({ data: { id, date: v.date } });
        return r.dateKept ? (r.expected_close ?? null) : null;
      }
      // A task nobody is on (owner, Oct 9: tasks behave like services here).
      if (v.item.kind === "task") await claimTaskFn({ data: { id, date: v.date } });
      else await claimTicketFn({ data: { id, date: v.date } });
      return null;
    },
    onSuccess: (kept, v) => {
      toast.success(
        kept
          ? `Yours — its expected close stays ${monthDay(kept)}`
          : v.date
            ? `Yours, on ${dayLabel(v.date)}`
            : "Yours — it is on your list now",
      );
      void qc.invalidateQueries({ queryKey: ["my-work"] });
    },
    // "Someone already has it": the row is stale, so the list is refetched (Oct 15).
    onError: (e: Error) => {
      toast.error(e.message || "Could not claim it");
      void qc.invalidateQueries({ queryKey: ["my-work"] });
    },
  });
  const claim: ClaimWork | null = canClaim(profile)
    ? (item, date) => claimMut.mutate({ item, date })
    : null;
  /** The row being claimed: its buttons disable while the claim is in flight (Oct 15). */
  const claimingKey = claimMut.isPending ? (claimMut.variables?.item.key ?? null) : null;

  const today = localYmd(new Date());
  const items = useMemo(
    () => (q.data ? flagUnassigned(mergeWork(q.data), today, q.data.unassignedOverdueDays) : []),
    [q.data, today],
  );

  // Owner, Oct 15: a task row opens in place, its Done tick, a ticket or a task dragged to
  // another calendar day, "Assign to…" on an unassigned row (components/my-work-actions.tsx; the
  // rules in lib/my-work-actions.ts). The Calendar's selected day is the page's, so New ticket
  // and New task carry it.
  const navigate = useNavigate();
  const { actions: rowActions, editTask, closeTask } = useWorkActions(profile);
  // A row's busy set includes the claim in flight on it (Oct 15: Claim could be clicked twice).
  const actions: WorkActions = {
    ...rowActions,
    busy: (item) => rowActions.busy(item) || item.key === claimingKey,
  };
  const [calDay, setCalDay] = useState(today);
  const newDay = view === "calendar" ? calDay : null;
  const showNewTicket = dispatchesTickets(profile);
  const showNewOpportunity = seesOpportunitiesList(profile);

  // The profile's copy of the layout rides on the list (listMyWork; Oct 15 — one request on
  // landing, not two). It seeds the saved-layout cache, which is applied as before (below), but
  // only when the list is newer than the cache (shouldSeedWorkLayout: a list fetched before a
  // local save — one React Query still held when the page remounted — must not put the old
  // layout back); the 5-minute refresh brings another device's change. getMyWorkLayout stays as
  // the cache's query, never fetched by itself.
  const layoutFn = useServerFn(getMyWorkLayout);
  const saveLayoutFn = useServerFn(setMyWorkLayout);
  const savedLayout = useQuery({
    queryKey: ["work-layout", userId],
    queryFn: () => layoutFn(),
    enabled: false,
    staleTime: 5 * 60_000,
  });
  const listLayout = q.data?.layout;
  const listUpdatedAt = q.dataUpdatedAt;
  useEffect(() => {
    if (listLayout === undefined || !userId) return;
    if (shouldSeedWorkLayout(qc.getQueryState(["work-layout", userId]), listUpdatedAt))
      qc.setQueryData<{ layout: WorkLayout | null }>(["work-layout", userId], {
        layout: listLayout,
      });
  }, [listLayout, listUpdatedAt, qc, userId]);
  // The profile's copy wins: a layout applies as it is; null (the server's default — another
  // device's Reset, Oct 15) applies the default and drops this browser's copy. Before this null
  // was ignored, so a Reset made elsewhere never arrived here.
  useEffect(() => {
    if (!savedLayout.data || !userId) return;
    const l = savedLayout.data.layout ?? defaultWorkLayout();
    setLayout(l);
    writeStoredWorkLayout(storage, userId, l);
  }, [savedLayout.data, storage, userId]);
  // The saved-layout cache follows every save (owner, Oct 9: "i restored the layout on the work
  // overview but it doesnt remember i restored it when i navigate away and then back" — the
  // stale cached copy was re-applied on the next mount and written back over the reset). A save
  // the profile refused says so (Oct 15; setMyWorkLayout throws): the browser's copy stands.
  const saveLayout = useMutation({
    mutationFn: (l: WorkLayout) => saveLayoutFn({ data: l }),
    onMutate: (l) => {
      qc.setQueryData<{ layout: WorkLayout | null }>(["work-layout", userId], {
        layout: isEmptyWorkLayout(l) ? null : l,
      });
    },
    onError: () => toast.error(LAYOUT_SAVE_FAILED, { duration: 10_000 }),
  });
  const commitLayout = (l: WorkLayout) => {
    setLayout(l);
    if (userId) writeStoredWorkLayout(storage, userId, l);
    saveLayout.mutate(l);
  };
  // Columns and kinds, from the List and the Show menu: the remembered view and person ride
  // along (Reset layout resets the columns, not where the user was).
  const onLayout = (l: WorkLayout) => commitLayout(keepRemembered(l, layout));
  // The view and the person (owner, Oct 15: remembered per user): saved, then put in the URL.
  const changeView = (v: MyWorkView) => {
    const next = rememberView(layout, v);
    if (next !== layout) commitLayout(next);
    props.onView(v);
  };
  const changeWho = (w: string) => {
    const next = rememberWho(layout, whoParam(w, profile));
    if (next !== layout) commitLayout(next);
    props.onWho(w);
  };

  // Follow-ups are management's (owner, Oct 1): Snooze only under seesEveryone (admin or
  // manager); the server (canManageFollowup) and the database trigger refuse anyone else. No
  // Close here since Oct 15 (owner: "i think it may cause more issues than not") — a follow-up
  // closes with its item (the ticket authorized, the opportunity won or lost); the Opportunities
  // page keeps its own Close.
  const canManage = seesEveryone(profile);
  const { snooze } = useFollowupActions();
  const manage: ManageFollowup | null = canManage
    ? (f) => {
        const busy = snooze.isPending && snooze.variables?.id === f.id;
        return (
          <>
            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <SnoozeMenu
              disabled={busy}
              today={today}
              onSnooze={(hold) => snooze.mutate({ id: f.id, ...hold })}
            />
          </>
        );
      }
    : null;
  const hasFollowups = items.some((i) => i.followup?.status === "open");
  // Show (owner, Oct 14): the kinds the user unticked are left out of the List and the Calendar.
  const visibleItems = useMemo(() => applyKinds(items, layout), [items, layout]);
  const canPick = !!q.data?.canPick;
  const scope = q.data?.scope;
  const mineOnly = scope !== "all" && scope?.length === 1 && scope[0] === profile?.id;
  const showWho = !!scope && !mineOnly;
  const people = q.data?.people ?? [];
  // A remembered or linked person who is not on the roster any more (Oct 15: a blank Select and
  // "Someone else: …"): once the roster is here, fall back to the caller's default and forget
  // them, once (changeWho clears the remembered who and the URL).
  const shownWho = effectiveWho(who, people, profile, !!q.data);
  useEffect(() => {
    if (shownWho !== who) changeWho(shownWho);
    // changeWho is re-made every render; the fallback depends on `who` and the roster only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownWho, who]);
  const whoName =
    who === "all"
      ? "Everyone"
      : who === "mine"
        ? null
        : (people.find((p) => p.id === who)?.name ?? null);

  return (
    // Owner (Oct 1): every view uses the whole width ("a lot of unused whitespace"; "a bigger
    // calendar"; the List's six columns across).
    <div className="mx-auto max-w-none space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ListTodo className="h-6 w-6" /> Work Overview
        </h1>
        <p className="text-sm text-muted-foreground">
          {view === "owner"
            ? "Everyone: what is due today, what is overdue, what got done this week."
            : mineOnly || !scope
              ? "Your tickets, tasks, follow-ups, opportunities and bids, by date."
              : `${whoName ?? "Someone else"}: tickets, tasks, follow-ups, opportunities and bids, by date.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setNewTask(true)}>
          <Plus className="h-4 w-4" /> New task
        </Button>
        {/* Owner, Oct 15: New ticket for whoever dispatches (dispatchesTickets), New opportunity
          for whoever works the Opportunities list (seesOpportunitiesList); from the Calendar the
          ticket and the task take the selected day. Real links, so a modifier-click opens a tab. */}
        {showNewTicket && (
          <Button size="sm" variant="outline" asChild>
            <a href={newTicketHref(newDay)} onClick={followLink(navigate, newTicketHref(newDay))}>
              <Plus className="h-4 w-4" /> New ticket
            </a>
          </Button>
        )}
        {showNewOpportunity && (
          <Button size="sm" variant="outline" asChild>
            <a href={NEW_OPPORTUNITY_HREF} onClick={followLink(navigate, NEW_OPPORTUNITY_HREF)}>
              <Plus className="h-4 w-4" /> New opportunity
            </a>
          </Button>
        )}
        <TaskDialog
          open={newTask}
          onOpenChange={setNewTask}
          defaults={newDay ? { date: newDay } : undefined}
          onSaved={() => void qc.invalidateQueries({ queryKey: ["my-work"] })}
        />
        {/* A task row opened in place (owner, Oct 15): the same dialog, on that task. */}
        <TaskDialog
          open={!!editTask}
          task={editTask ?? undefined}
          onOpenChange={(o) => {
            if (!o) closeTask();
          }}
          onSaved={() => void qc.invalidateQueries({ queryKey: ["my-work"] })}
        />
        <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="View">
          <Button
            size="sm"
            variant={view === "list" ? "default" : "ghost"}
            aria-pressed={view === "list"}
            onClick={() => changeView("list")}
          >
            <List className="h-4 w-4" /> List
          </Button>
          <Button
            size="sm"
            variant={view === "calendar" ? "default" : "ghost"}
            aria-pressed={view === "calendar"}
            onClick={() => changeView("calendar")}
          >
            <CalendarDays className="h-4 w-4" /> Calendar
          </Button>
          {ownerToggle && (
            <Button
              size="sm"
              variant={view === "owner" ? "default" : "ghost"}
              aria-pressed={view === "owner"}
              onClick={() => changeView("owner")}
            >
              <Users className="h-4 w-4" /> Owner
            </Button>
          )}
        </div>
        {view !== "owner" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                aria-label="Which kinds of work to show"
                title="Tick the kinds of work you want on this page"
              >
                <Eye className="h-4 w-4" /> Show: {kindsSummary(layout)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Show on this page</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {WORK_KINDS.map((k) => {
                const on = !layout.hiddenKinds.includes(k);
                const last = on && layout.hiddenKinds.length >= WORK_KINDS.length - 1;
                return (
                  <DropdownMenuCheckboxItem
                    key={k}
                    checked={on}
                    disabled={last}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => onLayout(toggleKind(layout, k))}
                  >
                    {KIND_PLURALS[k]}
                  </DropdownMenuCheckboxItem>
                );
              })}
              <DropdownMenuSeparator />
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                Remembered for you on every device. One kind always stays on.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {canPick && view !== "owner" && (
          <Select value={who} onValueChange={changeWho}>
            <SelectTrigger className="h-9 w-[220px]" aria-label="Show">
              <span className="mr-1 text-muted-foreground">Show:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">Mine</SelectItem>
              <SelectItem value="all">Everyone</SelectItem>
              {people.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>One person</SelectLabel>
                    {people
                      .filter((p) => p.id !== profile?.id)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          {p.technician ? " (tech)" : ""}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>
        )}
        {q.isFetching && view !== "owner" && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {!canManage && hasFollowups && !errMsg && view !== "owner" && (
        <p className="text-xs text-muted-foreground">Follow-ups are managed by your manager.</p>
      )}
      {/* Owner, Oct 15: each kind is capped at 1,000 rows (listMyWork LIMIT); say so when hit —
          on the Calendar too (it shows the same rows), and "narrow to one person" only when the
          page is on Everyone (one person's list is already as narrow as it gets). */}
      {view !== "owner" && !errMsg && q.data?.truncated && (
        <p className="text-xs text-muted-foreground" data-row="truncated">
          Showing the first 1,000 of each kind.
          {who === "all" ? " Narrow to one person to see everything." : ""}
        </p>
      )}

      {view === "owner" && ownerToggle ? (
        <OwnerView />
      ) : q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : errMsg ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">Could not load your work: {errMsg}</p>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </div>
      ) : view === "calendar" ? (
        <CalendarView
          items={visibleItems}
          today={today}
          month={props.month}
          onMonth={(m) => props.onMonth(m === today.slice(0, 7) ? null : m)}
          showWho={showWho}
          manage={manage}
          claim={claim}
          unassignedPane={!!q.data?.unassigned}
          actions={actions}
          day={calDay}
          onDay={setCalDay}
        />
      ) : (
        // Nothing at all shows every heading as an "Empty:" chip (Oct 12), no columns.
        <ListView
          items={visibleItems}
          today={today}
          showWho={showWho}
          manage={manage}
          preset={props.bucket}
          onClearPreset={() => props.onBucket(null)}
          authorize={!!q.data?.authorizer}
          invoice={!!q.data?.invoicer}
          unassigned={!!q.data?.unassigned}
          layout={layout}
          onLayout={onLayout}
          claim={claim}
          actions={actions}
        />
      )}
    </div>
  );
}
