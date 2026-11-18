// @vitest-environment node
/**
 * The top of the ticket workflow, kept short (owner, Nov 18, with a picture of it: "this is a
 * bit busy any way to make it cleaner? especially if there is a lot of special instructions or
 * activities?"). He chose "Short, tap for more": the instructions stay in view and stop at three
 * lines with Show all; the history and this ticket's activity are one row each.
 *
 *  rules    lib/service-history.ts historyShort, lib/tech-visible.ts activityPeek.
 *  screens  service/clamped-text.tsx (ClampedText, PeekRow), the close-out's header.
 */
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { History } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({
    session: { user: { id: "t1" } },
    profile: { id: "t1", role: "user", access: ["service"], technician: true },
  }),
}));

import type { ContactLogRow } from "@/lib/contact-log.functions";
import { historyNoteLabel, historyShort, historyStrip } from "@/lib/service-history";
import { activityPeek, THIS_TICKET_ACTIVITY_ROW } from "@/lib/tech-visible";
import { ClampedText, PeekRow, SHOW_ALL, SHOW_LESS } from "./clamped-text";
import { SpecialInstructionsBox } from "./special-instructions";
import { TicketSharedNotes } from "./ticket-shared-notes";

const JOB = "11111111-1111-4111-8111-111111111111";
const TODAY = new Date("2026-11-18T15:00:00Z");
const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const last = {
  id: "j1",
  number: 6072,
  completed_at: null,
  scheduled_date: "2026-11-10",
  created_at: "2026-11-01T12:00:00+00:00",
  description: "From inspection #6072: Membrane condition, Seams",
  resolution: "Removed the failed repair and re-did it properly",
};

describe("the history row's words", () => {
  it("how many, when the last one was, how many photos; not what it was about", () => {
    const short = historyShort({ count: 2, photo_count: 1, last }, TODAY);
    expect(short).toBe("2 earlier tickets · last Nov 10 · 1 photo");
    expect(short).not.toContain("Membrane");
    // The card on My tickets keeps the whole sentence.
    expect(historyStrip({ count: 2, photo_count: 1, last }, TODAY)).toContain("Membrane");
  });
  it("one ticket, no photos, no last ticket", () => {
    expect(historyShort({ count: 1, photo_count: 0, last }, TODAY)).toBe(
      "1 earlier ticket · last Nov 10",
    );
    expect(historyShort({ count: 3, photo_count: 4, last: null }, TODAY)).toBe(
      "3 earlier tickets · 4 photos",
    );
  });
  it("is much shorter than the sentence it stands for", () => {
    const s = { count: 2, photo_count: 1, last };
    expect(historyShort(s, TODAY).length).toBeLessThan(historyStrip(s, TODAY).length / 2);
  });
});

describe("the activity row's words", () => {
  const n = (method: string, note: string | null, by_name: string | null) => ({
    method,
    note,
    by_name,
  });
  it("how many entries, then the newest: who and the first line of what", () => {
    expect(
      activityPeek(
        [
          n("comment", "gate code is 4471\nring twice", "Braden Keck"),
          n("called", "left a voicemail", "Mark Barger"),
          n("comment", "older", "Mark Barger"),
        ],
        historyNoteLabel,
      ),
    ).toBe("3 · Braden: gate code is 4471");
  });
  it("an entry with no words says what was done; one with no name says only the words", () => {
    expect(activityPeek([n("called", null, "Mark Barger")], historyNoteLabel)).toBe(
      "1 · Mark: Called",
    );
    expect(activityPeek([n("comment", "bring the tall ladder", null)], historyNoteLabel)).toBe(
      "1 · bring the tall ladder",
    );
  });
  it("nothing for no entries", () => {
    expect(activityPeek([], historyNoteLabel)).toBe("");
  });
});

describe("a text that stops at a number of lines", () => {
  it("is cut to its lines, with no button until the page finds it is longer", () => {
    const html = renderToString(
      <ClampedText name="instructions" lines={3} text={"one\ntwo\nthree\nfour"} className="x" />,
    );
    expect(html).toContain("line-clamp-3");
    expect(html).toContain('data-clamp="instructions"');
    expect(html).toContain('data-clamp-state="whole"');
    expect(html).not.toContain("<button");
    expect(html).toContain("one\ntwo\nthree\nfour");
  });
  it("two lines for the description", () => {
    expect(renderToString(<ClampedText name="description" lines={2} text="a" />)).toContain(
      "line-clamp-2",
    );
  });
  it("the button opens the rest in place and closes it again", () => {
    const src = flat(read("src/components/service/clamped-text.tsx"));
    expect(SHOW_ALL).toBe("Show all");
    expect(SHOW_LESS).toBe("Show less");
    expect(src).toContain("setLong(el.scrollHeight > el.clientHeight + 1)");
    expect(src).toContain("{(long || open) && (");
    expect(src).toContain("aria-expanded={open}");
    expect(src).toContain("onClick={() => setOpen((o) => !o)}");
    expect(src).toContain("{open ? SHOW_LESS : SHOW_ALL}");
    expect(src).toContain('className={`${className} ${open ? "" : CLAMP[lines]}`}');
    // Big enough for a thumb.
    expect(src).toContain("min-h-9");
  });
  it("the instructions box is whole unless asked to stop: the card and the history show all", () => {
    const whole = renderToString(<SpecialInstructionsBox where="card" text={"a\nb\nc\nd"} />);
    expect(whole).not.toContain("line-clamp");
    const cut = renderToString(
      <SpecialInstructionsBox where="closeout" text={"a\nb\nc\nd"} clampLines={3} />,
    );
    expect(cut).toContain("line-clamp-3");
    expect(cut).toContain('data-special-instructions="closeout"');
  });
});

describe("a row that opens something", () => {
  it("is one button a thumb can hit, with its words cut by an ellipsis when narrow", () => {
    const html = renderToString(
      <PeekRow
        name="history"
        icon={History}
        label="History"
        detail="2 earlier tickets · last Nov 10 · 1 photo"
        popup
        onClick={() => {}}
      />,
    );
    expect(html).toContain('data-peek-row="history"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("truncate");
    expect(html).toContain("History");
    expect(html).toContain("2 earlier tickets · last Nov 10 · 1 photo");
    expect(html).not.toContain("aria-expanded");
  });
  it("a row that opens in place says whether it is open", () => {
    const row = (expanded: boolean) =>
      renderToString(
        <PeekRow
          name="activity"
          icon={History}
          label="Activity"
          detail="1 · x"
          expanded={expanded}
          onClick={() => {}}
        />,
      );
    expect(row(false)).toContain('aria-expanded="false"');
    expect(row(true)).toContain('aria-expanded="true"');
  });
});

const entry = (id: number, note: string): ContactLogRow => ({
  id,
  kind: "ticket",
  item_id: JOB,
  method: "comment",
  note,
  by_user: "u2",
  by_name: "Braden Keck",
  at: `2026-11-${String(10 + id).padStart(2, "0")}T14:00:00+00:00`,
  tech_visible: true,
});
function render(node: React.ReactElement, rows: ContactLogRow[]) {
  const qc = new QueryClient();
  qc.setQueryData(["contact-log", "ticket", JOB], rows);
  return renderToString(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("this ticket's activity at the top of the workflow", () => {
  it("is one row, the count and the newest entry, with the list closed", () => {
    const html = render(<TicketSharedNotes jobId={JOB} where="closeout" compact />, [
      entry(1, "ate a turkey sandwich"),
      entry(2, "gate code is 4471"),
    ]);
    expect(THIS_TICKET_ACTIVITY_ROW).toBe("Activity");
    expect(html).toContain('data-peek-row="activity"');
    expect(html).toContain("2 · Braden: gate code is 4471");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-history="this-ticket-notes"');
    expect(html).not.toContain("ate a turkey sandwich");
  });
  it("nothing at all when the ticket has no ticked entry", () => {
    expect(render(<TicketSharedNotes jobId={JOB} where="closeout" compact />, [])).toBe("");
  });
  it("a short list is given no scroll bar; a long one scrolls inside its own box", () => {
    // The owner's picture showed scroll arrows beside a single entry.
    const few = render(<TicketSharedNotes jobId={JOB} where="history" />, [entry(1, "a")]);
    expect(few).toContain('data-history="this-ticket-notes"');
    expect(few).not.toContain("overflow-y-auto");
    const many = render(
      <TicketSharedNotes jobId={JOB} where="history" />,
      [1, 2, 3, 4, 5, 6, 7].map((i) => entry(i, `note ${i}`)),
    );
    expect(many).toContain("overflow-y-auto");
  });
});

describe("the close-out's header", () => {
  const src = flat(read("src/components/service/closeout.tsx"));
  const head = src.slice(
    src.indexOf("export function CloseoutScreen("),
    src.indexOf("<CloseoutForm key={job.id} job={job} />"),
  );
  it("top to bottom: description, instructions, then the two rows", () => {
    const order = [
      '<ClampedText name="description" lines={2} text={job.description} className="text-sm" />',
      '<SpecialInstructionsBox where="closeout"',
      '<HistoryLink jobId={job.id} whenNone="say" compact />',
      '<TicketSharedNotes jobId={job.id} where="closeout" compact />',
    ].map((s) => head.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("the instructions stop at three lines there", () => {
    expect(head).toContain("clampLines={3}");
  });
  it("on a phone the step bar's words and chevron take the line above the dots", () => {
    // Seven 44 px dots fill a phone's row. The words were squeezed to one letter, "S", and the
    // chevron dropped to a line of its own.
    const strip = src.slice(src.indexOf("function StepStrip({"), src.indexOf("{listOpen && ("));
    expect(strip).toContain(
      '<p className="order-1 min-w-0 flex-1 truncate text-sm font-semibold">',
    );
    expect(strip).toContain(
      'className="order-3 flex w-full items-center sm:order-2 sm:w-auto sm:gap-1"',
    );
    expect(strip).toMatch(/className="order-2 flex h-\[44px\] w-\[44px\][^"]* sm:order-3"/);
    // The dots share a narrow row instead of running off its edge.
    expect(strip).toContain(
      '<li key={step.id} className="flex min-w-0 flex-1 justify-center sm:flex-none">',
    );
    expect(strip).toContain("h-[44px] w-[44px] max-w-full");
  });
  it("the history row is the short one; the My tickets card keeps its sentence", () => {
    const history = flat(read("src/components/service/site-history.tsx"));
    expect(history).toContain("detail={historyShort(data)}");
    expect(history).toContain("<span>{historyStrip(data)}</span>");
    expect(read("src/components/service/today-page.tsx")).toContain(
      '<HistoryLink jobId={j.id} whenNone="hide" summary={j.history} />',
    );
  });
});
