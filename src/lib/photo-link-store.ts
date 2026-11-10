/**
 * A stored picture keeps ONE link for as long as that link is good (Nov 10, speed finding 4).
 *
 * The pictures live in a private bucket, so the page shows them through signed links, and every
 * read of a ticket signs fresh ones. A fresh link is a different address, so the browser could
 * never use the copy it already had: a ticket with 31 pictures downloaded 640 KB of thumbnails
 * again on every open. Measured on the live bucket: the storage answers a picture with a
 * one-hour `Expires` and an ETag, so the SAME link is served from the browser's own cache with
 * no request at all, and after that hour with a tiny "not changed" answer.
 *
 * So the browser remembers, per stored path, the link it used first and keeps using it until it
 * is close to running out (LINK_MIN_LEFT_MS), then takes the fresh one. The rules that keep this
 * safe:
 *  - A remembered link is only ever used for a path the server has JUST handed this person a
 *    link for (or that they are about to sign themselves), so nobody sees a picture the server
 *    would not show them now; the memory only decides WHICH of two good links to use.
 *  - A deleted picture's row is gone, so its path is never asked for again; a picture is never
 *    overwritten in place (uploads refuse to), so a path always names the same bytes.
 *  - The memory is dropped on sign-out and when another person signs in on the same browser.
 *  - It lives in the browser's local storage (a technician's phone reopens the portal from the
 *    home screen, which is a new page each time) and holds links for at most their own hour.
 *
 * Pure here: the choice, the expiry read off the link, the store over any Storage. The browser's
 * binding is components/service/field-utils.ts (stableLink / useStableLink).
 */

/** A remembered link is reused while it has at least this long to live. */
export const LINK_MIN_LEFT_MS = 15 * 60_000;
/** A link whose own expiry cannot be read is taken to last this long from when it was first seen. */
export const LINK_ASSUMED_LIFE_MS = 60 * 60_000;
/** At most this many links are kept (the newest win); a ticket with 100 pictures is 200. */
export const LINK_STORE_MAX = 600;
export const LINK_STORE_KEY = "jbk:photo-links:v1";

export interface KeptLink {
  url: string;
  /** When the link stops working (ms since 1970). */
  exp: number;
}

const decodeBase64Url = (s: string): string | null => {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    if (typeof atob === "function") return atob(pad);
    return null;
  } catch {
    return null;
  }
};

/**
 * When a signed link runs out: the `exp` its token carries (seconds), read without trusting
 * anything else about it. A link with no readable expiry is assumed good for LINK_ASSUMED_LIFE_MS
 * from `nowMs`.
 */
export function linkExpiryMs(url: string, nowMs: number): number {
  const m = /[?&]token=([^&#]+)/.exec(url);
  const payload = m ? decodeBase64Url((m[1]!.split(".")[1] ?? "").trim()) : null;
  if (payload) {
    try {
      const exp = Number((JSON.parse(payload) as { exp?: unknown }).exp);
      if (Number.isFinite(exp) && exp > 0) return exp * 1000;
    } catch {
      // Not a token we can read: fall through to the assumed life.
    }
  }
  return nowMs + LINK_ASSUMED_LIFE_MS;
}

/** Is the remembered link still good to hand out at `nowMs`? */
export const linkStillGood = (kept: KeptLink | undefined, nowMs: number): kept is KeptLink =>
  !!kept && !!kept.url && kept.exp - nowMs >= LINK_MIN_LEFT_MS;

/**
 * The link to show for a path, and what to remember: the remembered one while it is good;
 * otherwise the fresh one (remembered from now on); with neither, none.
 */
export function chooseLink(
  kept: KeptLink | undefined,
  fresh: string | null | undefined,
  nowMs: number,
): { url: string | null; remember: KeptLink | null } {
  if (linkStillGood(kept, nowMs)) return { url: kept.url, remember: null };
  if (!fresh) return { url: null, remember: null };
  return { url: fresh, remember: { url: fresh, exp: linkExpiryMs(fresh, nowMs) } };
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface Saved {
  /** Whose links these are; another person signing in clears them. */
  uid: string | null;
  links: Record<string, [string, number]>;
}

/**
 * The memory itself: path → link, in a Map, mirrored to `storage` (when there is one) so a
 * reload still has it. Storage that throws (a private window, a full quota) just leaves the
 * memory in the Map for this page.
 */
export class PhotoLinkStore {
  private links = new Map<string, KeptLink>();
  private uid: string | null = null;
  private loaded = false;
  private dirty = false;

  constructor(
    private readonly storage: StorageLike | null,
    /** Runs `save` soon (the browser: a short timer, so 60 links are one write, not 60). */
    private readonly later: (save: () => void) => void = (save) => save(),
    private readonly key: string = LINK_STORE_KEY,
  ) {}

  private load(nowMs: number): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Saved>;
      this.uid = typeof saved.uid === "string" ? saved.uid : null;
      for (const [path, v] of Object.entries(saved.links ?? {})) {
        if (!Array.isArray(v)) continue;
        const [url, exp] = v;
        if (typeof url === "string" && typeof exp === "number" && exp > nowMs)
          this.links.set(path, { url, exp });
      }
    } catch {
      this.links.clear();
    }
  }

  private touch(nowMs: number): void {
    if (this.dirty) return;
    this.dirty = true;
    this.later(() => this.save(nowMs));
  }

  /**
   * Write the memory out now: links already run out at `nowMs` are left behind, and when there
   * are more than LINK_STORE_MAX the newest are kept.
   */
  save(nowMs: number): void {
    this.dirty = false;
    const live = [...this.links].filter(([, k]) => k.exp > nowMs).slice(-LINK_STORE_MAX);
    this.links = new Map(live);
    try {
      if (!this.storage) return;
      if (live.length === 0 && !this.uid) this.storage.removeItem(this.key);
      else
        this.storage.setItem(
          this.key,
          JSON.stringify({
            uid: this.uid,
            links: Object.fromEntries(live.map(([p, k]) => [p, [k.url, k.exp]])),
          } satisfies Saved),
        );
    } catch {
      // No storage to write to: the Map still serves this page.
    }
  }

  /** The link to show for `path`, given the fresh one just signed for it (or none yet). */
  link(path: string, fresh: string | null | undefined, nowMs: number): string | null {
    this.load(nowMs);
    const { url, remember } = chooseLink(this.links.get(path), fresh, nowMs);
    if (remember) {
      // Re-inserted, so the newest links are the last in the Map (the ones kept when it is full).
      this.links.delete(path);
      this.links.set(path, remember);
      this.touch(nowMs);
    }
    return url;
  }

  /** The remembered link for `path` while it is good, without a fresh one to fall back on. */
  peek(path: string, nowMs: number): string | null {
    this.load(nowMs);
    const kept = this.links.get(path);
    return linkStillGood(kept, nowMs) ? kept.url : null;
  }

  /** The person signed in: links remembered for someone else are dropped. */
  forUser(uid: string, nowMs: number = Date.now()): void {
    this.load(nowMs);
    if (this.uid === uid) return;
    if (this.uid !== null) this.links.clear();
    this.uid = uid;
    this.touch(nowMs);
  }

  /** Sign-out: nothing is kept. */
  clear(): void {
    this.loaded = true;
    this.links.clear();
    this.uid = null;
    this.dirty = false;
    try {
      this.storage?.removeItem(this.key);
    } catch {
      // Nothing was stored.
    }
  }

  /** How many links are remembered (for the tests). */
  get size(): number {
    return this.links.size;
  }
}

/**
 * How long a link a section got for itself counts as fresh, counted from when it got it
 * (useSignedUrl): until it is LINK_MIN_LEFT_MS short of running out — the same point at which a
 * remembered link stops being handed out, so the two never disagree. A link that was already
 * part-used when it was handed out (a remembered one) is fresh for that much less.
 */
export function linkFreshForMs(url: string | null | undefined, gotAtMs: number): number {
  if (!url) return 0;
  return Math.max(0, linkExpiryMs(url, gotAtMs) - gotAtMs - LINK_MIN_LEFT_MS);
}
