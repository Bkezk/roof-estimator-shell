import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Json } from "@/integrations/supabase/types";
import { isAdmin, isManager } from "@/lib/access";
import {
  asBidStatus,
  BID_STATUSES,
  bidDueDateProblem,
  bidOfficeToday,
  bidReminderColumns,
  bidStatusStamps,
  wonOnColumns,
} from "@/lib/bid-status";
import { bidFiguresSchema } from "@/lib/bid-figures";
import { assertPricingRead } from "@/lib/auth.functions";
import { liveLockHeldElsewhere } from "@/lib/bid-locks.functions";
import { folderKey, folderOptions, normalizeFolder } from "@/lib/bids-folders";
import { bidSaveIsStale, bidStaleMessage } from "@/lib/bid-stale-save";
import { duplicateBidRow } from "@/lib/duplicate-bid";
import { syncOpportunityFromBid } from "@/lib/opportunities.functions";

// All bid operations require a signed-in user. The user-scoped Supabase client
// from the auth middleware runs under RLS, so the database is the final guard.
export const listBids = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // The linked customer's name rides along so the list can show, search and sort by it
    // (owner, Sep 30: "make it to where you can sort bids by customers").
    const { data, error } = await context.supabase
      .from("bids")
      .select("*, account:crm_accounts!bids_account_id_fkey(id, name)")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    // The opportunity a bid was started from (bids.opportunity_id; owner, Oct 12: "From
    // opportunity: <title>" on the row). Read under the opportunities' own RLS; one that cannot be
    // read is left null.
    const oppIds = [
      ...new Set((data ?? []).map((b) => b.opportunity_id).filter((x): x is string => !!x)),
    ];
    const titles = new Map<string, string>();
    if (oppIds.length) {
      const { data: opps } = await context.supabase
        .from("crm_opportunities")
        .select("id, title")
        .in("id", oppIds);
      for (const o of opps ?? []) titles.set(o.id, o.title);
    }
    return (data ?? []).map((b) => ({
      ...b,
      opportunity: b.opportunity_id
        ? { id: b.opportunity_id, title: titles.get(b.opportunity_id) ?? null }
        : null,
    }));
  });

/** Soft-deleted bids are kept this long, then purged (lazily, whenever the bin is listed). */
export const DELETED_BID_RETENTION_DAYS = 30;

/** The "Recently deleted" bin: soft-deleted bids still inside the retention window. */
export const listDeletedBids = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cutoff = new Date(
      Date.now() - DELETED_BID_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    // Purge anything past the window before listing what is left.
    const { error: purgeError } = await context.supabase
      .from("bids")
      .delete()
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);
    if (purgeError) throw new Error(purgeError.message);
    const { data, error } = await context.supabase
      .from("bids")
      .select("id, name, status, grand_total, updated_at, deleted_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** A folder name as typed; normalizeFolder trims, collapses and cuts it to FOLDER_MAX. */
const folderText = z.string().max(400);
/** The won day as sent: a day (YYYY-MM-DD). */
const WON_ON = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "The won day must be a day (YYYY-MM-DD)");

const saveBidSchema = z.object({
  // Prospecting link (nullable spine column); absent = leave as is.
  buildingId: z.string().uuid().nullable().optional(),
  /** Takeoff link (nullable spine column); absent = leave as is. */
  takeoffId: z.string().uuid().nullable().optional(),
  /** Customer profile link (crm_accounts, docs §11); absent = leave as is, null = unlink. */
  accountId: z.string().uuid().nullable().optional(),
  /** The profile's site the bid is for (crm_sites); absent = leave as is, null = none. */
  siteId: z.string().uuid().nullable().optional(),
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  data: z.record(z.string(), z.unknown()),
  grandTotal: z.number(),
  /**
   * The estimator's money figures for the Margin report (bids.figures; owner, Oct 21; lib/
   * bid-figures.ts bidFigures on the browser's engine result). Sent on every save, null when the
   * page had no result yet; absent = leave as is.
   */
  figures: bidFiguresSchema.nullable().optional(),
  status: z.enum(BID_STATUSES).optional(),
  /** Why the bid was lost (only meaningful with status "lost"; null clears it). */
  lostReason: z.string().trim().max(300).nullable().optional(),
  /**
   * The day the bid was won (bids.won_on, YYYY-MM-DD; owner, Oct 21). With status won: this day,
   * else the stored one, else today (bid-status.ts wonOnColumns); any other status clears it.
   */
  wonOn: WON_ON.nullable().optional(),
  /**
   * When the bid must go out (bids.due_date, YYYY-MM-DD; owner, Oct 12). Required on a new bid
   * (no id): the save is refused with BID_DUE_REQUIRED without it. On an existing bid: absent =
   * leave as is; a day replaces it; null clears it — allowed only on a won / lost bid
   * (bidDueDateProblem). A bid from before due dates existed saves without one.
   */
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "The bid due date must be a day (YYYY-MM-DD)")
    .nullable()
    .optional(),
  /**
   * The folder the bid is filed under (bids.folder; owner, Oct 13), normalized here
   * (bids-folders.ts normalizeFolder: blank → null = unfiled). Absent = leave as is.
   */
  folder: folderText.nullable().optional(),
  /**
   * The estimator's own reminder (bids.reminder_on / reminder_note; owner, Oct 13: "set up a
   * custom reminder on there as well on setup"). Absent = leave as is; a day sets it (the note
   * with it, trimmed, at most BID_REMINDER_NOTE_MAX); null clears the date AND the note
   * (bid-status.ts bidReminderColumns). The pass (bids-notify.server.ts) sends "Bid reminder:
   * <name>" with the note on that day, whatever the status, and stamps reminded_at; changing the
   * date clears the stamp (the trigger), so the box can be set again.
   */
  reminderOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "The reminder day must be a day (YYYY-MM-DD)")
    .nullable()
    .optional(),
  reminderNote: z.string().max(400).nullable().optional(),
  /** The saving tab's edit-lock session key (see bid-locks); a live lock elsewhere refuses the save. */
  sessionKey: z.string().min(8).max(80).optional(),
  /**
   * The row's updated_at as this tab loaded it (owner, Oct 6: a Towneplace bid "went back in and
   * a lot of things were missing … saved again and the total changed"). A save whose copy is
   * older than the last save of the bid's CONTENTS (bids.content_saved_at; lib/bid-stale-save.ts)
   * refuses, so a stale tab never writes over another save. A filing change from a list page
   * (folder, customer link, status) moves only updated_at and does not refuse the save; the
   * estimator sends only the header fields it changed, so the newer filing is kept.
   */
  expectUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

/** Create a new bid or update an existing one (by id) with the full estimator payload. */
export const saveBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => saveBidSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Who is saving — shown on the Bids page as "Last saved … by <name>".
    const { data: me } = await context.supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    const now = new Date().toISOString();
    const payload = {
      name: data.name,
      data: data.data as Json,
      grand_total: data.grandTotal,
      ...(data.figures !== undefined ? { figures: data.figures } : {}),
      updated_at: now,
      // The contents stamp the stale-tab rule reads (the trigger moves updated_at on any update).
      content_saved_at: now,
      updated_by_name: (me?.full_name ?? "").trim() || me?.email || null,
      ...(data.status ? { status: data.status } : {}),
      ...(data.status && data.status !== "lost"
        ? { lost_reason: null }
        : data.lostReason !== undefined
          ? { lost_reason: data.lostReason }
          : {}),
      ...(data.buildingId !== undefined ? { building_id: data.buildingId } : {}),
      ...(data.takeoffId !== undefined ? { takeoff_id: data.takeoffId } : {}),
      ...(data.accountId !== undefined ? { account_id: data.accountId } : {}),
      ...(data.siteId !== undefined ? { site_id: data.siteId } : {}),
      ...(data.dueDate !== undefined ? { due_date: data.dueDate } : {}),
      ...(data.folder !== undefined ? { folder: normalizeFolder(data.folder) } : {}),
      ...bidReminderColumns(data.reminderOn, data.reminderNote),
    };
    if (data.id) {
      const other = await liveLockHeldElsewhere(context.supabase, data.id, data.sessionKey);
      if (other)
        throw new Error(
          `Read only: ${other.holderName} is currently editing this bid — your changes were not saved.`,
        );
      const { data: cur, error: cErr } = await context.supabase
        .from("bids")
        .select(
          "updated_at, content_saved_at, updated_by_name, status, submitted_at, due_date, won_on, status_changed_at",
        )
        .eq("id", data.id)
        .maybeSingle();
      if (cErr) throw new Error(cErr.message);
      if (data.expectUpdatedAt && cur && bidSaveIsStale(data.expectUpdatedAt, cur))
        throw new Error(
          bidStaleMessage(
            cur.updated_by_name,
            cur.content_saved_at ?? cur.updated_at,
            payload.updated_by_name,
          ),
        );
      // The due date may be changed any time, and cleared only on a won / lost bid (owner, Oct
      // 12); a bid that never had one is not held up.
      const dueProblem = bidDueDateProblem({
        isNew: false,
        dueDate: data.dueDate,
        status: data.status ?? cur?.status,
        hadDueDate: !!cur?.due_date,
      });
      if (dueProblem) throw new Error(dueProblem);
      // The status stamps (owner, Oct 12): status_changed_at on a change, submitted_at the first
      // time it is submitted (never overwritten).
      const statusChanged = !!data.status && !!cur && asBidStatus(cur.status) !== data.status;
      // The won day (owner, Oct 21): the day sent, else the stored one, else today while the bid
      // is won; cleared by any other status (bid-status.ts wonOnColumns).
      const { data: bid, error } = await context.supabase
        .from("bids")
        .update({
          ...payload,
          ...(data.status && cur ? bidStatusStamps(cur, data.status) : {}),
          ...wonOnColumns(
            cur ?? null,
            { status: data.status ?? cur?.status, wonOn: data.wonOn },
            bidOfficeToday(),
          ),
        })
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      // The bid drives its opportunity (opportunities.functions.ts syncOpportunityFromBid), after
      // the bid write succeeded. Owner, Oct 12 (A): on a status change as before, and on EVERY
      // save that leaves the bid submitted / won / lost while the row names its opportunity — the
      // database function answers 'unchanged' when there is nothing to do, so a bid linked after
      // it was saved as Won, or a sync that failed once, catches up on the next save. A draft
      // moves nothing; a bid with no opportunity is left silent (no warning: a bid does not have
      // to be linked to one).
      if (asBidStatus(bid.status) !== "draft" && (statusChanged || bid.opportunity_id))
        await syncOpportunityFromBid(context, bid.id);
      return bid;
    }
    const status = data.status ?? "draft";
    // A new bid needs its due date (owner, Oct 12: "at the origination of bids we should have a
    // bid due date required"): the estimator asks first; this is the final guard.
    const dueProblem = bidDueDateProblem({ isNew: true, dueDate: data.dueDate, status });
    if (dueProblem) throw new Error(dueProblem);
    const { data: bid, error } = await context.supabase
      .from("bids")
      .insert({
        ...payload,
        status,
        ...bidStatusStamps(null, status),
        ...wonOnColumns(null, { status, wonOn: data.wonOn }, bidOfficeToday()),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    // A new bid is linked to its opportunity only after this (linkBid), so there is nothing to
    // sync yet unless the row already names one.
    if (status !== "draft" && bid.opportunity_id) await syncOpportunityFromBid(context, bid.id);
    return bid;
  });

const importBidsSchema = z.object({
  bids: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        data: z.record(z.string(), z.unknown()),
        grandTotal: z.number(),
        status: z.enum(BID_STATUSES),
        /** The legacy file's last-save time; becomes created_at so the list dates read right. */
        createdAt: z.string().datetime().nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * Insert bids converted from legacy Bid-Advantage .bax files (src/lib/bax). Each row keeps the
 * legacy last-save time as created_at and is stamped "imported by <name>"; the data blob already
 * carries the frozen pricing snapshot the dialog built from the file's own price tables.
 */
export const importBids = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => importBidsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: me } = await context.supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    const who = (me?.full_name ?? "").trim() || me?.email || null;
    const now = new Date().toISOString();
    const rows = data.bids.map((b) => ({
      name: b.name,
      data: b.data as Json,
      grand_total: b.grandTotal,
      status: b.status,
      created_at: b.createdAt ?? now,
      updated_at: now,
      content_saved_at: now,
      updated_by_name: who ? `${who} (import)` : "import",
    }));
    const { data: inserted, error } = await context.supabase
      .from("bids")
      .insert(rows)
      .select("id, name");
    if (error) throw new Error(error.message);
    return inserted ?? [];
  });

/**
 * File one or several live bids under a folder from the Bids page ("Move to folder…" on a row,
 * "Move N to folder…" on a selection; owner, Oct 13). The name is normalized (blank / "Unfiled"
 * → null = unfiled). Only the folder changes: "Last saved … by" is left alone, so the list keeps
 * its order and an estimator tab with the bid open is not told its copy is stale. RLS
 * (`bids_authenticated_all`) is the access rule, as for saveBid. Returns how many rows changed.
 */
export const setBidFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        folder: folderText.nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const folder = normalizeFolder(data.folder);
    const { error, count } = await context.supabase
      .from("bids")
      .update({ folder }, { count: "exact" })
      .in("id", data.ids)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { count: count ?? 0, folder };
  });

/**
 * Rename a folder (owner, Oct 13): every live bid whose folder matches `from` — case-insensitive
 * (bids-folders.ts folderKey), so both spellings of one folder move together — is filed under
 * `to`. Returns how many bids moved and the name as stored.
 */
export const renameBidFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ from: folderText.min(1), to: folderText.min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const to = normalizeFolder(data.to);
    if (!to) throw new Error("Give the folder a name.");
    const fromKey = folderKey(data.from);
    if (!fromKey) throw new Error("Unfiled is not a folder and cannot be renamed.");
    const { data: rows, error } = await context.supabase
      .from("bids")
      .select("id, folder")
      .not("folder", "is", null)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).filter((r) => folderKey(r.folder) === fromKey).map((r) => r.id);
    if (ids.length === 0) return { count: 0, folder: to };
    const { error: uErr, count } = await context.supabase
      .from("bids")
      .update({ folder: to }, { count: "exact" })
      .in("id", ids);
    if (uErr) throw new Error(uErr.message);
    return { count: count ?? ids.length, folder: to };
  });

/** The folder names in use (live bids), A–Z, for the estimator's Folder picker. */
export const listBidFolders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    const { data, error } = await context.supabase
      .from("bids")
      .select("folder")
      .not("folder", "is", null)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return folderOptions(
      (data ?? []).map((r) => ({ folder: r.folder, created_at: "", grand_total: null })),
    );
  });

/**
 * Change a bid's status from the list (Bids page dropdown); stamps who and when like a save, the
 * status stamps (bidStatusStamps), the won day (wonOnColumns: the day the list asked for when
 * marking Won, else the stored one, else today; cleared otherwise), and then drives the linked
 * opportunity (owner, Oct 12: opportunities.functions.ts syncOpportunityFromBid — submitted →
 * quoted, won → won, lost → lost).
 */
export const setBidStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(BID_STATUSES),
        lostReason: z.string().trim().max(300).nullable().optional(),
        wonOn: WON_ON.nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const [{ data: me }, { data: cur, error: cErr }] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("bids")
        .select("status, submitted_at, won_on, status_changed_at")
        .eq("id", data.id)
        .maybeSingle(),
    ]);
    if (cErr) throw new Error(cErr.message);
    if (!cur) throw new Error("Bid not found (it may have been deleted).");
    const { data: bid, error } = await context.supabase
      .from("bids")
      .update({
        status: data.status,
        lost_reason: data.status === "lost" ? (data.lostReason ?? null) : null,
        updated_at: new Date().toISOString(),
        updated_by_name: (me?.full_name ?? "").trim() || me?.email || null,
        ...bidStatusStamps(cur, data.status),
        ...wonOnColumns(cur, { status: data.status, wonOn: data.wonOn }, bidOfficeToday()),
      })
      .eq("id", data.id)
      .select("id, status, updated_at, updated_by_name, submitted_at, won_on")
      .single();
    if (error) throw new Error(error.message);
    if (asBidStatus(cur.status) !== data.status) await syncOpportunityFromBid(context, bid.id);
    return bid;
  });

/**
 * Move the day a won bid was won (bids.won_on; owner, Oct 21: "a way to adjust the date the bid
 * was won to ensure the data appears correctly") — the Margin report's inline Won-on box. Admins
 * and managers only (the role from the caller's own profile row); a bid that is not won has no
 * won day and is refused; a deleted bid is not found. Writes won_on and nothing else: the row's
 * "Last saved … by" stays, so an estimator tab with the bid open is not told its copy is stale.
 */
export const setBidWonOn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid(), wonOn: WON_ON }).parse(d))
  .handler(async ({ data, context }): Promise<{ id: string; won_on: string }> => {
    const [{ data: me, error: meErr }, { data: cur, error: cErr }] = await Promise.all([
      context.supabase.from("profiles").select("id, role").eq("id", context.userId).maybeSingle(),
      context.supabase
        .from("bids")
        .select("id, status")
        .eq("id", data.id)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);
    if (meErr) throw new Error(meErr.message);
    if (!me || !(isAdmin(me) || isManager(me)))
      throw new Error("Forbidden: admins and managers only");
    if (cErr) throw new Error(cErr.message);
    if (!cur) throw new Error("Bid not found (it may have been deleted).");
    if (asBidStatus(cur.status) !== "won") throw new Error("Only a won bid has a Won-on day");
    const { error } = await context.supabase
      .from("bids")
      .update({ won_on: data.wonOn })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { id: data.id, won_on: data.wonOn };
  });

const getBidSchema = z.object({ id: z.string().uuid() });

/**
 * Delete one bid — a SOFT delete: the row is stamped `deleted_at`, hidden from the list, and
 * kept in "Recently deleted" for DELETED_BID_RETENTION_DAYS with Restore. RLS
 * (`bids_authenticated_all`) is the final guard.
 */
export const deleteBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => getBidSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error, count } = await context.supabase
      .from("bids")
      .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", data.id)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Bid not found (it may already have been deleted).");
    return { id: data.id };
  });

/**
 * Duplicate a bid as a new draft (owner, Oct 6): the same payload, total, customer, site and
 * building under "<name> (copy)"; status, lost reason and the takeoff / opportunity links are not
 * copied (lib/duplicate-bid.ts). Returns the new row; the Bids page opens it.
 */
export const duplicateBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => getBidSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: source, error } = await context.supabase
      .from("bids")
      .select("*")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!source) throw new Error("Bid not found (it may have been deleted).");
    const { data: me } = await context.supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    const { data: copy, error: insErr } = await context.supabase
      .from("bids")
      .insert(
        duplicateBidRow(
          source,
          (me?.full_name ?? "").trim() || me?.email || null,
          new Date().toISOString(),
        ),
      )
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);
    return copy;
  });

/** Bring a soft-deleted bid back to the list. */
export const restoreBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => getBidSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error, count } = await context.supabase
      .from("bids")
      .update({ deleted_at: null }, { count: "exact" })
      .eq("id", data.id)
      .not("deleted_at", "is", null);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Bid not found in Recently deleted.");
    return { id: data.id };
  });

/** Permanently remove a bid that is already in Recently deleted. Cannot be undone. */
export const purgeBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => getBidSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error, count } = await context.supabase
      .from("bids")
      .delete({ count: "exact" })
      .eq("id", data.id)
      .not("deleted_at", "is", null);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Bid not found in Recently deleted.");
    return { id: data.id };
  });

/** Fetch one bid (with its stored estimator payload) by id. */
export const getBid = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => getBidSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: bid, error } = await context.supabase
      .from("bids")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    return bid;
  });

export interface CompanyInfo {
  company_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
}

export interface MarkupPreset {
  name: string;
  hourlyRate: number;
  markupAmount: number;
  markupType: string;
  includePerDiem: boolean;
  includeCommission: boolean;
  isDefault: boolean;
}

/** Labor & markup presets for the estimator's preset picker. Estimate Pricing or Estimate access. */
export const getMarkupPresets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MarkupPreset[]> => {
    await assertPricingRead(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("markup_options")
      .select(
        "name, hourly_rate, markup_amount, markup_type, include_per_diem, include_commission, is_default",
      )
      .order("sort");
    if (error) throw error;
    return (data ?? []).map((m) => ({
      name: m.name,
      hourlyRate: Number(m.hourly_rate),
      markupAmount: Number(m.markup_amount),
      markupType: m.markup_type,
      includePerDiem: !!m.include_per_diem,
      includeCommission: !!m.include_commission,
      isDefault: !!m.is_default,
    }));
  });

/** Warranty + high-wind pricing tables for the estimator's warranty picker. Estimate Pricing or Estimate access. */
export const getWarrantyData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPricingRead(context.supabase, context.userId);
    const [wRes, hwRes] = await Promise.all([
      context.supabase
        .from("warranties")
        .select(
          "name, price_per_sqft, non_master_elite_surcharge, req_thickness, is_high_wind, term_years, systems",
        )
        .order("sort"),
      context.supabase
        .from("high_wind_upcharges")
        .select("term_years, wind_band, mech_per_sqft, adhered_per_sqft")
        .order("sort"),
    ]);
    if (wRes.error) throw wRes.error;
    if (hwRes.error) throw hwRes.error;
    return {
      warranties: (wRes.data ?? []).map((w) => ({
        name: w.name,
        pricePerSqFt: Number(w.price_per_sqft),
        nonMasterEliteSurcharge: Number(w.non_master_elite_surcharge),
        reqThickness: Number(w.req_thickness ?? 40),
        isHighWind: !!w.is_high_wind,
        termYears: Number(w.term_years ?? 15),
        // The roof systems it is offered on (owner, Oct 22); null = every system.
        systems: w.systems ?? null,
      })),
      highWind: (hwRes.data ?? []).map((h) => ({
        termYears: Number(h.term_years),
        windBand: h.wind_band,
        mechPerSqFt: Number(h.mech_per_sqft),
        adheredPerSqFt: Number(h.adhered_per_sqft),
      })),
    };
  });

/**
 * Company header fields for the proposal (any signed-in user; no admin gate). Read through the
 * price-free `company_settings_public` view (Oct 20): the settings row itself — tax rate, labor
 * display, shipping — is Estimate Pricing / Estimate only now.
 */
export const getCompanyInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CompanyInfo> => {
    const { data, error } = await context.supabase
      .from("company_settings_public")
      .select("company_name, address, city, state, zip, phone")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    return (
      data ?? {
        company_name: null,
        address: null,
        city: null,
        state: null,
        zip: null,
        phone: null,
      }
    );
  });
