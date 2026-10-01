import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAutosave, type AutosaveState } from "@/lib/autosave";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("field auto-save", () => {
  it("saves only the latest value, once, after the pause", async () => {
    const saved: string[] = [];
    const states: AutosaveState[] = [];
    const a = createAutosave<string>({
      delay: 600,
      save: async (v) => {
        saved.push(v);
      },
      onState: (s) => states.push(s),
    });
    a.push("h");
    a.push("he");
    await vi.advanceTimersByTimeAsync(300);
    a.push("hey");
    await vi.advanceTimersByTimeAsync(599);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual(["hey"]);
    expect(a.state).toBe("saved");
    expect(states.at(-2)).toBe("saving");
  });

  it("never runs two saves at once and never drops a value typed during a save", async () => {
    let release: () => void = () => {};
    let inFlight = 0;
    let most = 0;
    const saved: number[] = [];
    const a = createAutosave<number>({
      delay: 100,
      save: (v) =>
        new Promise<void>((res) => {
          inFlight++;
          most = Math.max(most, inFlight);
          release = () => {
            inFlight--;
            saved.push(v);
            res();
          };
        }),
    });
    a.push(1);
    await vi.advanceTimersByTimeAsync(100);
    a.push(2);
    a.push(3);
    await vi.advanceTimersByTimeAsync(100);
    release();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(200);
    expect(saved).toEqual([1, 3]);
    expect(most).toBe(1);
    expect(a.state).toBe("saved");
  });

  it("reports a failure and keeps the value so the next flush tries again", async () => {
    let fail = true;
    const saved: string[] = [];
    const onError = vi.fn();
    const a = createAutosave<string>({
      delay: 50,
      save: async (v) => {
        if (fail) throw new Error("no signal");
        saved.push(v);
      },
      onError,
    });
    a.push("notes");
    await vi.advanceTimersByTimeAsync(50);
    expect(a.state).toBe("error");
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe("no signal");
    fail = false;
    await a.flush();
    expect(saved).toEqual(["notes"]);
    expect(a.state).toBe("saved");
  });

  it("flush saves a pending value at once; cancel drops it", async () => {
    const saved: string[] = [];
    const a = createAutosave<string>({
      delay: 10_000,
      save: async (v) => {
        saved.push(v);
      },
    });
    a.push("x");
    await a.flush();
    expect(saved).toEqual(["x"]);
    a.push("y");
    a.cancel();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(saved).toEqual(["x"]);
    await a.flush();
    expect(saved).toEqual(["x"]);
  });
});
