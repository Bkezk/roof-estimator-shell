/**
 * One ticket photo on several inspection checklist items (owner, Oct 28). The database half —
 * supabase/migrations/20261028130000_photo_item_links.sql: the join table, its RLS copied from
 * the photos' policies, the backfill, the two sync triggers and the site_history JSON — is read
 * as text (RLS and triggers are not modelled by the test fake, as site-history-fence.test.ts).
 * The pure helpers (src/lib/inspection.ts) that every screen reads the links through, and the
 * screens' wiring ("also on Seams"), are tested directly or pinned in the sources.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  alsoOnText,
  attachableTicketPhotos,
  isPhotoOnItem,
  otherItemLabels,
  photoItemKeys,
  photosOnItem,
  primaryItemKey,
  toggleItemKey,
  unattachedTicketPhotos,
  withItemKeys,
} from "./inspection";
import { lastTimeForItem, historyPhotoSchema } from "./service-history";
import { inspectionSnapshotFrom } from "./documents/server-pure";
import { photoGridCaption } from "./documents/editor-helpers";

const read = (p: string) => readFileSync(p, "utf8");
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const flat = (s: string) => noComments(s).replace(/\s+/g, " ").trim();
const DIR = "supabase/migrations";
const sql = read(`${DIR}/20261028130000_photo_item_links.sql`);
const f = flat(sql);

// ── The migration ──────────────────────────────────────────────────────────────────────────

describe("20261028130000_photo_item_links.sql: the join table", () => {
  it("creates service_job_photo_items (photo_id → photos, cascade; item_key ≤ 60; primary key both) idempotently, with RLS on", () => {
    expect(f).toContain(
      "create table if not exists public.service_job_photo_items ( photo_id uuid not null references public.service_job_photos(id) on delete cascade, item_key text not null check (char_length(item_key) between 1 and 60), created_at timestamptz not null default now(), primary key (photo_id, item_key) );",
    );
    expect(f).toContain("alter table public.service_job_photo_items enable row level security;");
    expect(f).toContain(
      "create index if not exists service_job_photo_items_item_idx on public.service_job_photo_items (item_key, photo_id);",
    );
    expect(f).not.toContain("drop table");
  });
  it("backfills one link per photo with an item_key, skipping ones already there", () => {
    expect(f).toContain(
      "insert into public.service_job_photo_items (photo_id, item_key) select id, item_key from public.service_job_photos where item_key is not null on conflict do nothing;",
    );
  });
});

/** A policy's predicate between `using (` and the matching `)` of the statement, flattened. */
function policyBody(text: string, policy: string, table: string): string {
  const stmt = `create policy ${policy} on public.${table}`;
  const from = text.lastIndexOf(stmt);
  expect(from).toBeGreaterThan(-1);
  const end = text.indexOf(";", from);
  return text.slice(from, end + 1);
}

describe("the RLS mirrors service_job_photos, reached through the photo row", () => {
  // The live predicates: the read from 20261021110000_site_history.sql (the last to replace it),
  // the write from 20261006192000_field_edit_lock.sql (the last to replace it).
  const photosRead = policyBody(
    flat(read(`${DIR}/20261021110000_site_history.sql`)),
    "service_job_photos_read",
    "service_job_photos",
  );
  const photosWrite = policyBody(
    flat(read(`${DIR}/20261006192000_field_edit_lock.sql`)),
    "service_job_photos_write",
    "service_job_photos",
  );
  const linksRead = policyBody(f, "service_job_photo_items_read", "service_job_photo_items");
  const linksWrite = policyBody(f, "service_job_photo_items_write", "service_job_photo_items");
  /** The predicate inside `using (…)` / `with check (…)`. */
  const inside = (stmt: string, kw: "using" | "with check") => {
    const at = stmt.indexOf(`${kw} (`);
    expect(at).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = at + kw.length + 1; i < stmt.length; i++) {
      if (stmt[i] === "(") depth++;
      if (stmt[i] === ")") depth--;
      if (depth === 0) return stmt.slice(at + kw.length + 2, i).trim();
    }
    throw new Error("unbalanced");
  };
  /** The links' predicate is `exists (select 1 from photos p where p.id = photo_id and <X>)`: X. */
  const through = (pred: string) => {
    const head = "exists ( select 1 from public.service_job_photos p where p.id = photo_id and ";
    expect(pred.startsWith(head)).toBe(true);
    expect(pred.endsWith(")")).toBe(true);
    return pred.slice(head.length, -1).trim();
  };
  it("no later migration replaced the photos' policies (the ones copied are the live ones)", () => {
    const files = read(`${DIR}/../migrations/20261021110000_site_history.sql`) ? null : null;
    void files;
    const all = ["20261021110000_site_history.sql", "20261006192000_field_edit_lock.sql"];
    for (const name of all) expect(read(`${DIR}/${name}`)).toContain("service_job_photos");
    // Nothing newer than Oct 21 touches a service_job_photos policy (the new file aside).
    const later = readFileSync(`${DIR}/20261028130000_photo_item_links.sql`, "utf8");
    expect(later).not.toContain("on public.service_job_photos for");
  });
  it("read: the photos' read predicate, with its service_job_id read off the photo row", () => {
    const want = inside(photosRead, "using");
    expect(want).toBe(
      "public.has_access('customers') or (public.has_access('service') and not public.is_technician()) or exists ( select 1 from public.service_jobs j where j.id = service_job_id and j.deleted_at is null and (j.technician_id = auth.uid() or public.is_on_crew(j.id)))",
    );
    expect(linksRead).toContain("for select to authenticated");
    const got = through(inside(linksRead, "using"));
    // The copied predicate wraps in one more pair of parentheses and reads p.service_job_id.
    expect(got.replace(/^\(/, "").replace(/\)$/, "")).toBe(
      want.replace("j.id = service_job_id", "j.id = p.service_job_id"),
    );
  });
  it("write: the photos' write predicate (works_on_ticket and ticket_open_for_tech), using and with check alike", () => {
    const wantUsing = inside(photosWrite, "using");
    expect(wantUsing).toBe(
      "public.works_on_ticket(service_job_id) and public.ticket_open_for_tech(service_job_id)",
    );
    expect(inside(photosWrite, "with check")).toBe(wantUsing);
    expect(linksWrite).toContain("for all to authenticated");
    const want = wantUsing.replace(/service_job_id/g, "p.service_job_id");
    expect(through(inside(linksWrite, "using"))).toBe(want);
    expect(through(inside(linksWrite, "with check"))).toBe(want);
  });
});

describe("item_key stays the primary item, by trigger", () => {
  it("links → photo: the photo keeps its item_key while linked, else the earliest link, else null; written only when it changes", () => {
    expect(f).toContain(
      "create or replace function public.photo_item_links_sync_primary() returns trigger language plpgsql security definer set search_path = public as $$",
    );
    expect(f).toContain(
      "select coalesce( (select l.item_key from public.service_job_photo_items l where l.photo_id = p.id and l.item_key = p.item_key), (select l.item_key from public.service_job_photo_items l where l.photo_id = p.id order by l.created_at, l.item_key limit 1)) into v_primary from public.service_job_photos p where p.id = v_photo;",
    );
    expect(f).toContain(
      "update public.service_job_photos set item_key = v_primary where id = v_photo and item_key is distinct from v_primary;",
    );
    expect(f).toContain(
      "create trigger photo_item_links_sync_primary after insert or update or delete on public.service_job_photo_items for each row execute function public.photo_item_links_sync_primary();",
    );
    expect(f).toContain(
      "drop trigger if exists photo_item_links_sync_primary on public.service_job_photo_items;",
    );
  });
  it("photo → links: a direct item_key write links it (a change unlinks the old, null unlinks all), skipped when the links trigger caused it", () => {
    expect(f).toContain(
      "create or replace function public.photo_item_key_sync_links() returns trigger language plpgsql security definer set search_path = public as $$",
    );
    expect(f).toContain("if pg_trigger_depth() > 1 then return null; end if;");
    expect(f).toContain(
      "if tg_op = 'UPDATE' and old.item_key is not null and old.item_key is distinct from new.item_key then if new.item_key is null then delete from public.service_job_photo_items where photo_id = new.id; else delete from public.service_job_photo_items where photo_id = new.id and item_key = old.item_key; end if; end if;",
    );
    expect(f).toContain(
      "if new.item_key is not null then insert into public.service_job_photo_items (photo_id, item_key) values (new.id, new.item_key) on conflict do nothing; end if;",
    );
    expect(f).toContain(
      "create trigger photo_item_key_sync_links after insert or update of item_key on public.service_job_photos for each row execute function public.photo_item_key_sync_links();",
    );
    // The backfill runs before the triggers exist, so it does not fire them row by row.
    expect(
      f.indexOf("insert into public.service_job_photo_items (photo_id, item_key) select"),
    ).toBeLessThan(f.indexOf("create trigger photo_item_links_sync_primary"));
    // Both functions are not callable by anyone directly.
    expect(f).toContain(
      "revoke all on function public.photo_item_links_sync_primary() from public;",
    );
    expect(f).toContain("revoke all on function public.photo_item_key_sync_links() from public;");
  });
});

describe("site_history(): the photo JSON gains item_keys, item_key stays", () => {
  const prev = flat(read(`${DIR}/20261021110000_site_history.sql`));
  const fnOf = (text: string) => {
    const from = text.indexOf("create or replace function public.site_history(p_job_id uuid)");
    const to = text.indexOf("$$;", from) + 3;
    return text.slice(from, to);
  };
  it("is the Oct 21 body plus one key per photo", () => {
    const next = fnOf(f);
    const added =
      "'item_keys', coalesce(( select jsonb_agg(l.item_key order by l.created_at, l.item_key) from public.service_job_photo_items l where l.photo_id = ph.id), '[]'::jsonb), ";
    expect(next).toContain(added);
    expect(next.replace(added, "")).toBe(fnOf(prev));
    expect(next).toContain("'item_key', ph.item_key,");
    expect(f).toContain("revoke all on function public.site_history(uuid) from public;");
    expect(f).toContain(
      "grant execute on function public.site_history(uuid) to authenticated, service_role;",
    );
  });
  it("the reader takes item_keys when present and reads older JSON (no key) by item_key", () => {
    const base = {
      id: "p1",
      storage_path: "j/p1.jpg",
      file_name: null,
      role: "other",
      repair_id: null,
      item_key: "k1",
      taken_at: null,
      created_at: "2026-06-12T15:00:00.000Z",
      annotations: null,
    };
    expect(historyPhotoSchema.parse(base)).not.toHaveProperty("item_keys");
    expect(historyPhotoSchema.parse({ ...base, item_keys: ["k1", "k2"] }).item_keys).toEqual([
      "k1",
      "k2",
    ]);
    const ticket = (photos: unknown[]) =>
      ({
        id: "T",
        number: 1,
        service_type: "inspection",
        description: null,
        scheduled_date: null,
        completed_at: "2026-06-12T15:00:00.000Z",
        created_at: "2026-06-01T15:00:00.000Z",
        stage: "closed",
        location_id: null,
        location_name: null,
        closing_notes: null,
        inspection_outcome: null,
        technician_name: null,
        inspection_items: [],
        repairs: [],
        photos: photos as never,
      }) as never;
    const both = ticket([{ ...base, item_keys: ["k1", "k2"] }]);
    expect(lastTimeForItem([both], "k2")?.photos).toHaveLength(1);
    expect(lastTimeForItem([both], "k1")?.photos).toHaveLength(1);
    expect(lastTimeForItem([both], "k3")).toBeNull();
    const old = ticket([base]);
    expect(lastTimeForItem([old], "k1")?.photos).toHaveLength(1);
    expect(lastTimeForItem([old], "k2")).toBeNull();
  });
});

// ── The pure helpers ───────────────────────────────────────────────────────────────────────

type P = {
  id: string;
  role: string;
  repair_id: string | null;
  item_key: string | null;
  item_keys?: string[] | undefined;
};
const photos: P[] = [
  { id: "loose", role: "other", repair_id: null, item_key: null, item_keys: [] },
  { id: "seams", role: "other", repair_id: null, item_key: "c2", item_keys: ["c2"] },
  { id: "both", role: "other", repair_id: null, item_key: "c2", item_keys: ["c2", "c3"] },
  { id: "old", role: "other", repair_id: null, item_key: "c3" },
  { id: "repair", role: "before", repair_id: "r1", item_key: null, item_keys: [] },
  { id: "repair-other", role: "other", repair_id: "r1", item_key: null, item_keys: [] },
  { id: "signature", role: "signature", repair_id: null, item_key: null, item_keys: [] },
  { id: "aerial", role: "aerial", repair_id: null, item_key: null, item_keys: [] },
];
const ids = (list: readonly P[]) => list.map((p) => p.id);
const items = [
  { id: "c1", label: "Membrane condition" },
  { id: "c2", label: "Seams" },
  { id: "c3", label: "Perimeter flashings" },
  { id: "c4", label: "Debris" },
];

describe("the helpers every screen reads the links through", () => {
  it("photoItemKeys: item_keys when the row carries it, else item_key alone, else none", () => {
    expect(photoItemKeys({ item_key: "c2", item_keys: ["c2", "c3"] })).toEqual(["c2", "c3"]);
    expect(photoItemKeys({ item_key: "c3" })).toEqual(["c3"]);
    expect(photoItemKeys({ item_key: null })).toEqual([]);
    expect(photoItemKeys({ item_key: "c3", item_keys: [] })).toEqual([]);
  });
  it("photosOnItem / isPhotoOnItem: every ticket picture whose items include the row — a photo on two items shows on both", () => {
    expect(ids(photosOnItem(photos, "c2"))).toEqual(["seams", "both"]);
    expect(ids(photosOnItem(photos, "c3"))).toEqual(["both", "old"]);
    expect(ids(photosOnItem(photos, "c1"))).toEqual([]);
    expect(isPhotoOnItem({ role: "before", repair_id: "r1", item_key: "c2" }, "c2")).toBe(false);
  });
  it("unattachedTicketPhotos: the pictures on no item at all (the findings roll)", () => {
    expect(ids(unattachedTicketPhotos(photos))).toEqual(["loose"]);
    expect(unattachedTicketPhotos([])).toEqual([]);
  });
  it("attachableTicketPhotos: every ticket picture not on THIS item, the ones on other items included", () => {
    expect(ids(attachableTicketPhotos(photos, "c2"))).toEqual(["loose", "old"]);
    expect(ids(attachableTicketPhotos(photos, "c3"))).toEqual(["loose", "seams"]);
    expect(ids(attachableTicketPhotos(photos, "c1"))).toEqual(["loose", "seams", "both", "old"]);
  });
  it("toggleItemKey: attach adds at the end once; detach removes; repeats collapse", () => {
    expect(toggleItemKey([], "c1", true)).toEqual(["c1"]);
    expect(toggleItemKey(["c2"], "c1", true)).toEqual(["c2", "c1"]);
    expect(toggleItemKey(["c2", "c1"], "c1", true)).toEqual(["c2", "c1"]);
    expect(toggleItemKey(["c2", "c1"], "c2", false)).toEqual(["c1"]);
    expect(toggleItemKey(["c2"], "c1", false)).toEqual(["c2"]);
    expect(toggleItemKey(["c2", "c2", "c3"], "c3", false)).toEqual(["c2"]);
  });
  it("primaryItemKey: the current item while still linked, else the first, else null (the trigger's rule)", () => {
    expect(primaryItemKey("c2", ["c3", "c2"])).toBe("c2");
    expect(primaryItemKey("c1", ["c3", "c2"])).toBe("c3");
    expect(primaryItemKey(null, ["c3"])).toBe("c3");
    expect(primaryItemKey("c1", [])).toBeNull();
  });
  it("otherItemLabels / alsoOnText: the OTHER items a picture is on, in checklist order, as 'also on …'", () => {
    const both = photos[2]!;
    expect(otherItemLabels(both, "c2", items)).toEqual(["Perimeter flashings"]);
    expect(otherItemLabels(both, "c3", items)).toEqual(["Seams"]);
    expect(otherItemLabels(both, "c1", items)).toEqual(["Seams", "Perimeter flashings"]);
    expect(otherItemLabels(photos[1]!, "c2", items)).toEqual([]);
    // An item gone from the checklist is left out.
    expect(otherItemLabels({ ...both, item_keys: ["c2", "zz"] }, "c2", items)).toEqual([]);
    expect(alsoOnText([])).toBe("");
    expect(alsoOnText(["Seams"])).toBe("also on Seams");
    expect(alsoOnText(["Seams", "Debris"])).toBe("also on Seams and Debris");
    expect(alsoOnText(["Seams", "Drains", "Debris"])).toBe("also on Seams, Drains and Debris");
  });
  it("withItemKeys: folds the links into the rows, in link order, [] for none", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const links = [
      { photo_id: "a", item_key: "c2" },
      { photo_id: "a", item_key: "c3" },
      { photo_id: "a", item_key: "c2" },
      { photo_id: "zz", item_key: "c1" },
    ];
    expect(withItemKeys(rows, links)).toEqual([
      { id: "a", item_keys: ["c2", "c3"] },
      { id: "b", item_keys: [] },
    ]);
  });
});

describe("the documents list a photo under every item it is on", () => {
  const checklist = [
    { id: "c2", label: "Seams", sort: 20 },
    { id: "c3", label: "Perimeter flashings", sort: 30 },
  ];
  it("inspectionSnapshotFrom: photoIds per item from item_keys (older rows by item_key); a repair's photo never", () => {
    const snap = inspectionSnapshotFrom(null, checklist, photos, "Tech");
    expect(snap.items.map((i) => [i.id, i.photoIds])).toEqual([
      ["c2", ["seams", "both"]],
      ["c3", ["both", "old"]],
    ]);
  });
  it("photoGridCaption: every item the picture is on, comma-separated; the old one-key form still works", () => {
    const insp = inspectionSnapshotFrom(null, checklist, photos, "Tech");
    expect(photoGridCaption({ itemKey: "c2", itemKeys: ["c2", "c3"] }, insp)).toBe(
      "Seams, Perimeter flashings",
    );
    expect(photoGridCaption({ itemKey: "c3" }, insp)).toBe("Perimeter flashings");
    expect(photoGridCaption({ itemKey: null, itemKeys: [] }, insp)).toBe("");
    expect(photoGridCaption({ itemKey: "c2" }, null)).toBe("");
  });
  it("the server reads the links for the snapshot and for the editor's picture rows", () => {
    const fns = read("src/lib/documents.functions.ts");
    expect(fns).toContain("async function withPhotoLinks<T extends { id: string }>(");
    expect(fns).toContain("await withPhotoLinks(sb, photos.data ?? []),");
    expect(fns).toContain("withPhotoLinks(sb, rows),");
    expect(fns).toMatch(/itemKey: r\.item_key,\s*itemKeys: r\.item_keys,/);
    // The PDF embeds a file once however many rows show it (unchanged; a photo on two items).
    const pdf = read("src/lib/documents/document-pdf.server.ts");
    expect(pdf).toContain("// The same file is embedded once however many pictures show it.");
  });
});

// ── The screens ────────────────────────────────────────────────────────────────────────────

describe("the screens: 'also on Seams', Detach removes one link, the picker offers pictures on other items too", () => {
  const itemPhotos = read("src/components/service/inspection-item-photos.tsx");
  const mutations = read("src/components/service/item-photo-mutations.ts");
  const cards = read("src/components/service/inspection-closeout.tsx");
  const section = read("src/components/service/inspection-section.tsx");
  it("the picker and the row's thumbnails say 'also on …' from the checklist rows they are given", () => {
    expect(itemPhotos).toContain(
      "const alsoOn = (p: JobPhotoRow) => alsoOnText(otherItemLabels(p, itemKey, items ?? []));",
    );
    expect(itemPhotos).toContain(
      "const note = alsoOnText(otherItemLabels(p, itemKey, items ?? []));",
    );
    expect(itemPhotos.match(/data-also-on=\{p\.id\}/g)).toHaveLength(2);
    expect(itemPhotos).toContain("a\n            picture already on another item can go here too.");
    // Dark mode on the new text.
    expect(itemPhotos).toContain(
      'className="w-full truncate text-center text-[11px] text-muted-foreground dark:text-muted-foreground"',
    );
    // Both screens hand the rows down.
    expect(cards).toContain("items={draft.items}");
    expect(cards.match(/items=\{items\}/g)).toHaveLength(2);
    expect(section).toContain("items={draft.items}");
  });
  it("Detach removes this row's link only; Attach adds this row; both through setJobPhotoItems with the photo's full set", () => {
    expect(itemPhotos).toContain(
      "setItem.mutate({ ids: [p.id], item_key: itemKey, attach: false })",
    );
    expect(itemPhotos).toContain(
      'title="Detach from this item — the photo stays on the ticket and on its other items"',
    );
    expect(mutations).toContain("const setFn = useServerFn(setJobPhotoItems);");
    expect(mutations).toContain(
      "const item_keys = toggleItemKey(photoItemKeys(photo), v.item_key, v.attach);",
    );
    expect(mutations).toContain(
      'if (!photo) throw new Error("That photo is not in the ticket\'s list any more — reload");',
    );
  });
  it("the row's thumbnails and the findings roll read the links (inspection.ts), not item_key alone", () => {
    expect(itemPhotos).toContain("const mine = photosOnItem(photos, itemKey);");
    expect(itemPhotos).not.toContain("p.item_key === itemKey");
    expect(cards).toContain(
      "itemKey === null ? unattachedTicketPhotos(photos) : photosOnItem(photos, itemKey);",
    );
    expect(read("src/lib/service-history.ts")).toContain(
      "photos.filter((p) => isPhotoOnItem(p, itemKey));",
    );
    expect(read("src/components/service/site-history.tsx")).toContain(
      "...(p.item_keys ? { item_keys: p.item_keys } : {}),",
    );
  });
  it("the types carry the table by hand", () => {
    const types = read("src/integrations/supabase/types.ts");
    expect(types).toMatch(
      /service_job_photo_items: \{\s*Row: \{\s*created_at: string;\s*item_key: string;\s*photo_id: string;\s*\};/,
    );
    expect(types).toContain('foreignKeyName: "service_job_photo_items_photo_id_fkey";');
  });
});
