/**
 * Service review, Nov 3 (owner: "go with … 18, 20, 21, 22, 23, 24, 25, 33, 34, 35, 36, 37 …
 * 45, 46"), batch B — the close-out, its photos and the history reads. Each test fails on the
 * code before the change.
 *
 *   18  "Nothing used" / "Skip — nothing to add" are the step's Next
 *   20  the greyed-out Complete in the gaps dialog is gone
 *   21  "from my photos" beside the camera (the close-out and the inspection camera)
 *   22  a failed tap keeps a "Try again" (repair chip, time, clock, material tap, signature)
 *   23  autosave retries when the signal returns; "Not saved" is a button
 *   24  the marks live on the ticket (nothing_used_at / notes_skipped_at)
 *   25  your own material entry can be undone while the ticket is still yours
 *   33  finger-sized dots, chevron, chips and Retry links
 *   34  a small copy of each photo (thumb_path), made at upload or by the first viewer who may
 *   35  one signing call for a ticket's photos
 *   36  one bundle read on open, the caller's profile cached
 *   37  field reads fresh for five minutes, never re-read on focus
 *   45  My tickets reads the history strips with the day
 *   46  History at this property shows ten and asks for the rest on "Show more"
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  makeThumb,
  thumbPathFor,
  FIELD_READ,
  FIELD_STALE_MS,
} from "@/components/service/field-utils";
import { ownFreshEntries } from "@/components/service/materials-utils";
import { createProfileCache } from "@/lib/profile-cache.server";

const read = (p: string) => readFileSync(p, "utf8");
const closeout = read("src/components/service/closeout.tsx");
const shared = read("src/components/service/field-shared.tsx");
const utils = read("src/components/service/field-utils.ts");
const serverField = read("src/lib/service-field.functions.ts");
const migration = read("supabase/migrations/20261103190000_closeout_marks_thumbs_history.sql");

describe("18 + 24. the marks: on the ticket, and the step's Next", () => {
  it("ride the text draft and save with it; the server stamps nothing_used_at / notes_skipped_at", () => {
    expect(closeout).toContain("nothing_used: boolean;");
    expect(closeout).toContain("notes_skipped: boolean;");
    expect(closeout).toContain(
      "nothing_used: !!j.nothing_used_at || readMark(nothingUsedKey(j.id)),",
    );
    expect(closeout).toContain(
      "const markNothingUsed = (on: boolean) => update({ nothing_used: on });",
    );
    expect(serverField).toContain("nothing_used: z.boolean().optional(),");
    expect(serverField).toContain(
      "patch.nothing_used_at = fields.nothing_used ? (job.nothing_used_at ?? now) : null;",
    );
    expect(serverField).toContain(
      "patch.notes_skipped_at = fields.notes_skipped ? (job.notes_skipped_at ?? now) : null;",
    );
    expect(migration).toContain("add column if not exists nothing_used_at timestamptz");
    expect(migration).toContain("add column if not exists notes_skipped_at timestamptz");
    expect(read("src/lib/job-cache.ts")).toMatch(/"nothing_used_at",\s*"notes_skipped_at",/);
  });
  it("pressed, they move to the next step; Undo keeps it", () => {
    expect(closeout).toMatch(/markNothingUsed\(true\);\s*goNext\("materials"\);/);
    expect(closeout).toMatch(/markNotesSkipped\(true\);\s*goNext\("notes"\);/);
    expect(closeout).toContain("Nothing used on this ticket — next step");
    expect(closeout).toContain("Skip — nothing to add, next step");
    expect(closeout).toContain("onClick={() => markNothingUsed(false)}");
    expect(closeout).toContain("onClick={() => markNotesSkipped(false)}");
  });
});

describe("20. the gaps dialog", () => {
  it("has no greyed-out Complete for a technician any more", () => {
    expect(closeout).not.toContain('data-action="complete-blocked"');
    expect(closeout).toMatch(/\{manager && \(\s*<AlertDialogAction/);
  });
});

describe("21. pictures already on the phone", () => {
  it("the close-out has a library input per role (no capture, several at once) and a 'from my photos' link", () => {
    expect(closeout.match(/capture="environment"/g)).toHaveLength(2);
    expect(closeout).toContain('data-library="before"');
    expect(closeout).toContain('data-library="after"');
    expect(closeout).toContain("onPick: (role) => pickPhotos(r.id, role),");
    expect(closeout).toContain("{ROLE_WORD[role]} from my photos");
  });
  it("the inspection camera too", () => {
    const cam = read("src/components/service/inspection-camera.ts");
    expect(cam).toContain('"data-library": "inspection"');
    expect(cam).toContain("onPick: () => openLibrary(itemKey, label),");
    expect(read("src/components/service/inspection-closeout.tsx")).toContain(
      "onClick={camera.onPick}",
    );
  });
});

describe("22. a failed tap keeps a Try again", () => {
  it("loudError takes a retry and puts it on the toast", () => {
    expect(utils).toContain(
      "export function loudError(what: string, e: unknown, retry?: () => void)",
    );
    expect(utils).toContain('action: { label: "Try again", onClick: retry }');
  });
  it("the repair chip, the time lines, the clock, the material tap and the signature use it", () => {
    expect(closeout).toContain('loudError("Could not add the repair", e, () => add.mutate(t))');
    expect(closeout).toContain('loudError("The clock did not stop", e, () => leave.mutate())');
    expect(closeout).toContain("() => saveSig.mutate(png)");
    expect(shared).toContain('loudError("Could not save the time", e, () => save.mutate(v))');
    expect(shared).toContain('loudError("Could not add the time", e, () => save.mutate())');
    expect(read("src/components/service/materials-section.tsx")).toContain(
      "loudError(what, e, () => enqueue(key, delta, what, run));",
    );
  });
});

describe("23. autosave retries on its own; Not saved is a button", () => {
  it("useAutosave flushes a failed save when the signal returns or the portal comes to the front", () => {
    expect(utils).toContain('window.addEventListener("online", again);');
    expect(utils).toContain('document.addEventListener("visibilitychange", visible);');
    expect(utils).toContain(
      'if (saver.state === "error" && navigator.onLine !== false) void saver.flush();',
    );
  });
  it("SavedIndicator's error state is a 'try again' button where the screen hands it a retry", () => {
    expect(shared).toContain('data-line="not-saved-retry"');
    expect(shared).toContain("Not saved — try again");
    for (const f of ["closeout.tsx", "crew-box.tsx", "invoice-editor.tsx"])
      expect(read(`src/components/service/${f}`), f).toContain(
        "<SavedIndicator state={autosave.state} onRetry={() => void autosave.flush()} />",
      );
  });
});

describe("25. undo your own material entry while the ticket is still yours", () => {
  const cell = { location_id: "t", screen_id: "s", row_label: "r", price_col: "price" };
  const row = (id: number, ageH: number, by = "me") => ({
    ...cell,
    id,
    qty: -1,
    unit: "ea",
    counted_note: null,
    created_by: by,
    created_by_name: "Me",
    created_at: new Date(Date.UTC(2026, 10, 3) - ageH * 3600_000).toISOString(),
  });
  const now = Date.UTC(2026, 10, 3);
  it("by id, within 24 hours by default; any age when the ticket is still open", () => {
    const rows = [row(1, 2), row(2, 30), row(3, 2, "someone-else")];
    expect(ownFreshEntries(rows, cell, null, "me", now).map((e) => e.id)).toEqual([1]);
    expect(
      ownFreshEntries(rows, cell, null, "me", now, { ticketOpen: true }).map((e) => e.id),
    ).toEqual([1, 2]);
    expect(ownFreshEntries(rows, cell, null, null, now, { ticketOpen: true })).toEqual([]);
  });
  it("the server says the same: an old entry of mine on a ticket I may still edit", () => {
    const inv = read("src/lib/inventory.functions.ts");
    expect(inv).toContain("stillMine = fieldEditProblem(me, job.stage, onTicket) === null;");
    expect(inv).toContain('if (me?.role !== "admin" && !(mine && (fresh || stillMine)))');
    expect(read("src/lib/service.functions.ts")).toContain(
      "qty, unit, counted_note, created_by, created_by_name, created_at",
    );
  });
});

describe("33. finger-sized targets on the close-out", () => {
  it("step dots, the list chevron, Edit / Done, repair chips and the pending thumb's links", () => {
    expect(closeout).toContain(
      "flex h-[44px] w-[44px] items-center justify-center rounded-full text-sm font-semibold",
    );
    expect(closeout).toContain(
      "flex h-[44px] w-[44px] items-center justify-center rounded-md text-muted-foreground",
    );
    expect(closeout).toContain(
      'className="h-[44px] max-w-full justify-start rounded-full px-4 text-sm"',
    );
    expect(closeout).not.toContain("flex h-7 w-7 items-center");
    const ui = read("src/components/service/picture-queue-ui.tsx");
    expect(ui).not.toContain("min-h-9 px-1 text-[11px]");
    expect(ui).toContain("min-h-[44px] px-2 text-xs font-medium text-primary");
  });
});

describe("34. a small copy of each photo", () => {
  it("thumbPathFor sits beside the picture; makeThumb is null where it cannot run (node)", async () => {
    expect(thumbPathFor("job/abc.jpg")).toBe("job/abc-thumb.jpg");
    expect(thumbPathFor("job/abc.HEIC")).toBe("job/abc-thumb.jpg");
    expect(thumbPathFor("job/noext")).toBe("job/noext-thumb.jpg");
    expect(await makeThumb(new Blob(["x"]))).toBeNull();
  });
  it("the queue uploads the copy beside the picture and registers it only when it landed; the full picture is untouched", () => {
    const q = read("src/components/service/picture-queue.ts");
    expect(q).toContain("await uploadToServiceBucket(thumbPathFor(path), small.blob, small.type);");
    expect(q).toContain(
      "thumbs.has(data.storage_path) ? { thumb_path: thumbPathFor(data.storage_path) } : {}",
    );
    expect(q).toContain("shrink: shrinkPhoto,");
    expect(serverField).toContain("thumb_path: z.string().min(1).max(300).nullable().optional(),");
    expect(serverField).toContain("export const setPhotoThumb = createServerFn");
    // Deleting a photo removes its small copy too (caught on the temporary check ticket).
    expect(serverField).toContain(
      ".remove([row.storage_path, ...(row.thumb_path ? [row.thumb_path] : [])]);",
    );
    expect(migration).toContain(
      "alter table public.service_job_photos add column if not exists thumb_path text;",
    );
  });
  it("the thumbnail shows the small copy and opens the full picture; a photo without one is backfilled once by a viewer who may", () => {
    expect(shared).toContain("const smallPath = photo.thumb_path ?? photo.storage_path;");
    expect(shared).toMatch(/<PhotoLightbox\s+photo=\{photo\}\s+url=\{fullUrl\}/);
    expect(shared).toContain(
      "if (!photo.thumb_path && canAnnotate && fullUrl) void backfillThumb(photo, fullUrl, qc);",
    );
    expect(shared).toContain("const backfilled = new Set<string>();");
  });
});

describe("35. one signing call for a ticket's photos", () => {
  it("listJobPhotos and the bundle sign every path (full + small) in one createSignedUrls call", () => {
    expect(serverField).toContain(".createSignedUrls(paths, PHOTO_LINK_SECONDS)");
    expect(serverField.match(/signPhotoPaths\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(serverField).toContain(
      "thumb_url: p.thumb_path ? (urls.get(p.thumb_path) ?? null) : null,",
    );
    expect(serverField).toContain("url?: string | null;");
  });
});

describe("36. one bundle read on open; the profile once a minute", () => {
  it("getTicketBundle reads the ticket, repairs, photos, time and timeline in parallel; the page seeds the caches", () => {
    expect(serverField).toContain("export const getTicketBundle = createServerFn");
    expect(serverField).toMatch(
      /const \[jobRes, repairs, photos, time, events, techs\] = await Promise\.all\(\[/,
    );
    const page = read("src/components/service-page.tsx");
    expect(page).toContain("const b = await bundleFn({ data: { id } });");
    expect(page).toContain("qc.setQueryData(fieldKeys.repairs(id), b.repairs);");
    expect(page).toContain("qc.setQueryData(fieldKeys.photos(id), b.photos);");
    expect(page).toContain("qc.setQueryData(fieldKeys.time(id), b.time);");
    expect(page).toContain("qc.setQueryData(fieldKeys.events(id), b.events);");
    expect(page).not.toContain("useServerFn(getServiceJob);\n  const job = useQuery");
  });
  it("the profile cache serves a second call within the TTL and forgets on demand", async () => {
    let t = 0;
    let reads = 0;
    const cache = createProfileCache({ ttlMs: 1000, now: () => t });
    const load = async () => {
      reads++;
      return { role: "user", access: ["service"], technician: true, full_name: "T", email: "t@x" };
    };
    await cache.read(load, "u1");
    await cache.read(load, "u1");
    expect(reads).toBe(1);
    t = 1001;
    await cache.read(load, "u1");
    expect(reads).toBe(2);
    cache.forget("u1");
    await cache.read(load, "u1");
    expect(reads).toBe(3);
    expect(serverField).toContain("const data = await readProfile(ctx.supabase, ctx.userId);");
    expect(read("src/lib/service.functions.ts")).toContain(
      "return readProfile(ctx.supabase, ctx.userId);",
    );
  });
});

describe("37. field reads stay fresh five minutes and never re-read on focus", () => {
  it("FIELD_READ, spread into every field read; the ticket's own read too", () => {
    expect(FIELD_STALE_MS).toBe(5 * 60_000);
    expect(FIELD_READ).toEqual({ staleTime: FIELD_STALE_MS, refetchOnWindowFocus: false });
    for (const f of [
      "closeout.tsx",
      "crew-box.tsx",
      "field-shared.tsx",
      "ticket-field-sections.tsx",
      "materials-section.tsx",
      "purchase-orders-section.tsx",
      "inspection-section.tsx",
      "inspection-draft.ts",
      "aerial-markup.tsx",
      "ticket-activity.tsx",
      "materials-pos-fold.tsx",
      "photo-select-bar.tsx",
    ]) {
      const src = read(`src/components/service/${f}`);
      expect(src, f).toContain("...FIELD_READ,");
      expect(src, f).not.toContain("staleTime: 30_000");
    }
    expect(read("src/components/service-page.tsx")).toMatch(
      /enabled: !!session,\s*refetchOnWindowFocus: false,/,
    );
  });
});

describe("45. My tickets reads the history strips with the day", () => {
  it("myDay calls site_history_summaries once and hands each card its numbers", () => {
    expect(serverField).toContain('.rpc("site_history_summaries", { p_job_ids: jobIds })');
    expect(serverField).toContain("history: histories.get(j.id) ?? null,");
    expect(read("src/components/service/today-page.tsx")).toContain(
      '<HistoryLink jobId={j.id} whenNone="hide" summary={j.history} />',
    );
    const sh = read("src/components/service/site-history.tsx");
    expect(sh).toContain("const own = useHistorySummary(jobId, !summary);");
    expect(migration).toContain(
      "create or replace function public.site_history_summaries(p_job_ids uuid[])",
    );
  });
});

describe("46. History at this property: ten, then Show more", () => {
  it("the fold reads the newest ten; Show more reads every ticket; the SQL caps on the server", () => {
    const fns = read("src/lib/service-history.functions.ts");
    expect(fns).toContain("export const HISTORY_FIRST_TICKETS = 10;");
    expect(fns).toContain("{ p_job_id: data.id, p_limit: data.limit }");
    const sh = read("src/components/service/site-history.tsx");
    expect(sh).toContain(
      "fn({ data: all ? { id: jobId } : { id: jobId, limit: HISTORY_FIRST_TICKETS } })",
    );
    expect(sh).toContain('data-line="history-more"');
    expect(migration).toContain(
      "create or replace function public.site_history(p_job_id uuid, p_limit integer)",
    );
    expect(migration).toContain("where p_limit is null or t.n <= p_limit;");
  });
});
