import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BID_LOCK_SESSION_KEY, bidLockSessionKey, type KeyStorage } from "./bid-lock-session";

const mem = (): KeyStorage & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe("bidLockSessionKey — a refresh is the same tab (owner, Oct 6)", () => {
  it("the same storage gives the same key across loads", () => {
    const s = mem();
    const a = bidLockSessionKey(s);
    const b = bidLockSessionKey(s);
    expect(b).toBe(a);
    expect(s.m.get(BID_LOCK_SESSION_KEY)).toBe(a);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });
  it("two tabs (two storages) get two keys, so read-only between windows stays", () => {
    expect(bidLockSessionKey(mem())).not.toBe(bidLockSessionKey(mem()));
  });
  it("blocked or missing storage still yields a usable key", () => {
    const throwing: KeyStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(bidLockSessionKey(throwing).length).toBeGreaterThanOrEqual(8);
    expect(bidLockSessionKey(null).length).toBeGreaterThanOrEqual(8);
  });
  it("a corrupt stored value is replaced", () => {
    const s = mem();
    s.m.set(BID_LOCK_SESSION_KEY, "x");
    const k = bidLockSessionKey(s);
    expect(k).not.toBe("x");
    expect(s.m.get(BID_LOCK_SESSION_KEY)).toBe(k);
  });
});

describe("the hook uses it", () => {
  it("useBidLock takes its session key from sessionStorage, not a fresh id per mount", () => {
    const src = readFileSync(fileURLToPath(new URL("./use-bid-lock.ts", import.meta.url)), "utf8");
    expect(src).toContain("bidLockSessionKey(");
    expect(src).toContain("sessionStorage");
    expect(src).not.toMatch(
      /useState\(\(\) =>\s*typeof crypto !== "undefined" && "randomUUID" in crypto/,
    );
  });
});
