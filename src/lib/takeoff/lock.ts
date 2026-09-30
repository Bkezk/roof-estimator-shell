/**
 * Takeoff lock (owner, Sep 30): "when you go back into a takeoff and you go to save again it
 * should save as a new takeoff if the original takeoff was associated with a bid. We don't want a
 * mis-click on a takeoff recalculating an existing bid."
 *
 * A takeoff whose `bid_id` is set built a bid and is LOCKED: the editor opens it read-only (no
 * drawing, no Setup / Objects edits, no autosave) and the server refuses any change to its
 * drawing. To measure again the user makes a copy ("Edit a copy"): a new, unlocked takeoff with
 * the same pages, objects, setup and plan file, no bid, and `setup.copiedFrom` saying where it
 * came from. The copy's own Create bid makes a NEW bid; updating the original's bid from the copy
 * is offered only behind a confirmation that names the bid and lists the measured changes.
 *
 * Everything here is pure (no I/O) so the rules are unit-tested; the server functions
 * (src/lib/takeoff.functions.ts) and the editor use these.
 */
import type { TakeoffQuantities, TakeoffSetup } from "./model";

/** The first words of every lock refusal (the editor looks for them to refresh its lock state). */
export const TAKEOFF_LOCKED = "This takeoff is locked";

/** Where a copy came from (kept in the copy's setup jsonb, not a column). */
export interface CopiedFrom {
  takeoffId: string;
  /** The bid the original had built when it was copied (null: it had none). */
  bidId: string | null;
  /** ISO time of the copy. */
  at: string;
}

/** Bookkeeping the lock keeps in `setup`: never material answers, never copied between takeoffs. */
export interface TakeoffLockMeta {
  copiedFrom?: CopiedFrom;
  /** ISO time the takeoff was linked to the bid it built (set by the server). */
  lockedAt?: string;
}
const META_KEYS = ["copiedFrom", "lockedAt"] as const;

/** A takeoff is locked once it has built a bid (its `bid_id` is set). */
export function isTakeoffLocked(row: { bid_id?: string | null | undefined } | null | undefined) {
  return !!row?.bid_id;
}

/** The lock bookkeeping in a setup (anything malformed reads as absent). */
export function lockMeta(setup: unknown): TakeoffLockMeta {
  if (!setup || typeof setup !== "object" || Array.isArray(setup)) return {};
  const s = setup as { copiedFrom?: unknown; lockedAt?: unknown };
  const out: TakeoffLockMeta = {};
  const c = s.copiedFrom as { takeoffId?: unknown; bidId?: unknown; at?: unknown } | undefined;
  if (c && typeof c === "object" && typeof c.takeoffId === "string" && typeof c.at === "string")
    out.copiedFrom = {
      takeoffId: c.takeoffId,
      bidId: typeof c.bidId === "string" ? c.bidId : null,
      at: c.at,
    };
  if (typeof s.lockedAt === "string") out.lockedAt = s.lockedAt;
  return out;
}

/** The setup without the lock bookkeeping ("Use the setup from …" copies only the answers). */
export function withoutLockMeta<T extends object>(setup: T): T {
  const nx = { ...setup } as Record<string, unknown>;
  for (const k of META_KEYS) delete nx[k];
  return nx as T;
}

/** Fields saveTakeoff may change on a locked takeoff (plus bid_id, see lockedSaveRefusal). */
export const LOCKED_EDITABLE = ["name", "status", "account_id"] as const;
/** Fields that change the drawing (what a bid is built from): refused on a locked takeoff. */
export const DRAWING_FIELDS = ["pages", "setup", "objects", "building_id"] as const;

/** What the server knows about the bid a locked takeoff built. */
export type BidPresence = "exists" | "gone" | "unknown";

/**
 * Why saveTakeoff must refuse `input` on a takeoff whose current bid link is `currentBidId`, or
 * null when the save may go ahead. An unlocked takeoff accepts anything. A locked one accepts a
 * rename, a status change and a customer link; re-sending its own bid id (a no-op); and clearing
 * the bid link only when the bid it built no longer exists (`bid` = "gone").
 */
export function lockedSaveRefusal(
  input: Partial<Record<(typeof DRAWING_FIELDS)[number] | "bid_id", unknown>>,
  currentBidId: string | null | undefined,
  bid: BidPresence = "unknown",
): string | null {
  if (!currentBidId) return null;
  const drawing = DRAWING_FIELDS.filter((k) => input[k] !== undefined);
  if (drawing.length)
    return `${TAKEOFF_LOCKED}: it built a bid, so its drawing (${drawing.join(", ")}) cannot change. Use "Edit a copy" to measure again.`;
  if (input.bid_id === undefined || input.bid_id === currentBidId) return null;
  if (input.bid_id === null) {
    if (bid === "gone") return null;
    return bid === "exists"
      ? `${TAKEOFF_LOCKED}: the bid it built still exists, so the link cannot be cleared.`
      : `${TAKEOFF_LOCKED}: only someone who can see bids can clear its link to the bid it built.`;
  }
  return `${TAKEOFF_LOCKED}: it already built another bid. Use "Edit a copy" to build a new one.`;
}

/**
 * The setup to store when the bid link changes: linking a bid stamps `lockedAt`, clearing it
 * removes the stamp. Null = leave the setup as it is.
 */
export function setupForLinkChange(
  setup: unknown,
  prevBidId: string | null | undefined,
  nextBidId: string | null | undefined,
  now: string,
): Record<string, unknown> | null {
  if (nextBidId === undefined || (nextBidId ?? null) === (prevBidId ?? null)) return null;
  const base: { lockedAt?: string; [k: string]: unknown } =
    setup && typeof setup === "object" && !Array.isArray(setup)
      ? { ...(setup as Record<string, unknown>) }
      : {};
  if (nextBidId) base.lockedAt = now;
  else delete base.lockedAt;
  return base;
}

/**
 * The copy's name: "<name> (copy)", then "(copy 2)", "(copy 3)"… — unique (ignoring case and
 * spaces) among `existingNames`. Copying a copy does not stack: "Roof (copy)" → "Roof (copy 2)".
 */
export function copyTakeoffName(name: string, existingNames: readonly string[]): string {
  const base =
    name
      .trim()
      .replace(/\s*\(copy(?:\s+\d+)?\)$/i, "")
      .trim() || "Untitled takeoff";
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? " (copy)" : ` (copy ${n})`;
    const candidate = `${base.slice(0, 200 - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** The source row fields a copy is made from. */
export interface CopySource {
  id: string;
  name: string;
  underlay_kind: string;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  pages: unknown;
  setup: unknown;
  objects: unknown;
  building_id: string | null;
  account_id: string | null;
  bid_id: string | null;
}

/**
 * The new row for "Edit a copy": the same plan file (the same storage object — the bucket's read
 * policy is by bucket, not by path, so the copy may read it), pages, objects, setup, customer and
 * building; its own name; no bid; Draft; and `setup.copiedFrom`.
 */
export function copyTakeoffRow(
  src: CopySource,
  opts: { name: string; now: string; userId: string; updatedByName: string | null },
) {
  const setup =
    src.setup && typeof src.setup === "object" && !Array.isArray(src.setup)
      ? withoutLockMeta(src.setup as Record<string, unknown>)
      : {};
  const copiedFrom: CopiedFrom = { takeoffId: src.id, bidId: src.bid_id ?? null, at: opts.now };
  return {
    name: opts.name,
    status: "draft",
    underlay_kind: src.underlay_kind,
    file_path: src.file_path,
    file_name: src.file_name,
    file_size: src.file_size,
    pages: structuredClone(Array.isArray(src.pages) ? src.pages : []),
    objects: structuredClone(Array.isArray(src.objects) ? src.objects : []),
    setup: { ...structuredClone(setup), copiedFrom },
    building_id: src.building_id,
    account_id: src.account_id,
    bid_id: null,
    created_by: opts.userId,
    updated_by_name: opts.updatedByName,
  };
}

/**
 * The autosave guard: a change is sent only when the takeoff is not locked and the value differs
 * from the one loaded. A locked takeoff never autosaves (the server would refuse it anyway).
 */
export function shouldAutosave(opts: { locked: boolean; changed: boolean }): boolean {
  return !opts.locked && opts.changed;
}

/** Drawing tools a locked takeoff still offers: look and measure, never change. */
export const READ_ONLY_TOOLS = ["select", "dimension"] as const;
export function toolAllowed(tool: string, locked: boolean): boolean {
  return !locked || (READ_ONLY_TOOLS as readonly string[]).includes(tool);
}

/** The bid actions the editor's header offers. */
export interface BidActions {
  /** "Create bid": a NEW bid from this drawing. */
  createBid: boolean;
  /** "Edit a copy" (locked takeoffs only). */
  editCopy: boolean;
  /**
   * "Update bid …" on a copy whose original built that bid: always behind the confirmation
   * dialog (never one click, never Enter, never autosave). Null when not offered.
   */
  updateBid: { bidId: string; bidName: string; needsConfirm: true } | null;
}
export function bidActions(opts: {
  locked: boolean;
  /** The bid the copy's original built, when this takeoff is a copy and that bid is visible. */
  originBid: { id: string; name: string } | null;
}): BidActions {
  if (opts.locked) return { createBid: false, editCopy: true, updateBid: null };
  return {
    createBid: true,
    editCopy: false,
    updateBid: opts.originBid
      ? { bidId: opts.originBid.id, bidName: opts.originBid.name, needsConfirm: true }
      : null,
  };
}

const n1 = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 1 });
const same = (a: number, b: number) => Math.abs(a - b) < 0.05;
const key = (s: string) => s.trim().toLowerCase();

/**
 * What an update would change in the bid, as lines for the confirmation dialog: the measured
 * quantities of the takeoff that built the bid (`before`) against this drawing (`after`), matched
 * by name the way `applyTakeoffToBid` matches them (sections, parapets and other lines, counts).
 */
export function takeoffChangeList(before: TakeoffQuantities, after: TakeoffQuantities): string[] {
  const out: string[] = [];

  const bS = new Map(before.sections.map((s) => [key(s.name), s] as const));
  const aS = new Map(after.sections.map((s) => [key(s.name), s] as const));
  for (const [k, a] of aS) {
    const b = bS.get(k);
    if (!b) {
      out.push(
        `Section “${a.name}” added: ${n1(a.areaSqFt)} sq ft, ${n1(a.perimeterFt)} ft around.`,
      );
      continue;
    }
    const parts: string[] = [];
    if (!same(a.areaSqFt, b.areaSqFt)) parts.push(`${n1(b.areaSqFt)} → ${n1(a.areaSqFt)} sq ft`);
    if (!same(a.perimeterFt, b.perimeterFt))
      parts.push(`${n1(b.perimeterFt)} → ${n1(a.perimeterFt)} ft around`);
    if (a.edgeLengthsFt.length !== b.edgeLengthsFt.length)
      parts.push(`${b.edgeLengthsFt.length} → ${a.edgeLengthsFt.length} sides`);
    if (parts.length) out.push(`Section “${a.name}”: ${parts.join(", ")}.`);
  }
  for (const [k, b] of bS) if (!aS.has(k)) out.push(`Section “${b.name}” removed.`);

  const lKey = (l: { role: string; name: string }) => `${l.role}|${key(l.name)}`;
  const bL = new Map(before.linears.map((l) => [lKey(l), l] as const));
  const aL = new Map(after.linears.map((l) => [lKey(l), l] as const));
  for (const [k, a] of aL) {
    const b = bL.get(k);
    if (!b) out.push(`“${a.name}” added: ${n1(a.lengthFt)} ft.`);
    else {
      const parts: string[] = [];
      if (!same(a.lengthFt, b.lengthFt)) parts.push(`${n1(b.lengthFt)} → ${n1(a.lengthFt)} ft`);
      if ((a.heightIn ?? 0) !== (b.heightIn ?? 0))
        parts.push(`wall ${n1(b.heightIn ?? 0)} → ${n1(a.heightIn ?? 0)} in`);
      if (parts.length) out.push(`“${a.name}”: ${parts.join(", ")}.`);
    }
  }
  for (const [k, b] of bL) if (!aL.has(k)) out.push(`“${b.name}” removed.`);

  const cKey = (c: { role: string; name: string }) => `${c.role}|${key(c.name)}`;
  const sumBy = (q: TakeoffQuantities) => {
    const m = new Map<string, { name: string; qty: number }>();
    for (const c of q.counts) {
      const cur = m.get(cKey(c));
      if (cur) cur.qty += c.qty;
      else m.set(cKey(c), { name: c.name, qty: c.qty });
    }
    return m;
  };
  const bC = sumBy(before);
  const aC = sumBy(after);
  for (const [k, a] of aC) {
    const b = bC.get(k);
    if (!b) out.push(`${a.qty} × “${a.name}” added.`);
    else if (a.qty !== b.qty) out.push(`“${a.name}”: ${b.qty} → ${a.qty}.`);
  }
  for (const [k, b] of bC) if (!aC.has(k)) out.push(`“${b.name}” (${b.qty}) removed.`);
  return out;
}

/** The locked editor's banner. */
export function lockBannerText(bidName: string | null, builtAt: string | null): string {
  const bid = bidName ? `bid “${bidName}”` : "a bid";
  const when = builtAt
    ? ` on ${new Date(builtAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "";
  return `This takeoff built ${bid}${when}. It is locked so a slip cannot change that bid. To measure again, edit a copy.`;
}

/** The one-time notice when a takeoff becomes locked by building a bid. */
export function lockedToast(bidName: string | null): string {
  return `Takeoff locked: it built ${bidName ? `“${bidName}”` : "a bid"}. Edit a copy to measure again.`;
}
