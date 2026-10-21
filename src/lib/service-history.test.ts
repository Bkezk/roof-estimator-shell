/**
 * History at this property (owner, Oct 21; approved as proposed, with one change: every photo,
 * not three). A technician working a ticket sees what happened here before with no extra taps —
 * the one-line strip under the property on the ticket page and on My tickets — and the fold on
 * the ticket page lists every earlier ticket at the same property with its repairs, closing
 * notes, inspection outcome and ALL its photos (with their mark-ups), newest first, the same
 * named spot first. The data comes through the SECURITY DEFINER site_history functions
 * (20261021110000_site_history.sql, pinned by site-history-fence.test.ts); the server function
 * signs the photo paths. The pure helpers here are tested on their own.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  FIRST_TICKET,
  GIST_MAX,
  HISTORY_OPEN_PARAM,
  dayText,
  gist,
  historyFoldSummary,
  historyFoldTitle,
  historyStrip,
  historyWhen,
  isSameSpot,
  itemHistoryText,
  lastTimeForItem,
  lastTimeText,
  orderHistory,
  type SiteHistorySummary,
  type SiteHistoryTicket,
} from "@/lib/service-history";
import { siteHistory, siteHistorySummary } from "@/lib/service-history.functions";
import { parseServiceSearch } from "@/lib/service-search";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const TODAY = new Date(2026, 9, 21, 12);
const JOB = "11111111-1111-4111-8111-111111111111";
const TECH = "00000000-0000-4000-8000-00000000000a";

const summary = (over: Partial<SiteHistorySummary> = {}): SiteHistorySummary => ({
  count: 3,
  photo_count: 7,
  last: {
    id: "t1",
    number: 6012,
    completed_at: "2026-06-12T15:00:00.000Z",
    scheduled_date: "2026-06-11",
    created_at: "2026-06-01T12:00:00.000Z",
    description: "Leak at HVAC curb",
    resolution: "Patched the curb seam\nand checked the drain",
  },
  ...over,
});

const ticket = (over: Partial<SiteHistoryTicket> & { id: string }): SiteHistoryTicket => ({
  number: 6000,
  service_type: "leak",
  description: null,
  scheduled_date: null,
  completed_at: null,
  created_at: "2026-01-01T12:00:00.000Z",
  stage: "closed",
  location_id: null,
  location_name: null,
  closing_notes: null,
  inspection_outcome: null,
  technician_name: null,
  inspection_items: [],
  repairs: [],
  photos: [],
  ...over,
});

describe("the strip wording", () => {
  it("count, last day and gist, photos — plural", () => {
    expect(historyStrip(summary(), TODAY)).toBe(
      "History here: 3 earlier tickets, last Jun 12 (Leak at HVAC curb, Patched the curb seam). 7 photos.",
    );
  });
  it("singular, and the year when it is not this one", () => {
    const s = summary({
      count: 1,
      photo_count: 1,
      last: { ...summary().last!, completed_at: "2025-06-12T15:00:00.000Z" },
    });
    expect(historyStrip(s, TODAY)).toBe(
      "History here: 1 earlier ticket, last Jun 12, 2025 (Leak at HVAC curb, Patched the curb seam). 1 photo.",
    );
  });
  it("no photos: no photo sentence; nothing written: no parentheses", () => {
    const s = summary({
      count: 2,
      photo_count: 0,
      last: { ...summary().last!, description: null, resolution: "  " },
    });
    expect(historyStrip(s, TODAY)).toBe("History here: 2 earlier tickets, last Jun 12.");
  });
  it("none: First ticket at this property.", () => {
    expect(historyStrip({ count: 0, photo_count: 0, last: null }, TODAY)).toBe(FIRST_TICKET);
    expect(FIRST_TICKET).toBe("First ticket at this property.");
  });
  it("the fold's title and header summary", () => {
    expect(historyFoldTitle(null)).toBe("History at this property");
    expect(historyFoldTitle(3)).toBe("History at this property (3)");
    expect(historyFoldSummary(summary(), TODAY)).toBe(
      "last Jun 12 (Leak at HVAC curb, Patched the curb seam) · 7 photos",
    );
    expect(historyFoldSummary({ count: 0, photo_count: 0, last: null }, TODAY)).toBe("none yet");
  });
  it("the gist is the first non-blank line, cut with …", () => {
    expect(gist("\n\n  Patched the curb seam  \nmore")).toBe("Patched the curb seam");
    expect(gist(null)).toBe("");
    const long = gist("x".repeat(100));
    expect(long).toHaveLength(GIST_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("the date pick", () => {
  it("completed_at, else the scheduled day, else when it was opened", () => {
    expect(
      historyWhen({
        completed_at: "2026-06-12T15:00:00.000Z",
        scheduled_date: "2026-06-11",
        created_at: "2026-06-01T12:00:00.000Z",
      })?.toISOString(),
    ).toBe("2026-06-12T15:00:00.000Z");
    const sched = historyWhen({
      completed_at: null,
      scheduled_date: "2026-06-11",
      created_at: "2026-06-01T12:00:00.000Z",
    });
    expect([sched?.getFullYear(), sched?.getMonth(), sched?.getDate()]).toEqual([2026, 5, 11]);
    expect(
      historyWhen({
        completed_at: null,
        scheduled_date: null,
        created_at: "2026-06-01T12:00:00.000Z",
      })?.toISOString(),
    ).toBe("2026-06-01T12:00:00.000Z");
    expect(historyWhen({ completed_at: null, scheduled_date: null, created_at: null })).toBeNull();
  });
  it("dayText: month and day, the year only when it differs", () => {
    expect(dayText(new Date(2026, 5, 12), TODAY)).toBe("Jun 12");
    expect(dayText(new Date(2025, 5, 12), TODAY)).toBe("Jun 12, 2025");
  });
});

describe("same spot first, then newest first", () => {
  const A = ticket({ id: "A", location_id: "X", completed_at: "2026-06-12T15:00:00.000Z" });
  const B = ticket({ id: "B", location_id: "Y", completed_at: "2026-09-01T15:00:00.000Z" });
  const C = ticket({ id: "C", location_id: "X", scheduled_date: "2026-03-05" });
  const D = ticket({ id: "D", location_id: null, created_at: "2026-08-01T12:00:00.000Z" });
  it("with the ticket's named spot: that spot's tickets lead, each group newest first", () => {
    expect(orderHistory([C, D, A, B], "X").map((t) => t.id)).toEqual(["A", "C", "B", "D"]);
    expect(isSameSpot(A, "X")).toBe(true);
    expect(isSameSpot(D, "X")).toBe(false);
  });
  it("without one: newest first, no tag", () => {
    expect(orderHistory([C, D, A, B], null).map((t) => t.id)).toEqual(["B", "D", "A", "C"]);
    expect(isSameSpot(A, null)).toBe(false);
  });
});

describe("the inspection item match", () => {
  const photo = (id: string, item_key: string | null, repair_id: string | null = null) => ({
    id,
    storage_path: `j/${id}.jpg`,
    file_name: null,
    role: "other",
    repair_id,
    item_key,
    taken_at: null,
    created_at: "2026-06-12T15:00:00.000Z",
    annotations: null,
    url: null,
  });
  const newer = ticket({
    id: "N",
    completed_at: "2026-09-01T15:00:00.000Z",
    photos: [photo("p9", "k2")],
  });
  const older = ticket({
    id: "O",
    completed_at: "2026-06-12T15:00:00.000Z",
    inspection_items: [{ id: "k1", label: "HVAC curb", status: "issue", note: "cracked sealant" }],
    repairs: [
      {
        id: "r1",
        name: "Reseal curb",
        problem_text: "Cracked",
        resolution_text: "Resealed the curb",
        completed_on: "2026-06-12",
      },
    ],
    closing_notes: "All good now",
    photos: [photo("p1", "k1"), photo("p2", null), photo("p3", "k1"), photo("p4", "k1", "r1")],
  });
  it("the newest earlier ticket with a photo for that item, with every such photo", () => {
    const hit = lastTimeForItem([newer, older], "k1");
    expect(hit?.ticket.id).toBe("O");
    // A repair's photo is the repair's, not the checklist item's (as the close-out files them).
    expect(hit?.photos.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(lastTimeForItem([newer, older], "k2")?.ticket.id).toBe("N");
    expect(lastTimeForItem([newer, older], "k3")).toBeNull();
  });
  it("the line: the item's answer that day, else a repair, else the closing notes", () => {
    expect(itemHistoryText(older, "k1")).toBe("Issue: cracked sealant");
    expect(itemHistoryText({ ...older, inspection_items: [] }, "k1")).toBe(
      "Reseal curb — Resealed the curb",
    );
    expect(itemHistoryText({ ...older, inspection_items: [], repairs: [] }, "k1")).toBe(
      "All good now",
    );
    expect(
      itemHistoryText({ ...older, inspection_items: [], repairs: [], closing_notes: null }, "k1"),
    ).toBe("");
    expect(lastTimeText(historyWhen(older), "Issue: cracked sealant", TODAY)).toBe(
      "Last time: Jun 12 — Issue: cracked sealant",
    );
    expect(lastTimeText(historyWhen(older), "", TODAY)).toBe("Last time: Jun 12");
    expect(lastTimeText(null, "x", TODAY)).toBe("Last time — x");
  });
});

describe("the server functions", () => {
  const call = <T>(fn: unknown, data: unknown, db: unknown) =>
    (fn as Fn)({ data, context: { supabase: db, userId: TECH } }) as Promise<T>;
  const rows: Row[] = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      number: 6012,
      service_type: "leak",
      description: "Leak at HVAC curb",
      scheduled_date: "2026-06-11",
      completed_at: "2026-06-12T15:00:00+00:00",
      created_at: "2026-06-01T12:00:00+00:00",
      stage: "closed",
      location_id: null,
      location_name: null,
      closing_notes: "Patched",
      inspection_outcome: null,
      technician_name: "Tim",
      inspection_items: [],
      repairs: [
        {
          id: "r1",
          name: "Reseal curb",
          problem_text: "Cracked",
          resolution_text: "Resealed",
          completed_on: "2026-06-12",
        },
      ],
      photos: [
        {
          id: "p1",
          storage_path: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1.jpg",
          file_name: "1.jpg",
          role: "before",
          repair_id: "r1",
          item_key: null,
          taken_at: null,
          created_at: "2026-06-12T15:00:00+00:00",
          annotations: null,
        },
        {
          id: "p2",
          storage_path: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2.jpg",
          file_name: null,
          role: "after",
          repair_id: "r1",
          item_key: null,
          taken_at: "2026-06-12T16:00:00+00:00",
          created_at: "2026-06-12T16:00:00+00:00",
          annotations: { v: 1, kind: "photo", marks: [] },
        },
      ],
    },
  ];
  function world(opts: { refuse?: boolean; signFails?: boolean } = {}) {
    const signed: string[][] = [];
    const env = fakeSupabase(
      {},
      {
        rpc: (fn) => {
          if (opts.refuse && (fn === "site_history" || fn === "site_history_summary"))
            return {
              data: null,
              error: {
                code: "42501",
                message: "You can see the history of a property only from a ticket assigned to you",
              },
            };
          return undefined;
        },
        rpcs: {
          site_history: () => rows,
          site_history_summary: () => ({
            count: 1,
            photo_count: 2,
            last: {
              id: rows[0]!["id"],
              number: 6012,
              completed_at: "2026-06-12T15:00:00+00:00",
              scheduled_date: "2026-06-11",
              created_at: "2026-06-01T12:00:00+00:00",
              description: "Leak at HVAC curb",
              resolution: "Resealed",
            },
          }),
        },
      },
    );
    const db = {
      ...(env.db as object),
      storage: {
        from: (bucket: string) => ({
          createSignedUrls: async (paths: string[]) => {
            signed.push(paths);
            if (opts.signFails) return { data: null, error: { message: "storage down" } };
            return {
              data: paths.map((p) => ({
                path: p,
                signedUrl: `https://s/${bucket}/${p}`,
                error: null,
              })),
              error: null,
            };
          },
        }),
      },
    };
    return { env, db, signed };
  }
  it("siteHistory: the rpc by ticket id, then every photo path signed once, in one call", async () => {
    const { env, db, signed } = world();
    const out = await call<SiteHistoryTicket[]>(siteHistory, { id: JOB }, db);
    expect(env.rpcCalls).toEqual([{ fn: "site_history", args: { p_job_id: JOB } }]);
    expect(signed).toEqual([
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1.jpg", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2.jpg"],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.photos.map((p) => p.url)).toEqual([
      "https://s/service/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1.jpg",
      "https://s/service/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2.jpg",
    ]);
    expect(out[0]!.repairs[0]!.resolution_text).toBe("Resealed");
    expect(out[0]!.technician_name).toBe("Tim");
  });
  it("signing failing leaves url null (the thumbnail asks the browser's own link); nothing else lost", async () => {
    const { db } = world({ signFails: true });
    const out = await call<SiteHistoryTicket[]>(siteHistory, { id: JOB }, db);
    expect(out[0]!.photos.map((p) => p.url)).toEqual([null, null]);
    expect(out[0]!.photos.map((p) => p.storage_path)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1.jpg",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2.jpg",
    ]);
  });
  it("the database's refusal reaches the screen in its own words (42501)", async () => {
    const { db, signed } = world({ refuse: true });
    await expect(call(siteHistory, { id: JOB }, db)).rejects.toThrow(
      "You can see the history of a property only from a ticket assigned to you",
    );
    await expect(call(siteHistorySummary, { id: JOB }, db)).rejects.toThrow(
      "You can see the history of a property only from a ticket assigned to you",
    );
    expect(signed).toEqual([]);
  });
  it("siteHistorySummary: one rpc, the strip's shape", async () => {
    const { env, db } = world();
    const s = await call<SiteHistorySummary>(siteHistorySummary, { id: JOB }, db);
    expect(env.rpcCalls).toEqual([{ fn: "site_history_summary", args: { p_job_id: JOB } }]);
    expect(s.count).toBe(1);
    expect(s.photo_count).toBe(2);
    expect(historyStrip(s, TODAY)).toBe(
      "History here: 1 earlier ticket, last Jun 12 (Leak at HVAC curb, Resealed). 2 photos.",
    );
  });
  it("a bad id is refused before any read", () => {
    const { env, db } = world();
    // The validator runs before the handler (the fake throws it straight back).
    expect(() => call(siteHistory, { id: "nope" }, db)).toThrow(/uuid/i);
    expect(env.rpcCalls).toEqual([]);
  });
  it("the functions carry no money and no customer contact: the parsed shape is only what the fold shows", () => {
    const src = read("src/lib/service-history.ts");
    expect(src).not.toMatch(/\b(price|unit_price|rate|invoice|total|amount|phone|mobile)\b/i);
  });
});

describe("?open=history", () => {
  it("is kept with a ticket id and dropped elsewhere", () => {
    expect(HISTORY_OPEN_PARAM).toBe("history");
    expect(parseServiceSearch({ id: JOB, open: "history" })).toEqual({ id: JOB, open: "history" });
    expect(parseServiceSearch({ id: JOB, open: "other" })).toEqual({ id: JOB });
    expect(parseServiceSearch({ open: "history" })).toEqual({});
    expect(parseServiceSearch({ new: 1, open: "history" })).toEqual({ new: 1 });
  });
});

describe("on the screens", () => {
  const page = read("src/components/service-page.tsx");
  const today = read("src/components/service/today-page.tsx");
  const comp = read("src/components/service/site-history.tsx");
  it("the ticket page: the strip under the property, opening the fold; ?open=history opens it on arrival", () => {
    expect(page).toContain("<HistoryStrip jobId={job.id} onOpen={openHistory} />");
    expect(page).toContain("useState(prefill.open === HISTORY_OPEN_PARAM)");
    // The fold in both layouts (the office's two panes and the technician's one column).
    expect(
      (
        page.match(
          /<HistoryFold job=\{job\} open=\{historyOpen\} onOpenChange=\{setHistoryOpen\} \/>/g,
        ) ?? []
      ).length,
    ).toBe(2);
    // The old "Earlier at this property" fold and its read are gone: one history, one function.
    expect(read("src/components/service/ticket-field-sections.tsx")).not.toContain("EarlierAtSite");
    expect(read("src/lib/service-field.functions.ts")).not.toContain("listSiteHistory");
  });
  it("the fold starts closed and asks for the history only when opened", () => {
    expect(comp).toMatch(
      /<Box[\s\S]*?collapsible[\s\S]*?open=\{open\}[\s\S]*?defaultOpen=\{false\}/,
    );
    expect(comp).toMatch(/useHistory\(job\.id, open\)/);
  });
  it("ALL photos: the grid maps the whole list, nothing sliced or capped", () => {
    expect(comp).toContain("{photos.map((p, i) => (");
    // ("> 0" only asks whether there are any; a cap would be "> 3" or a slice.)
    expect(comp).not.toMatch(/photos\.slice\(|\.slice\(0, \d\)|photos\.length > [1-9]/);
  });
  it("My tickets: the strip under the address, a tap opens the ticket with the fold open; left out when none", () => {
    expect(today).toContain('{j.site_id && <HistoryLink jobId={j.id} whenNone="hide" />}');
    expect(comp).toContain("search={{ id: jobId, open: HISTORY_OPEN_PARAM }}");
    expect(comp).toContain('if (whenNone === "hide") return null;');
    // The close-out, where the technician works the ticket, carries the same line.
    expect(read("src/components/service/closeout.tsx")).toContain(
      '<HistoryLink jobId={job.id} whenNone="say" />',
    );
  });
  it("no Open link for a technician-only user — the row carries everything, nothing is said", () => {
    expect(comp).toContain("const canOpen = !isFieldOnly(profile);");
    expect(comp).toMatch(/\{canOpen && \(\s*<Link[\s\S]*?>\s*Open\s*<\/Link>\s*\)\}/);
    expect(comp).not.toMatch(/office fixes|the app\b/i);
  });
  it("the inspection step: Last time under an item, on the ticket page and the close-out", () => {
    const insp = read("src/components/service/inspection-section.tsx");
    expect(insp).toContain("{jobId && <LastTimeLine jobId={jobId} itemKey={item.id} />}");
    expect(insp).toMatch(/<ChecklistRows\s+items=\{draft\.items\}[\s\S]*?jobId=\{job\.id\}/);
    expect(read("src/components/service/inspection-closeout.tsx")).toMatch(
      /<ChecklistRows\s+items=\{draft\.items\}[\s\S]*?jobId=\{job\.id\}/,
    );
    expect(comp).toContain("lastTimeForItem(");
  });
  it("the viewer is the ticket's own, read-only, with arrows between that ticket's photos", () => {
    expect(comp).toMatch(/<PhotoLightbox[\s\S]*?canAnnotate=\{false\}[\s\S]*?nav=\{\{/);
    const viewer = read("src/components/service/photo-markup.tsx");
    expect(viewer).toContain('aria-label="Previous photo"');
    expect(viewer).toContain('aria-label="Next photo"');
    expect(viewer).toMatch(/e\.key === "ArrowLeft"/);
    expect(viewer).toMatch(/e\.key === "ArrowRight"/);
  });
});
