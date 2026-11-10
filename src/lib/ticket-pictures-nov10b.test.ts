/**
 * Speed pass, Nov 10, finding 4: opening a ticket downloaded all its pictures again every time
 * (31 thumbnails, 640 KB, none from the browser's cache) and made 28 calls in four rounds.
 *
 *  1. A stored picture keeps ONE link for as long as that link is good (lib/photo-link-store.ts):
 *     every read signs fresh links and a fresh link is a new address, so the browser's own copy
 *     was never used. The thumbnail, the lightbox, History at this property and the signature
 *     all go through it; so does a link a section signs for itself.
 *  2. The thumbnails keep their fixed boxes and their lazy loading, and are now unpacked off the
 *     main thread. Nothing about the pictures themselves changes: same uploads, same full size.
 *  3. Six plain reads of the same ticket ride along with the ticket's one read (the crew, the
 *     materials used, the purchase orders, the contact log, the clock on it, an inspection's
 *     record), each under its own access rule; the page seeds each section's cache.
 *
 * Fails on the old code: no link store, a fresh link straight into every <img>, a bundle of five.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({ notifyUsers: vi.fn(async () => undefined) }));

import {
  LINK_MIN_LEFT_MS,
  LINK_STORE_KEY,
  LINK_STORE_MAX,
  PhotoLinkStore,
  chooseLink,
  linkExpiryMs,
  linkFreshForMs,
  linkStillGood,
} from "@/lib/photo-link-store";
import {
  PHOTO_LINK_SECONDS,
  TICKET_EXTRAS,
  getTicketBundle,
  type TicketBundle,
} from "@/lib/service-field.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 10, 15, 0, 0);

/** A link shaped like the storage's: `…/object/sign/service/<path>?token=<header.payload.sig>`. */
const signed = (path: string, signedAtMs: number, lifeSeconds = 3600) => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(signedAtMs / 1000);
  return `https://x.supabase.co/storage/v1/object/sign/service/${path}?token=${b64({ alg: "HS256" })}.${b64({ url: `service/${path}`, iat, exp: iat + lifeSeconds })}.sig`;
};
/** A Storage that is a Map (and can be told to throw, as a private window's does). */
function memory(broken = false) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => {
      if (broken) throw new Error("no storage");
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("no storage");
      map.set(k, v);
    },
    removeItem: (k: string) => {
      if (broken) throw new Error("no storage");
      map.delete(k);
    },
  };
}

describe("1a. a link's own expiry", () => {
  it("is read off the link's token, to the second", () => {
    const url = signed("job/a.jpg", T0);
    expect(linkExpiryMs(url, T0 + 5 * MIN)).toBe(T0 + 60 * MIN);
    expect(linkExpiryMs(signed("job/a.jpg", T0, 600), T0)).toBe(T0 + 10 * MIN);
  });
  it("a link with no readable expiry is assumed good for an hour from when it is first seen", () => {
    expect(linkExpiryMs("https://x/y.jpg", T0)).toBe(T0 + 60 * MIN);
    expect(linkExpiryMs("https://x/y.jpg?token=not.a-token.x", T0)).toBe(T0 + 60 * MIN);
    expect(linkExpiryMs("https://x/y.jpg?token=", T0)).toBe(T0 + 60 * MIN);
  });
  it("the storage's links still last the hour they did (nothing about signing changed)", () => {
    expect(PHOTO_LINK_SECONDS).toBe(3600);
    expect(read("src/components/service/field-utils.ts")).toContain(
      ".createSignedUrl(path!, 3600);",
    );
  });
});

describe("1b. which link is shown", () => {
  const first = signed("job/a.jpg", T0);
  const kept = { url: first, exp: T0 + 60 * MIN };
  it("the remembered link while it has fifteen minutes or more to live", () => {
    expect(LINK_MIN_LEFT_MS).toBe(15 * MIN);
    const fresh = signed("job/a.jpg", T0 + 20 * MIN);
    expect(chooseLink(kept, fresh, T0 + 20 * MIN)).toEqual({ url: first, remember: null });
    expect(chooseLink(kept, fresh, T0 + 45 * MIN)).toEqual({ url: first, remember: null });
    expect(linkStillGood(kept, T0 + 45 * MIN)).toBe(true);
  });
  it("the fresh link once the remembered one is close to running out, remembered from then on", () => {
    const fresh = signed("job/a.jpg", T0 + 46 * MIN);
    expect(chooseLink(kept, fresh, T0 + 46 * MIN)).toEqual({
      url: fresh,
      remember: { url: fresh, exp: T0 + 106 * MIN },
    });
    expect(linkStillGood(kept, T0 + 46 * MIN)).toBe(false);
  });
  it("nothing remembered: the fresh one; nothing at all: none", () => {
    expect(chooseLink(undefined, first, T0).url).toBe(first);
    expect(chooseLink(undefined, null, T0)).toEqual({ url: null, remember: null });
    // A remembered link that has run out is never handed out, fresh one or not.
    expect(chooseLink(kept, null, T0 + 61 * MIN)).toEqual({ url: null, remember: null });
  });
  it("a row with no fresh link (one a write handed back) still shows the remembered picture", () => {
    expect(chooseLink(kept, null, T0 + 5 * MIN)).toEqual({ url: first, remember: null });
  });
});

describe("1c. the memory", () => {
  it("the second open of a ticket shows the SAME links, so the browser's copies are used", () => {
    const store = new PhotoLinkStore(memory());
    const paths = Array.from({ length: 31 }, (_, i) => `job/${i}.jpg`);
    const firstOpen = paths.map((p) => store.link(p, signed(p, T0), T0));
    // Ten minutes on, the ticket is read again: 31 fresh links, all different addresses.
    const fresh = paths.map((p) => signed(p, T0 + 10 * MIN));
    expect(fresh.every((u, i) => u !== firstOpen[i])).toBe(true);
    const secondOpen = paths.map((p, i) => store.link(p, fresh[i], T0 + 10 * MIN));
    expect(secondOpen).toEqual(firstOpen);
    expect(store.size).toBe(31);
  });
  it("after a reload too: the memory is in the browser's storage", () => {
    const disk = memory();
    const saves: Array<() => void> = [];
    const a = new PhotoLinkStore(disk, (save) => saves.push(save));
    const first = a.link("job/a.jpg", signed("job/a.jpg", T0), T0);
    a.link("job/b.jpg", signed("job/b.jpg", T0), T0);
    // Many links, one write (the browser's binding saves on a short timer).
    expect(saves).toHaveLength(1);
    expect(disk.map.size).toBe(0);
    saves[0]!();
    expect(JSON.parse(disk.map.get(LINK_STORE_KEY)!).links["job/a.jpg"]).toEqual([
      first,
      T0 + 60 * MIN,
    ]);
    // A new page: a new store over the same storage.
    const b = new PhotoLinkStore(disk);
    expect(b.link("job/a.jpg", signed("job/a.jpg", T0 + 30 * MIN), T0 + 30 * MIN)).toBe(first);
    expect(b.peek("job/a.jpg", T0 + 30 * MIN)).toBe(first);
    expect(b.peek("job/never-seen.jpg", T0 + 30 * MIN)).toBeNull();
  });
  it("a link past its hour is forgotten on the next page, and the fresh one takes over", () => {
    const disk = memory();
    const a = new PhotoLinkStore(disk);
    a.link("job/a.jpg", signed("job/a.jpg", T0), T0);
    const b = new PhotoLinkStore(disk);
    const fresh = signed("job/a.jpg", T0 + 90 * MIN);
    expect(b.peek("job/a.jpg", T0 + 90 * MIN)).toBeNull();
    expect(b.link("job/a.jpg", fresh, T0 + 90 * MIN)).toBe(fresh);
  });
  it("sign-out empties it; another person signing in on the same browser starts empty", () => {
    const disk = memory();
    const a = new PhotoLinkStore(disk);
    a.forUser("user-a", T0);
    const first = a.link("job/a.jpg", signed("job/a.jpg", T0), T0);
    // The same person again (a reload): kept.
    const again = new PhotoLinkStore(disk);
    again.forUser("user-a", T0 + MIN);
    expect(again.peek("job/a.jpg", T0 + MIN)).toBe(first);
    // Someone else on this browser: nothing of the first person's is used.
    const other = new PhotoLinkStore(disk);
    other.forUser("user-b", T0 + 2 * MIN);
    expect(other.peek("job/a.jpg", T0 + 2 * MIN)).toBeNull();
    expect(other.size).toBe(0);
    // Sign-out: the memory and its storage entry are gone.
    const c = new PhotoLinkStore(disk);
    c.forUser("user-b", T0 + 3 * MIN);
    c.link("job/c.jpg", signed("job/c.jpg", T0 + 3 * MIN), T0 + 3 * MIN);
    c.clear();
    expect(c.size).toBe(0);
    expect(disk.map.has(LINK_STORE_KEY)).toBe(false);
  });
  it("links seen before the session is known stay with the person who then turns out to be signed in", () => {
    const store = new PhotoLinkStore(memory());
    const first = store.link("job/a.jpg", signed("job/a.jpg", T0), T0);
    store.forUser("user-a", T0);
    expect(store.peek("job/a.jpg", T0 + MIN)).toBe(first);
  });
  it("a browser that refuses storage still remembers for the page; a damaged entry is ignored", () => {
    const store = new PhotoLinkStore(memory(true));
    const first = store.link("job/a.jpg", signed("job/a.jpg", T0), T0);
    expect(store.link("job/a.jpg", signed("job/a.jpg", T0 + MIN), T0 + MIN)).toBe(first);
    expect(() => store.clear()).not.toThrow();
    const disk = memory();
    disk.map.set(LINK_STORE_KEY, "{not json");
    expect(new PhotoLinkStore(disk).peek("job/a.jpg", T0)).toBeNull();
    const none = new PhotoLinkStore(null);
    expect(none.link("job/a.jpg", first, T0)).toBe(first);
  });
  it("it cannot grow for ever: the newest links are the ones kept", () => {
    const disk = memory();
    const store = new PhotoLinkStore(disk);
    for (let i = 0; i < LINK_STORE_MAX + 50; i++)
      store.link(`job/${i}.jpg`, signed(`job/${i}.jpg`, T0), T0);
    store.save(T0);
    expect(store.size).toBe(LINK_STORE_MAX);
    expect(store.peek("job/0.jpg", T0)).toBeNull();
    expect(store.peek(`job/${LINK_STORE_MAX + 49}.jpg`, T0)).not.toBeNull();
  });
  it("a link a section signs for itself is fresh until it is fifteen minutes from running out", () => {
    const url = signed("job/a.jpg", T0);
    expect(linkFreshForMs(url, T0)).toBe(45 * MIN);
    // A remembered link handed out 30 minutes into its hour is fresh for 15 more.
    expect(linkFreshForMs(url, T0 + 30 * MIN)).toBe(15 * MIN);
    expect(linkFreshForMs(url, T0 + 50 * MIN)).toBe(0);
    expect(linkFreshForMs(undefined, T0)).toBe(0);
  });
});

describe("1d. every place a ticket picture is shown goes through the memory", () => {
  const utils = read("src/components/service/field-utils.ts");
  it("the thumbnail and its full picture (the strip, the close-out, the lightbox)", () => {
    const shared = read("src/components/service/field-shared.tsx");
    expect(shared).toMatch(
      /const listedSmall = useStableLink\(\s*smallPath,\s*photo\.thumb_path \? listed\.thumb_url : listed\.url,?\s*\);/,
    );
    expect(shared).toContain("const listedFull = useStableLink(photo.storage_path, listed.url);");
    expect(shared).toContain("data: listedSmall || ownSmall.data || null,");
    expect(shared).toContain(
      "const fullUrl = listedFull || ownFull.data || (!photo.thumb_path ? url.data : null);",
    );
  });
  it("History at this property and the signature", () => {
    const history = read("src/components/service/site-history.tsx");
    expect(history).toMatch(
      /const small = useStableLink\(\s*photo\.thumb_url \? photo\.thumb_path : photo\.storage_path,\s*photo\.thumb_url \?\? photo\.url,\s*\);/,
    );
    expect(history).toContain("const listed = useStableLink(photo.storage_path, photo.url);");
    expect(utils).toContain(
      "const stable = useStableLink(bundled ? job.signature_path : null, bundled);",
    );
  });
  it("a link a section signs for itself: the remembered one first, and what it signs is remembered", () => {
    const hook = utils.slice(utils.indexOf("export function useSignedUrl("));
    expect(hook).toContain("const kept = photoLinks()?.peek(path!, Date.now());");
    expect(hook).toContain("if (kept) return kept;");
    expect(hook).toContain("return stableLink(path, data.signedUrl) ?? data.signedUrl;");
    expect(hook).toContain(
      "staleTime: (q) => linkFreshForMs(q.state.data, q.state.dataUpdatedAt),",
    );
  });
  it("the memory is the browser's storage, emptied on sign-out and for another person", () => {
    expect(utils).toContain("storage = window.localStorage;");
    expect(utils).toContain('if (event === "SIGNED_OUT") store.clear();');
    expect(utils).toContain("else if (session?.user.id) store.forUser(session.user.id);");
    // Nothing on the server (it renders no pictures).
    expect(utils).toContain('if (typeof window === "undefined") return null;');
  });
});

describe("2. the pictures themselves are untouched", () => {
  it("thumbnails load as they scroll into view, in boxes sized up front, unpacked off the main thread", () => {
    const shared = read("src/components/service/field-shared.tsx");
    expect(shared).toContain('const box = size === "sm" ? "h-16 w-16" : "h-20 w-20";');
    const thumb = shared.slice(shared.indexOf("const listedSmall = useStableLink("));
    expect(thumb.slice(0, thumb.indexOf("</button>"))).toContain('loading="lazy"');
    const markup = read("src/components/service/photo-markup.tsx");
    const img = markup.slice(markup.indexOf("export function RotatedPhoto("));
    expect(img).toContain("loading={loading}");
    expect(img).toContain('decoding="async"');
    for (const f of ["site-history.tsx", "inspection-item-photos.tsx"])
      expect(read(`src/components/service/${f}`)).toContain('loading="lazy"');
  });
  it("no change to what is uploaded or to the full-size view", () => {
    // The link store only ever chooses between two links to the same stored file.
    const store = read("src/lib/photo-link-store.ts");
    expect(store).not.toMatch(/shrink|quality|resize|toBlob|canvas/i);
    const shared = read("src/components/service/field-shared.tsx");
    // The lightbox still gets the full picture's link (storage_path), never the small copy's
    // when a full one exists.
    expect(shared).toContain("const listedFull = useStableLink(photo.storage_path, listed.url);");
  });
});

// ── 3. the ride-along reads ────────────────────────────────────────────────────────────────

const JOB = "11111111-1111-4111-8111-111111111111";
const INSPECTION = "22222222-2222-4222-8222-222222222222";
const TECH = "33333333-3333-4333-8333-333333333333";
let userSeq = 0;
/** A fresh office user each time (the profile is cached per user for a minute). */
const newUser = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++userSeq).padStart(12, "0")}`;

function world(me: string, refuse: string[] = []) {
  const env = fakeSupabase({
    profiles: [
      {
        id: me,
        role: "manager",
        access: [],
        technician: false,
        full_name: "Olive Office",
        email: "o@x",
      },
      {
        id: TECH,
        role: "user",
        access: ["service"],
        technician: true,
        full_name: "Tyler Tech",
        email: "t@x",
      },
    ],
    service_jobs: [
      {
        id: JOB,
        number: 7001,
        service_type: "repair",
        stage: "scheduled",
        technician_id: TECH,
        customer_name: "ZZ Test",
        signature_path: null,
        site_id: null,
        deleted_at: null,
      },
      {
        id: INSPECTION,
        number: 7002,
        service_type: "inspection",
        stage: "scheduled",
        technician_id: TECH,
        customer_name: "ZZ Test",
        signature_path: null,
        site_id: null,
        inspection: null,
        inspection_outcome: null,
        deleted_at: null,
      },
    ],
    service_job_repairs: [{ id: "r1", service_job_id: JOB, sort: 1, created_at: "2026-11-01" }],
    service_job_photos: [],
    service_time_entries: [],
    service_job_events: [{ id: "e1", service_job_id: JOB, at: "2026-11-01T10:00:00Z" }],
    service_job_crew: [
      { id: "c1", service_job_id: JOB, technician_id: TECH, role: "lead", sort: 0 },
    ],
    service_job_techs: [{ service_job_id: JOB, technician_id: TECH, bill_rate: 85 }],
    inventory_movements: [
      {
        id: 1,
        service_job_id: JOB,
        location_id: "shop",
        screen_id: "service",
        row_label: "Acetone",
        price_col: "price",
        qty: -1,
        unit: "gal",
        created_at: "2026-11-01T11:00:00Z",
      },
      {
        id: 2,
        service_job_id: "other",
        location_id: "shop",
        screen_id: "service",
        row_label: "Acetone",
        price_col: "price",
        qty: -5,
        unit: "gal",
        created_at: "2026-11-01T11:00:00Z",
      },
    ],
    service_materials_catalog: [
      { id: "m1", name: "Acetone", unit: "Gal", sort: 1, active: true, stock_screen_id: null },
    ],
    service_job_purchase_orders: [],
    crm_contact_log: [
      { id: "l1", kind: "ticket", item_id: JOB, at: "2026-11-01T12:00:00Z", method: "call" },
      { id: "l2", kind: "ticket", item_id: "other", at: "2026-11-01T12:00:00Z", method: "call" },
      { id: "l3", kind: "opportunity", item_id: JOB, at: "2026-11-01T12:00:00Z", method: "call" },
    ],
    service_tech_clock: [
      {
        technician_id: TECH,
        service_job_id: JOB,
        kind: "labor",
        started_at: "2026-11-10T14:00:00Z",
        helper_count: 0,
      },
    ],
    inspection_checklist_items: [{ id: "i1", label: "Seams", sort: 10 }],
    bids: [],
  });
  const reads: string[] = [];
  const inner = env.db as unknown as { from: (t: string) => unknown };
  const db = {
    ...(env.db as object),
    from: (t: string) => {
      reads.push(t);
      if (refuse.includes(t)) throw new Error(`refused: ${t}`);
      return inner.from(t);
    },
  };
  return { db, reads, writes: env.writes };
}
const open = (db: unknown, me: string, id: string) =>
  (getTicketBundle as unknown as (a: { data: unknown; context: unknown }) => Promise<TicketBundle>)(
    {
      data: { id },
      context: { supabase: db, userId: me },
    },
  );

describe("3a. six reads of the same ticket ride along with its one read", () => {
  it("the crew, the materials used, the purchase orders, the contact log and the clock on it", async () => {
    const me = newUser();
    const { db, writes } = world(me);
    const b = await open(db, me, JOB);
    expect(b.job.id).toBe(JOB);
    expect(b.repairs).toHaveLength(1);
    expect(b.events).toHaveLength(1);
    // Each is that ticket's own, as its own function answers it.
    expect(b.crew?.map((c) => [c.technician_id, c.name])).toEqual([[TECH, "Tyler Tech"]]);
    expect(b.materials?.map((m) => m.id)).toEqual([1]);
    expect(b.pos).toMatchObject({ pos: [], ticketNumber: 7001 });
    expect(b.contacts?.map((c) => c.id)).toEqual(["l1"]);
    expect(b.clock).toMatchObject({
      technician_id: TECH,
      number: 7001,
      technician_name: "Tyler Tech",
    });
    // A repair ticket has no checklist record: it is not read at all.
    expect(b).not.toHaveProperty("inspection");
    expect(writes).toEqual([]);
  });
  it("an inspection ticket brings its checklist record too; no clock is an answer (null), not a gap", async () => {
    const me = newUser();
    const { db, reads } = world(me);
    const b = await open(db, me, INSPECTION);
    expect(b.inspection?.checklist).toEqual([{ id: "i1", label: "Seams", sort: 10 }]);
    expect(b.clock).toBeNull();
    expect(b).toHaveProperty("clock");
    expect(reads).toContain("inspection_checklist_items");
    // A repair ticket never touches the checklist.
    const office = newUser();
    const repair = world(office);
    await open(repair.db, office, JOB);
    expect(repair.reads).not.toContain("inspection_checklist_items");
  });
  it("a read that refuses or fails is left out, and the ticket still opens with the rest", async () => {
    const me = newUser();
    const { db } = world(me, ["service_job_purchase_orders", "crm_contact_log"]);
    const b = await open(db, me, JOB);
    expect(b.job.id).toBe(JOB);
    expect(b).not.toHaveProperty("pos");
    expect(b).not.toHaveProperty("contacts");
    expect(b.crew).toHaveLength(1);
    expect(b.materials).toHaveLength(1);
    expect(b.clock).not.toBeNull();
  });
  it("the ticket's own reads still decide: a ticket that is not there is 'Ticket not found'", async () => {
    const me = newUser();
    const { db } = world(me);
    await expect(open(db, me, "99999999-9999-4999-8999-999999999999")).rejects.toThrow(
      "Ticket not found",
    );
  });
  it("each ride-along is the section's own function, access rule and all", () => {
    expect([...TICKET_EXTRAS]).toEqual([
      "crew",
      "materials",
      "pos",
      "contacts",
      "clock",
      "inspection",
    ]);
    const field = read("src/lib/service-field.functions.ts");
    const bundle = field.slice(field.indexOf("export const getTicketBundle"));
    for (const call of [
      "rideAlong(() => readJobCrew(context, data.id))",
      "rideAlong(() => readJobMaterials(context, data.id))",
      "rideAlong(() => readPurchaseOrders(context, data.id))",
      'rideAlong(() => readContactLog(sb, "ticket", data.id))',
      "rideAlong(() => readClockOnJob(context, data.id))",
      "rideAlong(() => readTicketInspection(context, job.id))",
    ])
      expect(bundle).toContain(call);
    expect(bundle).toContain('job.service_type === "inspection"');
    // The plain functions carry the checks the server functions had, and the server functions
    // are now just a call to them.
    const service = read("src/lib/service.functions.ts");
    expect(service).toMatch(
      /async function readJobMaterials\([^)]*\)[^{]*\{\s*await serviceAccess\(context\);/,
    );
    expect(service).toMatch(
      /async function readJobCrew\([^)]*\)[^{]*\{\s*const p = await serviceAccess\(context\);/,
    );
    expect(service).toContain("export { readJobMaterials };");
    expect(service).toContain("export { readJobCrew };");
    expect(service).toContain("bill_rate: noMoney ? null : r.bill_rate,");
    expect(read("src/lib/service-pos.functions.ts")).toMatch(
      /export async function readPurchaseOrders\([^)]*\)[^{]*\{\s*const p = await me\(context\);\s*const \{ job, works \} = await ticketFor\(context, jobId\);/,
    );
    expect(read("src/lib/service-inspection.functions.ts")).toMatch(
      /export async function readTicketInspection\([^)]*\)[^{]*\{\s*await me\(context\);/,
    );
    expect(field).toMatch(/async function readClockOnJob\([^)]*\)[^{]*\{\s*await me\(context\);/);
    expect(service).toContain(
      ".handler(({ data, context }): Promise<CrewMemberView[]> => readJobCrew(context, data.id));",
    );
  });
});

describe("3b. the page seeds each section's cache from the one read", () => {
  it("every part under the key its section reads; a part left out is not seeded", async () => {
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: {} }));
    const { seedTicketCaches, ticketContactLogKey } =
      await import("@/components/service/ticket-bundle-seed");
    const set: Array<[readonly unknown[], unknown]> = [];
    const qc = { setQueryData: (k: readonly unknown[], v: unknown) => void set.push([k, v]) };
    const b = {
      job: {},
      repairs: ["r"],
      photos: ["p"],
      time: ["t"],
      events: ["e"],
      crew: ["c"],
      materials: ["m"],
      pos: { pos: [] },
      contacts: ["l"],
      clock: null,
    } as unknown as TicketBundle;
    seedTicketCaches(qc as never, JOB, b);
    expect(set).toEqual([
      [["service-job-repairs", JOB], ["r"]],
      [["service-job-photos", JOB], ["p"]],
      [["service-job-time", JOB], ["t"]],
      [["service-job-events", JOB], ["e"]],
      [["service-job-crew", JOB], ["c"]],
      [["service-job-materials", JOB], ["m"]],
      [["service-job-pos", JOB], { pos: [] }],
      [["contact-log", "ticket", JOB], ["l"]],
      [["service-job-clock", JOB], null],
    ]);
    expect(ticketContactLogKey(JOB)).toEqual(["contact-log", "ticket", JOB]);
    set.length = 0;
    seedTicketCaches(qc as never, JOB, {
      job: {},
      repairs: [],
      photos: [],
      time: [],
      events: [],
      inspection: { checklist: [] },
    } as unknown as TicketBundle);
    expect(set.map(([k]) => k[0])).toEqual([
      "service-job-repairs",
      "service-job-photos",
      "service-job-time",
      "service-job-events",
      "service-inspection",
    ]);
  });
  it("the ticket page seeds with it, and the sections that had no stale time do not ask again", () => {
    const page = read("src/components/service-page.tsx");
    expect(page).toContain("seedTicketCaches(qc, id, b);");
    expect(page).toMatch(
      /queryKey: \["service-job-materials", jobId\],\s*queryFn: \(\) => listFn\(\{ data: \{ id: jobId \} \}\),\s*enabled: !!session,[\s\S]{0,140}staleTime: FIELD_SEEDED_MS,/,
    );
    expect(read("src/components/service/ticket-activity.tsx")).toMatch(
      /queryKey: \["contact-log", "ticket", jobId\],[\s\S]{0,260}staleTime: FIELD_SEEDED_MS,/,
    );
    const sections = read("src/components/service/ticket-field-sections.tsx");
    expect(sections).toMatch(
      /queryKey: fieldKeys\.jobClock\(jobId\),[\s\S]{0,300}staleTime: FIELD_SEEDED_MS,\s*refetchInterval: 60_000,/,
    );
    expect(read("src/components/service/field-utils.ts")).toContain(
      "export const FIELD_SEEDED_MS = 30_000;",
    );
    // The crew, the purchase orders, the materials fold and the inspection already keep their
    // reads for FIELD_STALE_MS, so a seeded cache is enough for them.
    expect(read("src/components/service/crew-box.tsx")).toMatch(
      /queryKey: fieldKeys\.crew\(job\.id\),[\s\S]{0,120}\.\.\.FIELD_READ,/,
    );
    expect(read("src/components/service/purchase-orders-section.tsx")).toMatch(
      /queryKey: fieldKeys\.pos\(jobId\),[\s\S]{0,120}\.\.\.FIELD_READ,/,
    );
  });
});
