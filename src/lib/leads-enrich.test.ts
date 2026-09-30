import { describe, expect, it, vi } from "vitest";

// readPlanroomPages (the job-page reads after a refresh) against a stand-in planroom and table:
// what it writes, and which rows it picks. The list refresh never sends details_read_at,
// details or contact for these sources (leads-fixes.test.ts), so what is written here stays.
vi.mock("@/lib/notify.server", () => ({
  notify: async () => 0,
  serverClient: async (c: unknown) => c,
  hasServiceRole: () => true,
}));
const fetched = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/planroom.server", () => ({
  STATE_PLANROOM: { base: "https://www.stateofkyplanroom.com/View", label: "State planroom" },
  LYNN_PLANROOM: { base: "https://www.lynnimaging.com/distribution/View", label: "Lynn planroom" },
  planroomCredentials: () => ({ email: "e", password: "p" }),
  planroomSignIn: async (site: unknown) => ({ site, jar: null }),
  planroomSignOut: async () => undefined,
  fetchJobDetails: async (_s: unknown, jobId: string) => {
    fetched.push(jobId);
    return {
      fields: { owner: "Finance Cabinet" },
      emails: [],
      phones: [],
      planHolders: [{ company: "Acme Roofing" }],
      text: "Job page text",
    };
  },
  contactLine: () => "Owner Finance Cabinet — jane@ky.gov",
}));

import type { Client } from "@/lib/notify.server";
import { readPlanroomPages } from "@/lib/leads.server";

type Row = Record<string, unknown> & { id: string };

function fakeDb(rows: Row[]) {
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const db = {
    from() {
      let patch: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        in: () => q,
        is: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data: rows, error: null }),
        update(p: Record<string, unknown>) {
          patch = p;
          return q;
        },
        eq(_c: string, v: unknown) {
          if (patch) {
            updates.push({ id: v as string, patch });
            Object.assign(
              rows.find((r) => r.id === v)!,
              patch,
            );
            return Promise.resolve({ error: null });
          }
          return q;
        },
      };
      return q;
    },
  };
  return { db: db as unknown as Client, updates };
}

describe("readPlanroomPages", () => {
  it("stores the page in its own columns, never in raw, and reads a row once a week", async () => {
    const recent = new Date(Date.now() - 86400000).toISOString();
    const rows: Row[] = [
      // Read yesterday (the stamp in its own column): not due.
      {
        id: "P0",
        source: "ky_planroom",
        external_id: "50000",
        title: "Roof 0",
        raw: { jobId: "50000" },
        bid_at: null,
        details_read_at: recent,
      },
      // Never read.
      {
        id: "P1",
        source: "ky_planroom",
        external_id: "50001",
        title: "Roof 1",
        raw: { jobId: "50001" },
        bid_at: null,
        details_read_at: null,
      },
    ];
    const { db, updates } = fakeDb(rows);
    const r = await readPlanroomPages(db, 6);
    expect(r).toEqual({ read: 1, failed: [] });
    expect(fetched).toEqual(["50001"]);
    expect(updates).toHaveLength(1);
    const patch = updates[0]!.patch;
    expect(patch).not.toHaveProperty("raw");
    expect(patch["contact"]).toBe("Owner Finance Cabinet — jane@ky.gov");
    expect(Date.parse(patch["details_read_at"] as string)).toBeGreaterThan(Date.now() - 60000);
    expect(patch["details"]).toEqual({
      fields: { owner: "Finance Cabinet" },
      plan_holders: [{ company: "Acme Roofing" }],
      page_text: "Job page text",
    });
    // The list's own raw is left as the list wrote it.
    expect(rows[1]!["raw"]).toEqual({ jobId: "50001" });
  });

  it("a Lynn post with no planroom job id does not take a slot from a job that has one", async () => {
    fetched.length = 0;
    const rows: Row[] = [];
    for (let i = 0; i < 6; i++)
      rows.push({
        id: `L${i}`,
        source: "lynn_bids",
        external_id: `https://www.lynnimaging.com/bids/2026/09/2${i}/post-${i}/`,
        title: `Roof ${i}`,
        raw: {},
        bid_at: null,
        details_read_at: null,
      });
    rows.push({
      id: "P9",
      source: "ky_planroom",
      external_id: "50009",
      title: "Planroom roof",
      raw: {},
      bid_at: null,
      details_read_at: null,
    });
    const { db } = fakeDb(rows);
    const r = await readPlanroomPages(db, 6);
    expect(fetched).toEqual(["50009"]);
    expect(r.read).toBe(1);
  });
});
