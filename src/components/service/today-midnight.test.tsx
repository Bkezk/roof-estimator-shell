/**
 * My tickets rendered to a string (react-dom/server) with the day and the clock seeded in the
 * query cache: the Today / Coming up / No date yet split follows the PHONE's calendar day
 * (field-utils.ts localYmd — here America/Chicago), flipping at its midnight, not UTC's or
 * Eastern's. Oct 28 audit: the 30-second clock tick moved from the page into the banner, so the
 * cards never re-render for it — pinned by rendering the same day at two instants: the banner's
 * minutes differ, the cards are byte-for-byte the same.
 */
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import React from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string | number>;
    className?: string;
  }) =>
    React.createElement(
      "a",
      {
        href: `${to}${search ? `?${new URLSearchParams(search as Record<string, string>).toString()}` : ""}`,
        className,
      },
      children,
    ),
  useNavigate: () => () => {},
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({
    session: { user: { id: "t1" } },
    profile: {
      id: "t1",
      role: "user",
      access: ["service"],
      technician: true,
      full_name: "Tech One",
      email: "t@x",
    },
  }),
}));
vi.mock("@/components/service/site-history", () => ({ HistoryLink: () => null }));
vi.mock("@/components/crm/site-warranties", () => ({ WarrantyBadgeList: () => null }));
vi.mock("@/components/service/crew-box", () => ({ CrewBox: () => null }));

import { fieldKeys } from "@/components/service/field-utils";
import { TodayPage } from "@/components/service/today-page";

const read = (p: string) => readFileSync(p, "utf8");

const job = (
  id: string,
  number: number,
  scheduled_date: string | null,
  extra: Record<string, unknown> = {},
) => ({
  id,
  number,
  customer_name: `Cust ${number}`,
  scheduled_date,
  field_status: null,
  site_id: null,
  site_name: null,
  site_address: null,
  description: null,
  contact_id: null,
  account_id: null,
  helper_count: 0,
  crew_confirmed_at: null,
  arrival_window: null,
  technician_instructions: null,
  contact_name: null,
  contact_phone: null,
  account_phone: null,
  crew_names: [],
  warranty_badges: [],
  stage: "scheduled",
  ...extra,
});

const savedTz = process.env["TZ"];
beforeAll(() => {
  process.env["TZ"] = "America/Chicago";
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterAll(() => {
  vi.useRealTimers();
  if (savedTz === undefined) delete process.env["TZ"];
  else process.env["TZ"] = savedTz;
});

function render(jobs: unknown[], clock: unknown = null) {
  const qc = new QueryClient();
  qc.setQueryData(fieldKeys.today, jobs);
  qc.setQueryData(fieldKeys.clock, clock);
  return renderToString(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(TodayPage)),
  ).replace(/<!-- -->/g, "");
}
const section = (html: string, label: string) => {
  const i = html.indexOf(`aria-label="${label}"`);
  if (i < 0) return "";
  const j = html.indexOf("<section", i + 10);
  return html.slice(i, j < 0 ? undefined : j);
};
const numbers = (s: string) => [...s.matchAll(/#(\d+) · /g)].map((m) => Number(m[1]));

const JOBS = [
  job("a", 1, "2026-10-26"), // the day before yesterday (overdue)
  job("b", 2, "2026-10-27"), // "today" at 11:30 PM Oct 27 Chicago
  job("c", 3, "2026-10-28"), // tomorrow then, today after midnight
  job("d", 4, "2026-10-29"),
  job("e", 5, null),
];
const CLOCK_F = {
  technician_id: "t1",
  service_job_id: "f",
  kind: "labor",
  started_at: "2026-10-28T14:00:00Z",
  helper_count: 0,
  number: 6,
  customer_name: "Cust 6",
};

describe("My tickets groups by the phone's local day", () => {
  it("11:30 PM CDT Oct 27 (= 04:30 UTC Oct 28, 00:30 Eastern Oct 28): Oct 27 is Today, Oct 28 is Coming up", () => {
    vi.setSystemTime(new Date("2026-10-28T04:30:00Z"));
    const html = render(JOBS);
    expect(numbers(section(html, "Today"))).toEqual([1, 2]);
    expect(section(html, "Today")).toContain("Was due Mon, Oct 26");
    // Today's card shows no date line without a window.
    expect(section(html, "Today")).not.toContain("Tue, Oct 27");
    expect(numbers(section(html, "Coming up"))).toEqual([3, 4]);
    expect(numbers(section(html, "No date yet"))).toEqual([5]);
  });
  it("12:30 AM CDT Oct 28: Oct 27 becomes 'Was due', Oct 28 moves into Today", () => {
    vi.setSystemTime(new Date("2026-10-28T05:30:00Z"));
    const html = render(JOBS);
    expect(numbers(section(html, "Today"))).toEqual([1, 2, 3]);
    expect(section(html, "Today")).toContain("Was due Tue, Oct 27");
    expect(numbers(section(html, "Coming up"))).toEqual([4]);
  });
  it("a future ticket with a clock running (field_status set) is pulled into Today", () => {
    vi.setSystemTime(new Date("2026-10-28T15:00:00Z"));
    const html = render([job("d", 4, "2026-10-29", { field_status: "en_route" })]);
    expect(numbers(section(html, "Today"))).toEqual([4]);
  });
  it("empty Today group shows the count 0 and the empty line; a clock on another ticket hides the card buttons", () => {
    vi.setSystemTime(new Date("2026-10-28T15:00:00Z"));
    const html = render([job("d", 4, "2026-10-29"), job("f", 6, "2026-10-30")], CLOCK_F);
    const today = section(html, "Today");
    expect(today).toContain("Nothing scheduled for today.");
    expect(today).toMatch(/Today<span[^>]*>0<\/span>/);
    expect(html).toContain('data-line="clock-banner"');
    expect(html).toContain("On site at #6 Cust 6 · 1 h 0 m");
    // The card for f: no Start travel / On site, says use the clock at the top; d: both buttons.
    const coming = section(html, "Coming up");
    expect(coming).toContain("You are on site here");
    expect((coming.match(/Start travel/g) ?? []).length).toBe(1);
    expect(
      (coming.match(/>On site<\/button>|On site\s*<\/button>/g) ?? []).length,
    ).toBeGreaterThanOrEqual(1);
    // The banner's time uses the phone's zone (CDT): 14:00Z = 9:00 AM.
    expect(html).toContain("since 9:00 AM");
  });
});

describe("the 30-second tick is the banner's alone (Oct 28 audit)", () => {
  it("the same day at two instants: the banner's minutes move, the cards are identical", () => {
    const jobs = [job("d", 4, "2026-10-29"), job("f", 6, "2026-10-30"), job("e", 5, null)];
    vi.setSystemTime(new Date("2026-10-28T15:00:00Z"));
    const a = render(jobs, CLOCK_F);
    vi.setSystemTime(new Date("2026-10-28T15:31:00Z"));
    const b = render(jobs, CLOCK_F);
    expect(a).toContain("· 1 h 0 m");
    expect(b).toContain("· 1 h 31 m");
    for (const label of ["Today", "Coming up", "No date yet"])
      expect(section(b, label)).toBe(section(a, label));
  });
  it("source: useTick lives in ClockBanner; the page keeps only a once-a-minute local-day check", () => {
    const src = read("src/components/service/today-page.tsx");
    const page = src.slice(
      src.indexOf("export function TodayPage()"),
      src.indexOf("function ClockBanner("),
    );
    expect(page).not.toContain("useTick(");
    expect(page).toContain("const today = useLocalDay();");
    const banner = src.slice(src.indexOf("function ClockBanner("), src.indexOf("function Group("));
    expect(banner).toContain("const now = useTick(30_000);");
    expect(src).toContain(
      "setInterval(() => setDay((d) => (localYmd() === d ? d : localYmd())), 60_000)",
    );
  });
  it("every tappable control on the page is at least 44 px tall (min-h-11 / h-11+), none at min-h-9", () => {
    const src = read("src/components/service/today-page.tsx");
    expect(src).not.toContain("min-h-9");
    expect(src).toMatch(
      /className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline-offset-2 hover:underline"\s+disabled=\{press\.isPending\}\s+onClick=\{\(\) => press\.mutate\("undo"\)\}/,
    );
    expect(src).toContain(
      'className="min-h-11 px-1 text-sm font-medium text-primary underline-offset-2 hover:underline"',
    );
    expect(src).toContain(
      'className="inline-flex min-h-11 items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"',
    );
    expect(src).toContain('className="h-11 w-11 shrink-0"');
  });
});
