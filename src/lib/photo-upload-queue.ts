/**
 * ONE upload queue for every ticket picture in the portal (owner, Oct 28): the close-out's Before /
 * After and repair photos, the inspection close-out's camera, a checklist row's "Add pictures"
 * and the office's Photos & repairs fold all feed it, and the technician keeps working while it
 * runs — no blocking "Uploading…" line, a small "3 uploading" badge and a grey placeholder
 * thumbnail (a spinner) wherever the picture will show, which becomes the real thumbnail once
 * the row is registered.
 *
 * The pipeline is the one the screens used one at a time until now, with caps: up to TWO
 * pictures shrink at once (field-utils shrinkPhoto: 2048 px / JPEG 0.85, unchanged — the owner
 * refused smaller pictures) and up to THREE upload (the bucket) and register (registerJobPhoto)
 * in parallel, in the order picked. A failure that is not the signal's is loud (the caller's
 * onFailed names the file and offers Retry) and never holds up the rest.
 *
 * No signal: a picture whose upload fails for a signal reason, or picked while the phone says it
 * is offline, is HELD — kept on the phone (the store: IndexedDB in the portal, lib/picture-store.ts;
 * any PictureStore here) already shrunk, with its ticket, repair, item and role, so the retry is
 * cheap — and shows as "3 pictures waiting for signal" (never "offline", "network" or "sync").
 * `resume()` (the portal calls it on `online`, on focus and on the next pick) puts held pictures
 * back in line; a picture leaves the store only once registerJobPhoto has answered. Every picture
 * is stored as soon as it is shrunk, so a tab the phone kills mid-upload loses nothing either:
 * `restore()` on the next open puts what was stored back in line.
 *
 * Mark up as you shoot (phone camera only — shouldMarkUpAfterShot): the editor opens on the
 * fresh shot while the upload runs; `attachMarks` saves the marks onto the registered row, or
 * holds them on the entry until the row exists and saves them then.
 *
 * Pure: every effect (shrink, upload, register, store, clock, ids, online) is injected, so the
 * ordering, the caps, the grouping, the retry, the store and the resume are all unit-tested
 * (photo-upload-queue.test.ts). The hook at the end is the one React piece: a subscription to the
 * entries, filtered to a ticket (and repair / item / role).
 */
import { useMemo, useSyncExternalStore } from "react";

import type { PhotoMarks } from "@/lib/photo-annotations";

export type PictureRole = "before" | "after" | "other";

/** Where a picture belongs: its ticket, and the repair or checklist item (or neither), and the role. */
export interface PictureTarget {
  jobId: string;
  repairId: string | null;
  itemKey: string | null;
  role: PictureRole;
}

/** A picture after shrinkPhoto: what is uploaded and stored. */
export interface ShrunkPicture {
  blob: Blob;
  type: string;
  name: string;
}

/** What `add` takes: a File, or anything that looks like one (tests). */
export interface PickedFile {
  name: string;
  lastModified: number;
  type: string;
  size: number;
}

export type PictureStatus =
  /** In line: for the shrink, or shrunk and in line for the upload. */
  | "waiting"
  | "shrinking"
  /** The upload and the register (one slot of the three). */
  | "uploading"
  /** Kept on the phone until the signal is back ("waiting for signal"). */
  | "held"
  /** The server (or the browser) said no for a reason that is not the signal: Retry / Discard. */
  | "failed";

export interface QueuedPicture {
  id: string;
  target: PictureTarget;
  fileName: string;
  /** When the picture was taken (the file's date; else when it was picked), ISO. */
  takenAt: string;
  /** The pick order (ms); the queue runs in this order. */
  addedAt: number;
  status: PictureStatus;
  /** Why the last try failed (status "failed"), in the server's words. */
  error: string | null;
  attempts: number;
  /** Marks drawn right after the shot, waiting for the row (mark up as you shoot). */
  heldMarks: PhotoMarks | null;
  /** The shot came straight from the phone's camera (the editor opens after it). */
  fromCamera: boolean;
}

/** What the phone keeps for a picture that has not been registered yet. */
export interface StoredPicture {
  id: string;
  target: PictureTarget;
  fileName: string;
  takenAt: string;
  addedAt: number;
  picture: ShrunkPicture;
  where: { lat: number; lng: number } | null;
  heldMarks: PhotoMarks | null;
  /** The object's path once it is in the bucket (the retry only registers), else null. */
  uploadedPath: string | null;
}

export interface PictureStore {
  put(p: StoredPicture): Promise<void>;
  remove(id: string): Promise<void>;
  all(): Promise<StoredPicture[]>;
}

/** An in-memory store: tests, and the portal's fallback when the phone's storage is blocked. */
export function memoryPictureStore(): PictureStore & { size(): number } {
  const map = new Map<string, StoredPicture>();
  return {
    put: async (p) => {
      map.set(p.id, p);
    },
    remove: async (id) => {
      map.delete(id);
    },
    all: async () => [...map.values()].sort((a, b) => a.addedAt - b.addedAt),
    size: () => map.size,
  };
}

/** What registerJobPhoto is told about one picture. */
export interface PictureRegistration {
  service_job_id: string;
  repair_id: string | null;
  item_key: string | null;
  role: PictureRole;
  storage_path: string;
  file_name: string | null;
  file_size: number;
  taken_at: string;
  lat: number | null;
  lng: number | null;
}

export function pictureRegistration(
  p: Pick<StoredPicture, "target" | "fileName" | "takenAt" | "picture" | "where">,
  path: string,
): PictureRegistration {
  return {
    service_job_id: p.target.jobId,
    repair_id: p.target.repairId,
    item_key: p.target.itemKey,
    role: p.target.role,
    storage_path: path,
    file_name: p.picture.name || p.fileName || null,
    file_size: p.picture.blob.size,
    taken_at: p.takenAt,
    lat: p.where?.lat ?? null,
    lng: p.where?.lng ?? null,
  };
}

export interface QueueDeps<Row extends { id: string }> {
  shrink: (file: File) => Promise<ShrunkPicture>;
  /** Put the picture in the bucket at `path` (field-utils uploadToServiceBucket). */
  upload: (path: string, picture: ShrunkPicture) => Promise<void>;
  /** Best effort: drop an object whose row the server refused. */
  removeUpload: (path: string) => Promise<void>;
  register: (data: PictureRegistration) => Promise<Row>;
  /** Save marks drawn before the row existed onto it (savePhotoAnnotations). */
  saveMarks: (row: Row, marks: PhotoMarks) => Promise<void>;
  store: PictureStore;
  /** navigator.onLine (false: nothing is tried, the picture is held at once). */
  online: () => boolean;
  /** `${jobId}/<uuid>.<ext>` for the shrunk picture (field-utils uploadPlan). */
  pathFor: (jobId: string, picture: ShrunkPicture) => string;
  /** GPS beside the upload, with its own short timeout; never awaited before the shrink. */
  locate?: (() => Promise<{ lat: number; lng: number } | null>) | undefined;
  now?: (() => number) | undefined;
  id?: (() => string) | undefined;
  /** The caps: 2 shrinking, 3 uploading. */
  shrinkAtOnce?: number | undefined;
  uploadAtOnce?: number | undefined;
}

export interface QueueEvents<Row extends { id: string }> {
  /** The row exists: put it in the ticket's list. Called before the placeholder goes. */
  onRegistered?: ((entry: QueuedPicture, row: Row) => void) | undefined;
  /** A failure that is not the signal's: name the file, offer Retry. */
  onFailed?: ((entry: QueuedPicture, error: unknown) => void) | undefined;
  /** The picture is now waiting for signal (kept on the phone). */
  onHeld?: ((entry: QueuedPicture) => void) | undefined;
  /** The marks drawn after the shot could not be saved onto the row. */
  onMarksFailed?: ((entry: QueuedPicture, error: unknown) => void) | undefined;
  /** The store could not keep a picture (private mode, blocked site data). Once per queue. */
  onStoreError?: ((error: unknown) => void) | undefined;
}

/** A failure the signal explains: the phone says offline, or the fetch itself never got an answer. */
export function isSignalFailure(e: unknown, online: boolean): boolean {
  if (!online) return true;
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /failed to fetch|load failed|network ?error|network request failed|fetch failed|ECONN|ETIMEDOUT|timed? ?out|internet connection|unable to connect|could not connect|connection (was )?(lost|reset|closed)/i.test(
    msg,
  );
}

/**
 * Does the markup editor open right after a shot? Only for a picture from the PHONE's camera: the
 * input had `capture` AND the device's main pointer is a finger (pointer: coarse). Picking from
 * the camera roll (no capture) never; a computer never (owner, Oct 28: "does this apply to
 * uploads on the computer? it probably shouldn't").
 */
export function shouldMarkUpAfterShot(args: {
  capture: boolean | string | null | undefined;
  coarsePointer: boolean;
}): boolean {
  return !!args.capture && args.coarsePointer;
}

/** The pictures of one place: a ticket, and (when given) its repair / item / role. */
export function matchesTarget(
  entry: { target: PictureTarget },
  filter: Partial<PictureTarget> | null | undefined,
): boolean {
  if (!filter) return true;
  const t = entry.target;
  if (filter.jobId !== undefined && t.jobId !== filter.jobId) return false;
  if (filter.repairId !== undefined && t.repairId !== filter.repairId) return false;
  if (filter.itemKey !== undefined && t.itemKey !== filter.itemKey) return false;
  if (filter.role !== undefined && t.role !== filter.role) return false;
  return true;
}

export interface PictureSummary {
  /** In line, shrinking or uploading: "3 uploading". */
  uploading: number;
  /** Held on the phone: "3 pictures waiting for signal". */
  waitingForSignal: number;
  failed: number;
}

export function summarize(entries: readonly QueuedPicture[]): PictureSummary {
  const s: PictureSummary = { uploading: 0, waitingForSignal: 0, failed: 0 };
  for (const e of entries) {
    if (e.status === "held") s.waitingForSignal++;
    else if (e.status === "failed") s.failed++;
    else s.uploading++;
  }
  return s;
}

/** "3 uploading", or null when nothing is. */
export const uploadingBadge = (n: number): string | null => (n > 0 ? `${n} uploading` : null);

/** "1 picture waiting for signal" / "3 pictures waiting for signal", or null when none is. */
export const waitingForSignalLine = (n: number): string | null =>
  n > 0 ? `${n} ${n === 1 ? "picture" : "pictures"} waiting for signal` : null;

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Per picture, what the entries do not show (the file, the shrunk picture, the object path). */
interface Work {
  entry: QueuedPicture;
  file: File | null;
  picture: ShrunkPicture | null;
  where: Promise<{ lat: number; lng: number } | null> | null;
  located: { lat: number; lng: number } | null;
  uploadedPath: string | null;
}

export class PhotoUploadQueue<Row extends { id: string }> {
  private work = new Map<string, Work>();
  private order: string[] = [];
  private snap: readonly QueuedPicture[] = [];
  private listeners = new Set<() => void>();
  private storeWarned = false;
  private readonly shrinkAtOnce: number;
  private readonly uploadAtOnce: number;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(
    private readonly deps: QueueDeps<Row>,
    private events: QueueEvents<Row> = {},
  ) {
    this.shrinkAtOnce = deps.shrinkAtOnce ?? 2;
    this.uploadAtOnce = deps.uploadAtOnce ?? 3;
    this.now = deps.now ?? Date.now;
    this.newId = deps.id ?? randomId;
  }

  /** The app's event handlers (toasts, the query cache) are set once the screens exist. */
  setEvents(events: QueueEvents<Row>) {
    this.events = events;
  }

  // ── Reading ──────────────────────────────────────────────────────────────────────────────

  /** The pictures still in flight, in pick order (a new array whenever anything changes). */
  snapshot = (): readonly QueuedPicture[] => this.snap;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private publish() {
    this.snap = this.order
      .map((id) => this.work.get(id)?.entry)
      .filter((e): e is QueuedPicture => !!e);
    for (const fn of this.listeners) fn();
  }

  private patch(id: string, patch: Partial<QueuedPicture>): QueuedPicture | null {
    const w = this.work.get(id);
    if (!w) return null;
    w.entry = { ...w.entry, ...patch };
    return w.entry;
  }

  // ── Adding ───────────────────────────────────────────────────────────────────────────────

  /**
   * Put picked files in line; returns their ids (the caller's after-shot editor needs the one of
   * a camera shot). A pick also resumes whatever was waiting for signal.
   */
  add(
    files: readonly File[],
    target: PictureTarget,
    opts: { fromCamera?: boolean } = {},
  ): string[] {
    const ids: string[] = [];
    const at = this.now();
    for (const file of files) {
      const id = this.newId();
      const entry: QueuedPicture = {
        id,
        target,
        fileName: file.name,
        takenAt: new Date(file.lastModified || at).toISOString(),
        addedAt: at,
        status: "waiting",
        error: null,
        attempts: 0,
        heldMarks: null,
        fromCamera: !!opts.fromCamera,
      };
      const where = this.deps.locate ? this.deps.locate().catch(() => null) : null;
      this.work.set(id, { entry, file, picture: null, where, located: null, uploadedPath: null });
      this.order.push(id);
      ids.push(id);
    }
    this.resume(false);
    this.publish();
    this.pump();
    return ids;
  }

  /** Put back in line what the store kept (the portal, once, when it starts). */
  async restore(): Promise<number> {
    let kept: StoredPicture[];
    try {
      kept = await this.deps.store.all();
    } catch (e) {
      this.storeTrouble(e);
      return 0;
    }
    let n = 0;
    for (const p of kept) {
      if (this.work.has(p.id)) continue;
      const entry: QueuedPicture = {
        id: p.id,
        target: p.target,
        fileName: p.fileName,
        takenAt: p.takenAt,
        addedAt: p.addedAt,
        status: this.deps.online() ? "waiting" : "held",
        error: null,
        attempts: 0,
        heldMarks: p.heldMarks,
        fromCamera: false,
      };
      this.work.set(p.id, {
        entry,
        file: null,
        picture: p.picture,
        where: null,
        located: p.where,
        uploadedPath: p.uploadedPath,
      });
      this.order.push(p.id);
      n++;
    }
    this.order.sort(
      (a, b) => (this.work.get(a)?.entry.addedAt ?? 0) - (this.work.get(b)?.entry.addedAt ?? 0),
    );
    if (n) {
      this.publish();
      this.pump();
    }
    return n;
  }

  // ── Controls ─────────────────────────────────────────────────────────────────────────────

  /** Try a failed picture again (the toast's Retry, the strip's). */
  retry(id: string) {
    const w = this.work.get(id);
    if (!w || (w.entry.status !== "failed" && w.entry.status !== "held")) return;
    this.patch(id, { status: "waiting", error: null });
    this.publish();
    this.pump();
  }

  /** Let a failed (or held) picture go: off the list and off the phone. */
  discard(id: string) {
    const w = this.work.get(id);
    if (!w || w.entry.status === "shrinking" || w.entry.status === "uploading") return;
    this.work.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.publish();
    void this.deps.store.remove(id).catch((e) => this.storeTrouble(e));
  }

  /** Held pictures back in line (the portal: `online`, focus, the next pick). */
  resume(pump = true): number {
    let n = 0;
    for (const w of this.work.values()) {
      if (w.entry.status !== "held") continue;
      w.entry = { ...w.entry, status: "waiting" };
      n++;
    }
    if (n && pump) {
      this.publish();
      this.pump();
    }
    return n;
  }

  /**
   * Marks drawn on the fresh shot: saved onto the row when it exists, else held on the entry (and
   * in the store) and saved the moment the row is registered. Null clears held marks.
   */
  async attachMarks(id: string, marks: PhotoMarks | null): Promise<void> {
    const w = this.work.get(id);
    if (!w) {
      const row = this.registered.get(id);
      if (row && marks) await this.deps.saveMarks(row, marks);
      return;
    }
    this.patch(id, { heldMarks: marks });
    this.publish();
    if (w.picture) await this.persist(w);
  }

  /** The rows registered this session, by entry id (marks pressed Done after the row landed). */
  private registered = new Map<string, Row>();

  // ── The pump ─────────────────────────────────────────────────────────────────────────────

  private count(status: PictureStatus) {
    let n = 0;
    for (const w of this.work.values()) if (w.entry.status === status) n++;
    return n;
  }

  private pump() {
    let shrinking = this.count("shrinking");
    let uploading = this.count("uploading");
    for (const id of this.order) {
      const w = this.work.get(id);
      if (!w || w.entry.status !== "waiting") continue;
      if (w.picture) {
        if (uploading >= this.uploadAtOnce) continue;
        if (!this.deps.online()) {
          this.hold(w);
          continue;
        }
        uploading++;
        w.entry = { ...w.entry, status: "uploading", attempts: w.entry.attempts + 1 };
        void this.send(w);
      } else if (w.file) {
        if (shrinking >= this.shrinkAtOnce) continue;
        shrinking++;
        w.entry = { ...w.entry, status: "shrinking" };
        void this.shrink(w);
      }
    }
    this.publish();
  }

  private async shrink(w: Work) {
    try {
      w.picture = await this.deps.shrink(w.file!);
      w.file = null;
      w.entry = { ...w.entry, status: "waiting" };
      await this.persist(w);
    } catch (e) {
      w.entry = { ...w.entry, status: "failed", error: errText(e) };
      this.events.onFailed?.(w.entry, e);
    }
    this.pump();
  }

  private async send(w: Work) {
    const id = w.entry.id;
    const picture = w.picture!;
    try {
      if (!w.uploadedPath) {
        const path = this.deps.pathFor(w.entry.target.jobId, picture);
        await this.deps.upload(path, picture);
        w.uploadedPath = path;
        await this.persist(w);
      }
      if (w.where) {
        w.located = await w.where;
        w.where = null;
      }
      let row: Row;
      try {
        row = await this.deps.register(
          pictureRegistration(
            {
              target: w.entry.target,
              fileName: w.entry.fileName,
              takenAt: w.entry.takenAt,
              picture,
              where: w.located,
            },
            w.uploadedPath,
          ),
        );
      } catch (e) {
        if (!isSignalFailure(e, this.deps.online())) {
          // The server said no: the object must not sit in the bucket with no row — and the
          // stored copy must forget it, or a restore would register a row on a removed object.
          await this.deps.removeUpload(w.uploadedPath).catch(() => {});
          w.uploadedPath = null;
          await this.persist(w);
        }
        throw e;
      }
      if (!this.work.has(id)) return; // discarded meanwhile (cannot happen while uploading; safety)
      this.registered.set(id, row);
      this.work.delete(id);
      this.order = this.order.filter((x) => x !== id);
      const done = w.entry;
      this.events.onRegistered?.(done, row);
      this.publish();
      void this.deps.store.remove(id).catch((e) => this.storeTrouble(e));
      if (done.heldMarks) {
        try {
          await this.deps.saveMarks(row, done.heldMarks);
        } catch (e) {
          this.events.onMarksFailed?.(done, e);
        }
      }
    } catch (e) {
      if (!this.work.has(id)) return;
      if (isSignalFailure(e, this.deps.online())) {
        this.hold(w);
      } else {
        w.entry = { ...w.entry, status: "failed", error: errText(e) };
        this.events.onFailed?.(w.entry, e);
      }
    }
    this.pump();
  }

  private hold(w: Work) {
    const was = w.entry.status;
    w.entry = { ...w.entry, status: "held", error: null };
    if (was !== "held") this.events.onHeld?.(w.entry);
  }

  private async persist(w: Work) {
    if (!w.picture) return;
    try {
      await this.deps.store.put({
        id: w.entry.id,
        target: w.entry.target,
        fileName: w.entry.fileName,
        takenAt: w.entry.takenAt,
        addedAt: w.entry.addedAt,
        picture: w.picture,
        where: w.located,
        heldMarks: w.entry.heldMarks,
        uploadedPath: w.uploadedPath,
      });
    } catch (e) {
      this.storeTrouble(e);
    }
  }

  private storeTrouble(e: unknown) {
    if (this.storeWarned) return;
    this.storeWarned = true;
    this.events.onStoreError?.(e);
  }
}

// ── React ────────────────────────────────────────────────────────────────────────────────────

/**
 * The pictures in flight for one place (a ticket; its repair / item / role when given), with
 * their counts. Re-renders only when the queue changes.
 */
export function usePictureQueue<Row extends { id: string }>(
  queue: PhotoUploadQueue<Row>,
  filter: Partial<PictureTarget> | null | undefined,
): { entries: QueuedPicture[]; summary: PictureSummary } {
  const all = useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
  const key = filter
    ? `${filter.jobId ?? "*"}|${filter.repairId === undefined ? "*" : filter.repairId}|${filter.itemKey === undefined ? "*" : filter.itemKey}|${filter.role ?? "*"}`
    : "*";
  return useMemo(() => {
    const entries = all.filter((e) => matchesTarget(e, filter));
    return { entries, summary: summarize(entries) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the filter by value (key)
  }, [all, key]);
}
