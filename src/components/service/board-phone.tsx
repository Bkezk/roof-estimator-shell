/**
 * The Tech Board on a phone (owner, Nov 17; the rules and the owner's two choices are in
 * lib/board-phone.ts): the week as seven day cards, and a details pop-up on a tap.
 *
 *   - The week is the page (owner, Nov 20: "can we have the calendar be bigger and remove the
 *     list of technicians so we can see the days better"): seven full-width day cards, each
 *     with every ticket on it and the technician's name on the ticket. Before this the days were
 *     seven small buttons, and the page was a row per technician for one day, most of them
 *     reading "Nothing this day".
 *   - Tap a day to choose it: it is the day a ticket dropped on a technician goes to.
 *   - The Unassigned tickets sit in a tray that stays at the bottom of the screen.
 *   - Hold a ticket and it lifts; the technicians come up in a block right above the tray
 *     (owner, Nov 19 and Nov 20: "once we drag a job up the technician list appears anyway").
 *     Drag it onto a technician there, onto a day card (rest there a moment and that day is
 *     chosen), back onto the tray to unassign it, or onto "A week earlier" / "A week later",
 *     which show at the top of the screen while a ticket is held (hooks/use-hold-drag.ts). A
 *     swipe still scrolls.
 *   - A tap opens the ticket's details over the board, with Open ticket, Move (pick a technician
 *     and a day without dragging), Call and Directions. Closing it leaves the board where it was.
 *
 * Every move is the same single write the desk grid makes (assignServiceJob, through the board's
 * own mutation in board-page.tsx), so the same rules, the same history and the same notices apply.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  ArrowRightLeft,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GripVertical,
  Inbox,
  Loader2,
  MapPin,
  Phone,
  Plus,
  SquareArrowOutUpRight,
  UserRound,
} from "lucide-react";

import { RateBadge } from "@/components/service/rate-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useHoldDrag } from "@/hooks/use-hold-drag";
import { arrivalLabel } from "@/lib/arrival-window";
import { chipBadge, chipDescription, chipFacts, chipPlace } from "@/lib/board-chip";
import { getBoardPeek } from "@/lib/board-peek.functions";
import {
  NEXT_WEEK_KEY,
  PREV_WEEK_KEY,
  RAIL_KEY,
  cellKey,
  dayCountWords,
  dayKey,
  dayNumber,
  dayShort,
  dayTitle,
  dockColumns,
  dockFor,
  dockHeight,
  dockNote,
  dockRoom,
  dockScroll,
  dockTitle,
  liftDayIndex,
  isDayKey,
  mapsUrl,
  movableOnBoard,
  parseDropKey,
  peekAddressLines,
  peekMapQuery,
  peekPhone,
  planDrop,
  startDayIndex,
  type MovePlan,
} from "@/lib/board-phone";
import { plainErrText } from "@/lib/plain-error";
import { boardDay, inStageSince } from "@/lib/service-schedule";
import {
  SERVICE_STAGES,
  STAGE_LABELS,
  type ServiceJobListRow as Job,
  type ServiceStage,
} from "@/lib/service.functions";
import {
  FIELD_TONE_LABELS,
  RATE_TONES,
  STAGE_TONES,
  stageMark,
  ticketToneKey,
  type StageToneKey,
} from "@/lib/stage-colors";

/**
 * Sizes here are in pixels on purpose: the site's text and controls are set small for a desk
 * (styles.css: 1rem is 13px), and a thumb needs 44 real pixels whatever the desk is given. The
 * boxes a person types in are 16px, the size below which an iPhone zooms the page on a tap.
 */
const PEEK_BUTTON = "h-[46px] text-[15px]";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LEGEND: readonly StageToneKey[] = [
  "open",
  "scheduled",
  "en_route",
  "on_site",
  "done",
  "authorized",
  "invoiced",
  "closed",
];
const asStage = (s: string): ServiceStage =>
  (SERVICE_STAGES as readonly string[]).includes(s) ? (s as ServiceStage) : "open";
const monthDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** The day last looked at, kept for this tab so Back from a ticket returns to it. */
const DAY_KEY = "jbk-board-day";
const readDay = (): string | null => {
  try {
    return window.sessionStorage.getItem(DAY_KEY);
  } catch {
    return null;
  }
};
const keepDay = (ymd: string) => {
  try {
    window.sessionStorage.setItem(DAY_KEY, ymd);
  } catch {
    /* private mode: the board still works, it just opens on today */
  }
};

interface Row {
  id: string;
  name: string;
}

export interface PhoneBoardProps {
  /** The week, Monday first. */
  days: string[];
  today: string;
  jobs: Job[];
  techRows: Row[];
  /** Anyone else holding a ticket this week (an office user, a former technician). */
  otherRows: Row[];
  /** The Unassigned tickets, in the board's order, narrowed by the search. */
  rail: Job[];
  /** Finished with no technician, narrowed by the search. */
  finished: Job[];
  unassignedTotal: number;
  finishedTotal: number;
  search: string;
  onSearch: (v: string) => void;
  /** A manager or the office: tickets move, rows carry the "+". */
  dispatch: boolean;
  cellJobs: (techId: string, ymd: string) => Job[];
  /** One move: the board's own write. */
  onMove: (job: Job, plan: MovePlan) => void;
  /** The ticket lifted by a finger, and the target under it (the board's own state: Prev / Next show it too). */
  dragId: string | null;
  over: string | null;
  onDragId: (id: string | null) => void;
  onOver: (key: string | null) => void;
}

export function PhoneBoard(p: PhoneBoardProps) {
  const [dayIdx, setDayIdx] = useState(() => startDayIndex(p.days, p.today, readDay()));
  const day = p.days[dayIdx] ?? p.days[0]!;
  useEffect(() => keepDay(day), [day]);
  const [trayOpen, setTrayOpen] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);

  const ghost = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLElement>(null);
  const weeks = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const dragging = !!p.dragId;
  const dragged = p.dragId ? p.jobs.find((j) => j.id === p.dragId) : undefined;

  const bind = useHoldDrag({
    ghost,
    topEdge: () => (weeks.current ?? strip.current)?.getBoundingClientRect().bottom ?? 0,
    // The dock is a target, not part of the list: the page does not scroll under a finger on it.
    bottomEdge: () =>
      (dock.current ?? tray.current)?.getBoundingClientRect().top ?? window.innerHeight,
    onLift: (id) => {
      // The open tray folds out of the way of the technicians, and stays folded after the drop
      // so the result is on the screen.
      setTrayOpen(false);
      // A ticket that is on a day of this week is held for that day: dropped on a technician it
      // keeps its day, unless the finger rests on another day first.
      const own = liftDayIndex(
        p.jobs.find((j) => j.id === id),
        p.days,
      );
      if (own >= 0) setDayIdx(own);
      p.onDragId(id);
    },
    onOver: (key) => p.onOver(key),
    onDrop: (id, key) => {
      const job = p.jobs.find((j) => j.id === id);
      const plan = job ? planDrop(job, parseDropKey(key)) : null;
      if (job && plan) p.onMove(job, plan);
    },
    onEnd: () => {
      p.onDragId(null);
      p.onOver(null);
    },
    // A lifted ticket resting on a day button switches the board to that day, so it can go on
    // to a technician there without letting go.
    dwells: isDayKey,
    onDwell: (key) => {
      const t = parseDropKey(key);
      const i = t?.kind === "day" ? p.days.indexOf(t.ymd) : -1;
      if (i >= 0) setDayIdx(i);
    },
  });

  // Everyone holding a ticket this week, technicians first: a day card lists their tickets.
  const people = [...p.techRows, ...p.otherRows];
  const dayItems = (d: string) =>
    people.flatMap((r) => p.cellJobs(r.id, d).map((job) => ({ job, who: r.name })));
  const peek = peekId ? p.jobs.find((j) => j.id === peekId) : undefined;
  const expanded = trayOpen;
  // Prev and Next scroll off the top of a phone, so a lifted ticket that can move a week (it has
  // a technician and a day) is given two targets under the day buttons for as long as it is held.
  const weekTargets = p.dispatch && !!dragged?.technician_id && !!dragged.scheduled_date;
  const overClass = "ring-2 ring-inset ring-primary bg-primary/10";
  // The technician dock (lib/board-phone.ts): shown while a dispatcher holds a ticket. It is the
  // only place the technicians are listed (owner, Nov 20). It hangs
  // on the tray's top edge by itself (it is drawn inside the tray); only the room above the tray
  // is measured, before the screen is drawn, to choose two or three technicians across.
  const showDock = p.dispatch && p.techRows.length > 0 && dockFor(dragged);
  const [dockSpace, setDockSpace] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!showDock) {
      setDockSpace(null);
      return;
    }
    const measure = () => {
      const trayTop = tray.current?.getBoundingClientRect().top ?? window.innerHeight;
      const listTop = (weeks.current ?? strip.current)?.getBoundingClientRect().bottom ?? 0;
      return dockRoom(trayTop, listTop);
    };
    let room = measure();
    // Not enough room for two technicians across: the page's own heading is still above the day
    // buttons. Scroll it away (the day buttons then sit at the top of the screen, the tray stays
    // at the bottom) and measure again.
    const bar = strip.current;
    if (bar) {
      const slack = bar.getBoundingClientRect().top - (parseFloat(getComputedStyle(bar).top) || 0);
      const left = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      const by = dockScroll(dockHeight(p.techRows.length, 2), room, slack, left);
      if (by > 0) {
        window.scrollBy(0, by);
        room = measure();
      }
    }
    setDockSpace(room);
    // Measured when the ticket lifts, and again if the tray or the week targets change height.
  }, [showDock, trayOpen, weekTargets, p.techRows.length]);

  const dayCard = (d: string, i: number) => {
    const on = i === dayIdx;
    const key = dayKey(d);
    const items = dayItems(d);
    const n = items.length;
    return (
      <section
        key={d}
        data-day={d}
        data-day-card={on ? "chosen" : "day"}
        data-drop={p.dispatch ? dayKey(d) : undefined}
        aria-label={`${dayTitle(d)}, ${dayCountWords(n)}`}
        className={`space-y-2 rounded-lg border p-2 transition-colors ${
          p.over === key
            ? overClass
            : on
              ? "border-primary bg-primary/10"
              : d === p.today
                ? "border-primary/60 bg-card"
                : "bg-card"
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => setDayIdx(i)}
            className="flex min-h-[44px] min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-left"
          >
            <span className="text-lg font-semibold leading-tight">{dayTitle(d)}</span>
            {d === p.today && <span className="text-xs font-medium text-primary">Today</span>}
            <span className="ml-auto text-xs text-muted-foreground" data-day-count={n}>
              {dayCountWords(n)}
            </span>
          </button>
          {p.dispatch && (
            <Link
              to="/service"
              search={{ new: 1, date: d }}
              className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground"
              aria-label={`New ticket on ${dayShort(d)}`}
            >
              <Plus className="h-5 w-5" />
            </Link>
          )}
        </div>
        {items.map(({ job: j, who }) => (
          <PhoneChip
            key={j.id}
            job={j}
            who={who}
            drag={p.dispatch}
            lifted={p.dragId === j.id}
            bind={bind}
            onOpen={setPeekId}
          />
        ))}
        {n === 0 && dragging && <p className="pb-1 text-xs text-muted-foreground">Drop here</p>}
      </section>
    );
  };

  return (
    <div className="space-y-3" data-board="phone">
      {/* A line with no height that stays at the top of the screen. The dock measures its room
          from it, and the two week targets hang from it while a ticket is held. */}
      <div
        ref={strip}
        data-board-top
        className="sticky top-[var(--jbk-top-gap,0px)] z-20 -mx-4 h-0 sm:-mx-6"
      >
        {weekTargets && (
          <div
            ref={weeks}
            data-board-weeks
            className="absolute inset-x-0 top-0 grid grid-cols-2 gap-2 border-b bg-background px-4 py-2 shadow-md sm:px-6"
          >
            <div
              data-drop={PREV_WEEK_KEY}
              className={`flex h-[44px] items-center justify-center gap-1 rounded-md border border-dashed text-sm font-medium ${
                p.over === PREV_WEEK_KEY ? overClass : "bg-card"
              }`}
            >
              <ChevronLeft className="h-4 w-4" /> A week earlier
            </div>
            <div
              data-drop={NEXT_WEEK_KEY}
              className={`flex h-[44px] items-center justify-center gap-1 rounded-md border border-dashed text-sm font-medium ${
                p.over === NEXT_WEEK_KEY ? overClass : "bg-card"
              }`}
            >
              A week later <ChevronRight className="h-4 w-4" />
            </div>
          </div>
        )}
      </div>

      {p.techRows.length === 0 && (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          No technicians yet. An admin marks people as technicians on Admin › Settings › Users &amp;
          access.
        </p>
      )}
      {/* The week: a card a day, each with every ticket on it. */}
      <div
        className="space-y-2"
        role="tablist"
        aria-label="Days"
        aria-orientation="vertical"
        data-board-days
      >
        {p.days.map((d, i) => dayCard(d, i))}
      </div>

      {/* The tray: it stays at the bottom of the screen, and is the target that unassigns. */}
      <section
        ref={tray}
        data-board-tray
        data-drop={p.dispatch ? RAIL_KEY : undefined}
        aria-label="Unassigned tickets"
        className={`sticky bottom-0 z-20 -mx-4 space-y-2 border-t px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-6px_16px_rgba(0,0,0,0.18)] transition-colors sm:-mx-6 sm:px-6 ${
          p.over === RAIL_KEY ? "bg-card ring-2 ring-inset ring-primary" : "bg-card"
        }`}
      >
        {/* The technician dock: every technician within an inch or two of the finger. It hangs
              on the tray's top edge. Its own key is empty, so a finger let go between two
              technicians drops on nothing (not on the tray under it, which would unassign). */}
        {showDock && dockSpace !== null && (
          <div
            ref={dock}
            data-board-dock
            data-drop=""
            aria-label={dockTitle(day)}
            style={{ maxHeight: dockSpace }}
            className="absolute inset-x-0 bottom-full mb-0 overflow-hidden border-t bg-card px-4 pb-2 pt-1 shadow-[0_-8px_20px_rgba(0,0,0,0.3)] sm:px-6"
          >
            {/* The days, under the finger: rest on one and it is the day the technicians below
                are for; let go on one and only the day changes. */}
            <div className="mb-[6px] grid h-[44px] grid-cols-7 gap-1" data-dock-days>
              {p.days.map((d, i) => (
                <div
                  key={d}
                  data-drop={dayKey(d)}
                  data-dock-day={d}
                  className={`flex flex-col items-center justify-center rounded-md border text-[11px] leading-none transition-colors ${
                    p.over === dayKey(d)
                      ? overClass
                      : i === dayIdx
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background"
                  }`}
                >
                  <span>{DAY_NAMES[i]}</span>
                  <span className="mt-0.5 text-sm font-semibold">{dayNumber(d)}</span>
                </div>
              ))}
            </div>
            <p className="flex h-[30px] items-center text-xs font-semibold">{dockTitle(day)}</p>
            <div
              className={`grid gap-[6px] ${
                dockColumns(p.techRows.length, dockSpace) === 3 ? "grid-cols-3" : "grid-cols-2"
              }`}
            >
              {p.techRows.map((r) => {
                const key = cellKey(r.id, day);
                const hasIt = dragged?.technician_id === r.id && dragged.scheduled_date === day;
                return (
                  <div
                    key={r.id}
                    data-drop={key}
                    data-dock-tech={r.id}
                    className={`flex h-[48px] items-center gap-2 rounded-md border px-2 transition-colors ${
                      p.over === key ? overClass : hasIt ? "bg-muted/60" : "bg-background"
                    }`}
                  >
                    <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-semibold">{r.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {dockNote(p.cellJobs(r.id, day).length, hasIt)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <button
          type="button"
          className="flex min-h-[44px] w-full items-center gap-2 text-left text-sm font-semibold"
          aria-expanded={expanded}
          onClick={() => setTrayOpen((v) => !v)}
        >
          <Inbox className="h-4 w-4 shrink-0" />
          Unassigned
          <span className="font-normal text-muted-foreground" data-tray-count={p.unassignedTotal}>
            {p.unassignedTotal}
          </span>
          <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
            {dragging
              ? "Drop here to unassign"
              : expanded
                ? "Hide"
                : p.finishedTotal > 0
                  ? `Show all · ${p.finishedTotal} finished`
                  : "Show all"}
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </span>
        </button>

        {expanded && (
          <>
            <Input
              type="search"
              placeholder="Search #, customer, property…"
              value={p.search}
              onChange={(e) => p.onSearch(e.target.value)}
              className="h-[44px] bg-background text-[16px]"
            />
            <ul
              className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
              aria-label="Colours"
            >
              {LEGEND.map((s) => (
                <li key={s} className="flex items-center gap-1">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-sm border ${STAGE_TONES[s].chip}`}
                    aria-hidden
                  />
                  {s === "en_route" || s === "on_site" ? FIELD_TONE_LABELS[s] : STAGE_LABELS[s]}
                </li>
              ))}
            </ul>
          </>
        )}

        {/* One list in both states, so a ticket lifted out of the open tray stays on the page
            while the tray folds out of the way of the technicians. */}
        <div
          data-tray-list
          className={
            expanded
              ? "max-h-[45dvh] space-y-2 overflow-y-auto overscroll-contain"
              : "flex gap-2 overflow-x-auto overscroll-contain pb-1"
          }
        >
          {p.rail.length === 0 ? (
            <p className="py-1 text-xs text-muted-foreground">
              {p.unassignedTotal === 0
                ? "Every open ticket has a technician and a day."
                : "No unassigned tickets match."}
            </p>
          ) : (
            p.rail.map((j) => (
              <PhoneChip
                key={j.id}
                job={j}
                rail
                compact={!expanded}
                drag={p.dispatch}
                lifted={p.dragId === j.id}
                bind={bind}
                onOpen={setPeekId}
              />
            ))
          )}
          {expanded && p.finishedTotal > 0 && (
            <section
              className="space-y-2 border-t pt-2"
              aria-label="Finished tickets with no technician"
              data-rail="finished-unassigned"
            >
              <h3 className="text-xs font-semibold">
                Finished, no technician
                <span className="ml-1 font-normal text-muted-foreground">{p.finishedTotal}</span>
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Waiting on the office: authorize, invoice or close. Tap one for its details.
              </p>
              {p.finished.length === 0 ? (
                <p className="py-1 text-xs text-muted-foreground">No finished tickets match.</p>
              ) : (
                p.finished.map((j) => (
                  <PhoneChip
                    key={j.id}
                    job={j}
                    rail
                    since
                    drag={false}
                    lifted={false}
                    bind={bind}
                    onOpen={setPeekId}
                  />
                ))
              )}
            </section>
          )}
        </div>
      </section>

      {/* The lifted ticket, under the finger. Shown and moved by the drag itself. */}
      <div
        ref={ghost}
        aria-hidden
        data-board-ghost
        className="pointer-events-none fixed left-0 top-0 z-50 hidden"
      >
        <div className="max-w-[70vw] -translate-x-1/2 -translate-y-[140%] truncate rounded-md border bg-card px-3 py-2 text-sm font-semibold shadow-xl ring-2 ring-primary">
          {dragged ? `#${dragged.number} ${dragged.customer_name}` : ""}
        </div>
      </div>

      {peek && (
        <TicketPeek
          job={peek}
          week={p.days[0]!}
          days={p.days}
          today={p.today}
          dispatch={p.dispatch}
          techRows={p.techRows}
          onMove={p.onMove}
          onClose={() => setPeekId(null)}
        />
      )}
    </div>
  );
}

/** What the tray says under a ticket: what is still missing. */
function railLine(j: Job, since: boolean): string {
  const stage = STAGE_LABELS[asStage(j.stage)];
  if (since) return `${stage} · since ${monthDay(inStageSince(j))} · no technician`;
  if (j.technician_id) return `${stage} · ${j.technician_name ?? "Assigned"} · no day`;
  if (j.scheduled_date) return `${stage} · ${dayShort(j.scheduled_date)} · no technician`;
  return `${stage} · opened ${monthDay(j.created_at)}`;
}

/** One ticket: a button a thumb can hit. A tap opens its details; a hold lifts it. */
function PhoneChip(props: {
  job: Job;
  /** In the tray: also says what is missing. */
  rail?: boolean;
  /** The Finished group: says since when. */
  since?: boolean;
  /** The folded tray's side-by-side cards. */
  compact?: boolean;
  /** On a day card: whose ticket it is. */
  who?: string;
  /** May this viewer move it (a manager or the office)? */
  drag: boolean;
  lifted: boolean;
  bind: (id: string) => { onTouchStart: React.TouchEventHandler<HTMLElement> };
  onOpen: (id: string) => void;
}) {
  const j = props.job;
  const stage = asStage(j.stage);
  const canDrag = props.drag && movableOnBoard(j);
  const toneKey = ticketToneKey({ stage, field_status: j.field_status });
  const mark = stageMark(stage);
  const badge = chipBadge(j);
  const place = chipPlace(j);
  const facts = chipFacts(j, { rate: false });
  const description = chipDescription(j);
  return (
    <button
      type="button"
      data-chip={j.id}
      data-movable={canDrag ? "1" : undefined}
      aria-label={`Ticket #${j.number} ${j.customer_name}, ${STAGE_LABELS[stage]}. ${
        canDrag ? "Tap for details, hold to move." : "Tap for details."
      }`}
      onClick={() => props.onOpen(j.id)}
      onContextMenu={(e) => e.preventDefault()}
      {...(canDrag ? props.bind(j.id) : {})}
      className={`flex min-h-[52px] touch-manipulation select-none items-stretch gap-1 rounded-md border px-2 py-1.5 text-left text-sm leading-snug shadow-sm transition-opacity [-webkit-touch-callout:none] ${
        STAGE_TONES[toneKey].chip
      } ${badge ? RATE_TONES[badge.kind].stripe : ""} ${props.compact ? "w-60 shrink-0" : "w-full"} ${
        props.lifted ? "opacity-40" : ""
      }`}
    >
      <span className="min-w-0 flex-1">
        {badge && (
          <span className="mb-0.5 block">
            <RateBadge kind={badge.kind} />
          </span>
        )}
        <span className={props.compact ? "block truncate" : "line-clamp-2"}>
          {mark === "check" && (
            <Check className="mr-0.5 inline h-4 w-4 align-[-3px]" aria-label="Done" />
          )}
          {mark === "double-check" && (
            <CheckCheck className="mr-0.5 inline h-4 w-4 align-[-3px]" aria-label="Authorized" />
          )}
          <span className="font-semibold">#{j.number}</span> {j.customer_name}
        </span>
        {props.who && (
          <span className="flex items-center gap-1 text-xs font-semibold" data-chip-who>
            <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{props.who}</span>
          </span>
        )}
        {place && <span className="block truncate text-xs opacity-80">{place}</span>}
        {facts.length > 0 && (
          <span className="block truncate text-xs font-medium">{facts.join(" · ")}</span>
        )}
        {description && !props.compact && (
          <span className="line-clamp-2 text-xs opacity-80">{description}</span>
        )}
        {props.rail && (
          <span className="block truncate text-xs opacity-80">{railLine(j, !!props.since)}</span>
        )}
      </span>
      {canDrag && <GripVertical className="h-5 w-5 shrink-0 self-center opacity-50" aria-hidden />}
    </button>
  );
}

/** The details pop-up: what the ticket is, and the four things to do with it. */
function TicketPeek(props: {
  job: Job;
  /** The week on the board (its Monday): the ticket's Back returns here. */
  week: string;
  days: string[];
  today: string;
  dispatch: boolean;
  techRows: Row[];
  onMove: (job: Job, plan: MovePlan) => void;
  onClose: () => void;
}) {
  const j = props.job;
  const stage = asStage(j.stage);
  const toneKey = ticketToneKey({ stage, field_status: j.field_status });
  const badge = chipBadge(j);
  const facts = chipFacts(j, { rate: false });
  const arrival = arrivalLabel(j.arrival_window);
  const description = chipDescription(j);
  const lines = peekAddressLines(j);
  const mapQuery = peekMapQuery(j);
  const day = boardDay(j);
  const canMove = props.dispatch && movableOnBoard(j);

  const peekFn = useServerFn(getBoardPeek);
  const more = useQuery({
    // Under the ticket's own key, so a save to the ticket refreshes it.
    queryKey: ["service-job", j.id, "board-peek"],
    queryFn: () => peekFn({ data: { id: j.id } }),
    staleTime: 60_000,
  });
  const phone = more.data ? peekPhone(more.data) : null;

  const [moving, setMoving] = useState(false);
  const [tech, setTech] = useState(j.technician_id ?? "");
  const [date, setDate] = useState(j.scheduled_date ?? "");
  const changed = tech !== (j.technician_id ?? "") || date !== (j.scheduled_date ?? "");
  const techOptions = [...props.techRows];
  if (j.technician_id && !techOptions.some((t) => t.id === j.technician_id))
    techOptions.push({ id: j.technician_id, name: j.technician_name ?? "Former assignee" });

  return (
    <Sheet open onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent
        side="bottom"
        data-board-peek={j.id}
        className="max-h-[88dvh] space-y-3 overflow-y-auto rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&>button:first-child]:right-2 [&>button:first-child]:top-2 [&>button:first-child]:flex [&>button:first-child]:h-[44px] [&>button:first-child]:w-[44px] [&>button:first-child]:items-center [&>button:first-child]:justify-center [&>button:first-child>svg]:h-5 [&>button:first-child>svg]:w-5"
      >
        <SheetTitle className="pr-8 text-left text-lg leading-snug">
          #{j.number} · {j.customer_name}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Ticket details. Open ticket shows the whole ticket.
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-2 text-xs" data-peek="facts">
          <span
            className={`rounded-md border px-2 py-0.5 font-semibold ${STAGE_TONES[toneKey].chip}`}
          >
            {toneKey === "en_route" || toneKey === "on_site"
              ? FIELD_TONE_LABELS[toneKey]
              : STAGE_LABELS[stage]}
          </span>
          {badge && <RateBadge kind={badge.kind} />}
          {facts.length > 0 && <span className="font-medium">{facts.join(" · ")}</span>}
        </div>

        {(j.site_name || lines.length > 0) && (
          <div className="flex items-start gap-2 text-sm" data-peek="place">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              {j.site_name && <p className="font-medium">{j.site_name}</p>}
              {lines.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-start gap-2 text-sm" data-peek="who">
          <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <p>
            <span className="font-medium">{j.technician_name ?? "Nobody assigned"}</span>
            {" · "}
            {day ? dayShort(day) : "no day"}
            {arrival && !facts.includes(arrival) ? ` · ${arrival}` : ""}
          </p>
        </div>

        {description && (
          <p className="whitespace-pre-line text-sm" data-peek="description">
            {description}
          </p>
        )}

        {more.isLoading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the special instructions and
            contact…
          </p>
        ) : more.error ? (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            Could not load the special instructions and contact ({plainErrText(more.error)}). Open
            the ticket to see them.
          </p>
        ) : (
          <>
            {more.data?.notes && (
              <p
                className="whitespace-pre-line rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50"
                data-peek="instructions"
              >
                <span className="font-semibold">Special instructions: </span>
                {more.data.notes}
              </p>
            )}
            {(more.data?.contact_name || phone) && (
              <p className="flex items-center gap-2 text-sm" data-peek="contact">
                <Phone className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  {more.data?.contact_name && (
                    <span className="font-medium">{more.data.contact_name}</span>
                  )}
                  {more.data?.contact_name && phone ? " · " : ""}
                  {phone}
                </span>
              </p>
            )}
          </>
        )}

        {moving ? (
          <div className="space-y-3 rounded-lg border p-3" data-peek="move">
            <div className="space-y-1">
              <Label htmlFor="peek-tech">Technician</Label>
              <select
                id="peek-tech"
                value={tech}
                onChange={(e) => setTech(e.target.value)}
                className="h-[46px] w-full rounded-md border bg-background px-3 text-[16px]"
              >
                <option value="">Nobody (unassigned)</option>
                {techOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="peek-date">Day</Label>
              <Input
                id="peek-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-[46px] text-[16px]"
              />
              <div className="grid grid-cols-7 gap-1" aria-label="This week">
                {props.days.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    data-peek-day={d}
                    aria-pressed={date === d}
                    onClick={() => setDate(d)}
                    className={`flex min-h-[44px] flex-col items-center justify-center rounded-md border text-[11px] leading-tight ${
                      date === d
                        ? "border-primary bg-primary text-primary-foreground"
                        : d === props.today
                          ? "border-primary/60 bg-primary/10"
                          : "bg-card"
                    }`}
                  >
                    <span>{DAY_NAMES[i]}</span>
                    <span className="text-sm font-semibold">{dayNumber(d)}</span>
                  </button>
                ))}
              </div>
              {!date && <p className="text-xs text-muted-foreground">Pick a day to save.</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                className={PEEK_BUTTON}
                data-peek="save-move"
                disabled={!changed || !date}
                onClick={() => {
                  props.onMove(j, { technician_id: tech || null, scheduled_date: date || null });
                  props.onClose();
                }}
              >
                Save move
              </Button>
              <Button variant="outline" className={PEEK_BUTTON} onClick={() => setMoving(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2" data-peek="actions">
            <Button asChild className={PEEK_BUTTON}>
              <Link to="/service" search={{ id: j.id, from: "board", week: props.week }}>
                <SquareArrowOutUpRight className="mr-1 h-4 w-4" /> Open ticket
              </Link>
            </Button>
            {canMove && (
              <Button
                variant="outline"
                className={PEEK_BUTTON}
                data-peek="move-button"
                onClick={() => setMoving(true)}
              >
                <ArrowRightLeft className="mr-1 h-4 w-4" /> Move
              </Button>
            )}
            {phone && (
              <Button asChild variant="outline" className={PEEK_BUTTON}>
                <a href={`tel:${phone}`} data-peek="call">
                  <Phone className="mr-1 h-4 w-4" /> Call
                </a>
              </Button>
            )}
            {mapQuery && (
              <Button asChild variant="outline" className={PEEK_BUTTON}>
                <a href={mapsUrl(mapQuery)} target="_blank" rel="noreferrer" data-peek="directions">
                  <MapPin className="mr-1 h-4 w-4" /> Directions
                </a>
              </Button>
            )}
          </div>
        )}
        {props.dispatch && !canMove && !moving && (
          <p className="text-xs text-muted-foreground">
            A ticket that is Done or later stays where it is on the board.
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
