/**
 * The one picture queue (owner, Oct 28): pick order, the caps (2 shrinking, 3 uploading), grouping
 * by ticket / repair / item / role, Retry, the completion callbacks; the store (every shrunk
 * picture is kept until its row is registered, then dropped; restore puts it back in line);
 * no signal (held, "N pictures waiting for signal", resumed by `resume()`); marks drawn before
 * the row exists are saved onto it once it does; and the phone-camera-only rule for the editor.
 */
import { describe, expect, it, vi } from "vitest";

import {
  isSignalFailure,
  matchesTarget,
  memoryPictureStore,
  PhotoUploadQueue,
  pictureRegistration,
  shouldMarkUpAfterShot,
  summarize,
  uploadingBadge,
  waitingForSignalLine,
  type PictureTarget,
  type QueueDeps,
  type ShrunkPicture,
} from "./photo-upload-queue";

const JOB = "0f4a3b1e-7c2d-4e5f-9a8b-1c2d3e4f5a6b";
const JOB2 = "1f4a3b1e-7c2d-4e5f-9a8b-1c2d3e4f5a6c";
const loose = (jobId = JOB): PictureTarget => ({
  jobId,
  repairId: null,
  itemKey: null,
  role: "other",
});
const onRepair = (repairId: string, role: "before" | "after"): PictureTarget => ({
  jobId: JOB,
  repairId,
  itemKey: null,
  role,
});

interface Row {
  id: string;
  storage_path: string;
}

/** A hand-cranked promise: the test decides when a shrink / upload / register answers. */
interface Gate<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function gate<T>(): Gate<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const settle = async (n = 6) => {
  for (let i = 0; i < n; i++) await tick();
};

const file = (name: string, size = 2_000_000, lastModified = 1_700_000_000_000): File =>
  ({ name, size, type: "image/jpeg", lastModified }) as unknown as File;

/** Deps that answer at once (or as `opts` says), recording every call. */
function harness(
  opts: {
    online?: () => boolean;
    shrinkGate?: boolean;
    uploadGate?: boolean;
    registerGate?: boolean;
    registerFails?: (data: { storage_path: string }) => unknown;
    uploadFails?: (path: string) => unknown;
    store?: ReturnType<typeof memoryPictureStore>;
  } = {},
) {
  const store = opts.store ?? memoryPictureStore();
  const calls = {
    shrink: [] as string[],
    upload: [] as string[],
    register: [] as string[],
    removed: [] as string[],
    marks: [] as { row: string; marks: unknown }[],
  };
  const gates = {
    shrink: [] as Gate<ShrunkPicture>[],
    upload: [] as Gate<void>[],
    register: [] as Gate<Row>[],
  };
  let n = 0;
  const deps: QueueDeps<Row> = {
    shrink: async (f) => {
      calls.shrink.push(f.name);
      const shrunk: ShrunkPicture = {
        blob: new Blob(["x"]),
        type: "image/jpeg",
        name: f.name.replace(/\.\w+$/, ".jpg"),
      };
      if (!opts.shrinkGate) return shrunk;
      const g = gate<ShrunkPicture>();
      gates.shrink.push(g);
      return g.promise;
    },
    upload: async (path) => {
      calls.upload.push(path);
      if (opts.uploadFails) {
        const e = opts.uploadFails(path);
        if (e) throw e;
      }
      if (!opts.uploadGate) return;
      const g = gate<void>();
      gates.upload.push(g);
      return g.promise;
    },
    removeUpload: async (path) => {
      calls.removed.push(path);
    },
    register: async (data) => {
      calls.register.push(data.storage_path);
      if (opts.registerFails) {
        const e = opts.registerFails(data);
        if (e) throw e;
      }
      const row: Row = { id: `row-${data.storage_path}`, storage_path: data.storage_path };
      if (!opts.registerGate) return row;
      const g = gate<Row>();
      gates.register.push(g);
      return g.promise;
    },
    saveMarks: async (row, marks) => {
      calls.marks.push({ row: row.id, marks });
    },
    store,
    online: opts.online ?? (() => true),
    pathFor: (jobId, p) => `${jobId}/${p.name}`,
    now: () => 1_000 + n++,
    id: () => `p${++n}`,
  };
  const events = {
    onRegistered: vi.fn(),
    onFailed: vi.fn(),
    onHeld: vi.fn(),
    onMarksFailed: vi.fn(),
    onStoreError: vi.fn(),
  };
  const queue = new PhotoUploadQueue<Row>(deps, events);
  return { queue, deps, calls, gates, events, store };
}

const statuses = (q: PhotoUploadQueue<Row>) => q.snapshot().map((e) => `${e.fileName}:${e.status}`);

describe("the queue runs pictures in pick order", () => {
  it("shrinks, uploads and registers each picked file, then drops it from the list with the row", async () => {
    const { queue, calls, events } = harness();
    const ids = queue.add([file("a.heic"), file("b.heic")], loose());
    expect(ids).toHaveLength(2);
    expect(queue.snapshot().map((e) => e.status)).toEqual(["shrinking", "shrinking"]);
    await settle();
    expect(calls.shrink).toEqual(["a.heic", "b.heic"]);
    expect(calls.upload).toEqual([`${JOB}/a.jpg`, `${JOB}/b.jpg`]);
    expect(calls.register).toEqual([`${JOB}/a.jpg`, `${JOB}/b.jpg`]);
    expect(queue.snapshot()).toEqual([]);
    expect(events.onRegistered).toHaveBeenCalledTimes(2);
    const [entry, row] = events.onRegistered.mock.calls[0]!;
    expect(entry.fileName).toBe("a.heic");
    expect(row.id).toBe(`row-${JOB}/a.jpg`);
    expect(events.onFailed).not.toHaveBeenCalled();
  });

  it("shrinks at most 2 at once and uploads at most 3 at once, in order", async () => {
    const { queue, calls, gates } = harness({ shrinkGate: true, uploadGate: true });
    queue.add(
      ["a", "b", "c", "d", "e", "f"].map((n) => file(`${n}.jpg`)),
      loose(),
    );
    await settle();
    expect(calls.shrink).toEqual(["a.jpg", "b.jpg"]);
    expect(statuses(queue)).toEqual([
      "a.jpg:shrinking",
      "b.jpg:shrinking",
      "c.jpg:waiting",
      "d.jpg:waiting",
      "e.jpg:waiting",
      "f.jpg:waiting",
    ]);
    // Two shrinks land: c and d start shrinking, a and b start uploading.
    gates.shrink[0]!.resolve({ blob: new Blob(["a"]), type: "image/jpeg", name: "a.jpg" });
    gates.shrink[1]!.resolve({ blob: new Blob(["b"]), type: "image/jpeg", name: "b.jpg" });
    await settle();
    expect(calls.shrink).toEqual(["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
    expect(calls.upload).toEqual([`${JOB}/a.jpg`, `${JOB}/b.jpg`]);
    for (const i of [2, 3])
      gates.shrink[i]!.resolve({
        blob: new Blob(["x"]),
        type: "image/jpeg",
        name: `${"abcd"[i]}.jpg`,
      });
    await settle();
    // e and f shrink now; c uploads (the third slot); d waits for a slot.
    expect(calls.shrink).toEqual(["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg", "f.jpg"]);
    expect(calls.upload).toEqual([`${JOB}/a.jpg`, `${JOB}/b.jpg`, `${JOB}/c.jpg`]);
    expect(statuses(queue)).toEqual([
      "a.jpg:uploading",
      "b.jpg:uploading",
      "c.jpg:uploading",
      "d.jpg:waiting",
      "e.jpg:shrinking",
      "f.jpg:shrinking",
    ]);
    // One upload lands (and registers at once): d takes its slot.
    gates.upload[0]!.resolve(undefined);
    await settle();
    expect(calls.upload).toEqual([`${JOB}/a.jpg`, `${JOB}/b.jpg`, `${JOB}/c.jpg`, `${JOB}/d.jpg`]);
    expect(calls.register).toEqual([`${JOB}/a.jpg`]);
    expect(queue.snapshot().find((e) => e.fileName === "a.jpg")).toBeUndefined();
  });

  it("groups by ticket, repair, item and role (matchesTarget / summarize) without mixing tickets", async () => {
    const { queue } = harness({ uploadGate: true });
    queue.add([file("a.jpg")], loose(JOB));
    queue.add([file("b.jpg")], loose(JOB2));
    queue.add([file("c.jpg"), file("d.jpg")], onRepair("r1", "before"));
    queue.add([file("e.jpg")], onRepair("r1", "after"));
    queue.add([file("f.jpg")], { jobId: JOB, repairId: null, itemKey: "seams", role: "other" });
    await settle();
    const all = queue.snapshot();
    const of = (f: Partial<PictureTarget>) =>
      all.filter((e) => matchesTarget(e, f)).map((e) => e.fileName);
    expect(of({ jobId: JOB })).toEqual(["a.jpg", "c.jpg", "d.jpg", "e.jpg", "f.jpg"]);
    expect(of({ jobId: JOB2 })).toEqual(["b.jpg"]);
    expect(of({ jobId: JOB, repairId: "r1" })).toEqual(["c.jpg", "d.jpg", "e.jpg"]);
    expect(of({ jobId: JOB, repairId: "r1", role: "before" })).toEqual(["c.jpg", "d.jpg"]);
    expect(of({ jobId: JOB, itemKey: "seams" })).toEqual(["f.jpg"]);
    expect(of({ jobId: JOB, repairId: null, itemKey: null })).toEqual(["a.jpg"]);
    expect(summarize(all.filter((e) => matchesTarget(e, { jobId: JOB })))).toEqual({
      uploading: 5,
      waitingForSignal: 0,
      failed: 0,
    });
  });
});

describe("failures", () => {
  it("a server refusal is loud (onFailed names the file), removes the object, and never blocks the rest", async () => {
    const { queue, calls, events } = harness({
      registerFails: (d) =>
        d.storage_path.endsWith("bad.jpg")
          ? new Error("The photo must be stored under the ticket's own folder")
          : null,
    });
    queue.add([file("bad.jpg"), file("good.jpg")], loose());
    await settle();
    expect(calls.register).toEqual([`${JOB}/bad.jpg`, `${JOB}/good.jpg`]);
    expect(calls.removed).toEqual([`${JOB}/bad.jpg`]);
    expect(statuses(queue)).toEqual(["bad.jpg:failed"]);
    expect(queue.snapshot()[0]!.error).toMatch(/ticket's own folder/);
    expect(events.onFailed).toHaveBeenCalledTimes(1);
    expect(events.onFailed.mock.calls[0]![0].fileName).toBe("bad.jpg");
    expect(events.onRegistered).toHaveBeenCalledTimes(1);
    expect(summarize(queue.snapshot())).toEqual({ uploading: 0, waitingForSignal: 0, failed: 1 });
  });

  it("Retry runs a failed picture again from the shrunk picture (no second shrink); Discard drops it and its stored copy", async () => {
    let refuse = true;
    const { queue, calls, store } = harness({
      registerFails: () => (refuse ? new Error("no") : null),
    });
    const [id] = queue.add([file("a.jpg")], loose());
    await settle();
    expect(statuses(queue)).toEqual(["a.jpg:failed"]);
    expect(store.size()).toBe(1); // kept on the phone until the row exists
    // The refused object was removed, so the stored copy must not point at it (a restore would
    // otherwise register a row on nothing).
    expect((await store.all())[0]!.uploadedPath).toBe(null);
    refuse = false;
    queue.retry(id!);
    await settle();
    expect(calls.shrink).toEqual(["a.jpg"]);
    expect(calls.upload).toHaveLength(2); // the refused object was removed; a fresh upload
    expect(queue.snapshot()).toEqual([]);
    expect(store.size()).toBe(0);

    refuse = true;
    const [id2] = queue.add([file("b.jpg")], loose());
    await settle();
    expect(store.size()).toBe(1);
    queue.discard(id2!);
    await settle();
    expect(queue.snapshot()).toEqual([]);
    expect(store.size()).toBe(0);
  });

  it("a shrink that throws fails that picture only", async () => {
    const { queue, deps, events } = harness();
    deps.shrink = async (f) => {
      if (f.name === "a.jpg") throw new Error("cannot decode");
      return { blob: new Blob(["x"]), type: "image/jpeg", name: f.name };
    };
    queue.add([file("a.jpg"), file("b.jpg")], loose());
    await settle();
    expect(statuses(queue)).toEqual(["a.jpg:failed"]);
    expect(events.onRegistered).toHaveBeenCalledTimes(1);
  });
});

describe("no signal", () => {
  it("holds a picture whose upload fails for a signal reason, keeps it stored shrunk, and resumes it on resume()", async () => {
    let online = false;
    const { queue, calls, events, store } = harness({ online: () => online });
    queue.add([file("a.jpg")], loose());
    await settle();
    expect(statuses(queue)).toEqual(["a.jpg:held"]);
    expect(calls.upload).toEqual([]); // offline: nothing is even tried
    expect(events.onHeld).toHaveBeenCalledTimes(1);
    expect(store.size()).toBe(1);
    expect((await store.all())[0]!.picture.name).toBe("a.jpg"); // the SHRUNK picture
    expect(summarize(queue.snapshot())).toEqual({ uploading: 0, waitingForSignal: 1, failed: 0 });
    expect(waitingForSignalLine(summarize(queue.snapshot()).waitingForSignal)).toBe(
      "1 picture waiting for signal",
    );

    online = true;
    expect(queue.resume()).toBe(1);
    await settle();
    expect(calls.upload).toEqual([`${JOB}/a.jpg`]);
    expect(queue.snapshot()).toEqual([]);
    expect(store.size()).toBe(0); // dropped only once registered
    expect(events.onRegistered).toHaveBeenCalledTimes(1);
  });

  it("a fetch that never got an answer while onLine says true is a signal failure too; the next pick resumes it", async () => {
    let fail = true;
    const { queue, calls } = harness({
      uploadFails: () => (fail ? new TypeError("Failed to fetch") : null),
    });
    queue.add([file("a.jpg")], loose());
    await settle();
    expect(statuses(queue)).toEqual(["a.jpg:held"]);
    fail = false;
    queue.add([file("b.jpg")], loose());
    await settle();
    expect(calls.upload.filter((p) => p.endsWith("a.jpg"))).toHaveLength(2);
    expect(queue.snapshot()).toEqual([]);
  });

  it("an upload that landed but a register the signal dropped retries the register only (the object is kept)", async () => {
    let fail = true;
    const { queue, calls } = harness({
      registerFails: () => (fail ? new TypeError("Load failed") : null),
    });
    queue.add([file("a.jpg")], loose());
    await settle();
    expect(statuses(queue)).toEqual(["a.jpg:held"]);
    expect(calls.removed).toEqual([]);
    fail = false;
    queue.resume();
    await settle();
    expect(calls.upload).toEqual([`${JOB}/a.jpg`]);
    expect(calls.register).toEqual([`${JOB}/a.jpg`, `${JOB}/a.jpg`]);
    expect(queue.snapshot()).toEqual([]);
  });

  it("restore() puts the stored pictures back in line (held while offline) and registers them with their ticket, item and GPS", async () => {
    const store = memoryPictureStore();
    await store.put({
      id: "kept-1",
      target: { jobId: JOB, repairId: null, itemKey: "flashing", role: "other" },
      fileName: "IMG_1.HEIC",
      takenAt: "2026-10-28T15:00:00.000Z",
      addedAt: 5,
      picture: { blob: new Blob(["z"]), type: "image/jpeg", name: "IMG_1.jpg" },
      where: { lat: 36.1, lng: -86.7 },
      heldMarks: null,
      uploadedPath: null,
    });
    let online = false;
    const registered: unknown[] = [];
    const { queue, deps, store: s } = harness({ online: () => online, store });
    const reg = deps.register;
    deps.register = async (d) => {
      registered.push(d);
      return reg(d);
    };
    expect(await queue.restore()).toBe(1);
    expect(statuses(queue)).toEqual(["IMG_1.HEIC:held"]);
    online = true;
    queue.resume();
    await settle();
    expect(registered).toEqual([
      {
        service_job_id: JOB,
        repair_id: null,
        item_key: "flashing",
        role: "other",
        storage_path: `${JOB}/IMG_1.jpg`,
        file_name: "IMG_1.jpg",
        file_size: 1,
        taken_at: "2026-10-28T15:00:00.000Z",
        lat: 36.1,
        lng: -86.7,
      },
    ]);
    expect(s.size()).toBe(0);
    expect(await queue.restore()).toBe(0); // nothing left; a second restore adds nothing
  });

  it("a store that throws is reported once and the queue carries on in memory", async () => {
    const broken = {
      put: async () => {
        throw new Error("InvalidStateError");
      },
      remove: async () => {},
      all: async () => [],
    };
    const { queue, events } = harness({
      store: broken as unknown as ReturnType<typeof memoryPictureStore>,
    });
    queue.add([file("a.jpg"), file("b.jpg")], loose());
    await settle();
    expect(queue.snapshot()).toEqual([]);
    expect(events.onRegistered).toHaveBeenCalledTimes(2);
    expect(events.onStoreError).toHaveBeenCalledTimes(1);
  });
});

describe("marks drawn right after the shot", () => {
  const marks = {
    v: 1,
    marks: [
      {
        id: "m1",
        kind: "ellipse" as const,
        color: "red" as const,
        a: [0.1, 0.1] as [number, number],
        b: [0.4, 0.4] as [number, number],
      },
    ],
  };
  it("held until the row is registered, then saved onto it", async () => {
    const { queue, calls, gates } = harness({ registerGate: true });
    const [id] = queue.add([file("a.jpg")], onRepair("r1", "before"), { fromCamera: true });
    await settle();
    expect(statuses(queue)).toEqual(["a.jpg:uploading"]);
    await queue.attachMarks(id!, marks as never);
    expect(queue.snapshot()[0]!.heldMarks).toEqual(marks);
    expect(calls.marks).toEqual([]);
    gates.register[0]!.resolve({ id: "row-1", storage_path: `${JOB}/a.jpg` });
    await settle();
    expect(calls.marks).toEqual([{ row: "row-1", marks }]);
    expect(queue.snapshot()).toEqual([]);
  });
  it("saved at once when Done comes after the row landed", async () => {
    const { queue, calls } = harness();
    const [id] = queue.add([file("a.jpg")], onRepair("r1", "before"), { fromCamera: true });
    await settle();
    expect(queue.snapshot()).toEqual([]);
    await queue.attachMarks(id!, marks as never);
    expect(calls.marks).toEqual([{ row: `row-${JOB}/a.jpg`, marks }]);
  });
  it("held marks ride along in the store, so a picture restored later still gets them", async () => {
    const store = memoryPictureStore();
    const { queue } = harness({ online: () => false, store });
    const [id] = queue.add([file("a.jpg")], loose(), { fromCamera: true });
    await settle();
    await queue.attachMarks(id!, marks as never);
    expect((await store.all())[0]!.heldMarks).toEqual(marks);
  });
  it("the entry remembers the shot came from the camera", () => {
    const { queue } = harness({ shrinkGate: true });
    queue.add([file("a.jpg")], loose(), { fromCamera: true });
    queue.add([file("b.jpg")], loose());
    expect(queue.snapshot().map((e) => e.fromCamera)).toEqual([true, false]);
  });
});

describe("shouldMarkUpAfterShot — the phone's camera only", () => {
  it("opens for a capture input on a touch device", () => {
    expect(shouldMarkUpAfterShot({ capture: "environment", coarsePointer: true })).toBe(true);
    expect(shouldMarkUpAfterShot({ capture: true, coarsePointer: true })).toBe(true);
  });
  it("never on a computer (fine pointer), even with capture on the input", () => {
    expect(shouldMarkUpAfterShot({ capture: "environment", coarsePointer: false })).toBe(false);
  });
  it("never for the camera roll / files (no capture), on any device", () => {
    expect(shouldMarkUpAfterShot({ capture: null, coarsePointer: true })).toBe(false);
    expect(shouldMarkUpAfterShot({ capture: undefined, coarsePointer: true })).toBe(false);
    expect(shouldMarkUpAfterShot({ capture: "", coarsePointer: true })).toBe(false);
    expect(shouldMarkUpAfterShot({ capture: false, coarsePointer: false })).toBe(false);
  });
});

describe("words and helpers", () => {
  it("isSignalFailure: offline, or a fetch that got no answer; not a server's refusal", () => {
    expect(
      isSignalFailure(new Error("The photo must be stored under the ticket's own folder"), false),
    ).toBe(true);
    expect(isSignalFailure(new TypeError("Failed to fetch"), true)).toBe(true);
    expect(isSignalFailure(new Error("upload failed (Load failed)"), true)).toBe(true);
    expect(
      isSignalFailure(new Error("NetworkError when attempting to fetch resource."), true),
    ).toBe(true);
    expect(
      isSignalFailure(new Error("The photo must be stored under the ticket's own folder"), true),
    ).toBe(false);
    expect(isSignalFailure(new Error("Unauthorized"), true)).toBe(false);
  });
  it("the badge and the line never say offline, network or sync", () => {
    expect(uploadingBadge(0)).toBe(null);
    expect(uploadingBadge(3)).toBe("3 uploading");
    expect(waitingForSignalLine(0)).toBe(null);
    expect(waitingForSignalLine(1)).toBe("1 picture waiting for signal");
    expect(waitingForSignalLine(3)).toBe("3 pictures waiting for signal");
    for (const s of [uploadingBadge(3)!, waitingForSignalLine(3)!])
      expect(s).not.toMatch(/offline|network|sync/i);
  });
  it("pictureRegistration: the row as registerJobPhoto takes it, named after the shrunk file", () => {
    expect(
      pictureRegistration(
        {
          target: onRepair("r1", "after"),
          fileName: "IMG_9.HEIC",
          takenAt: "2026-10-28T15:04:05.000Z",
          picture: { blob: new Blob(["abc"]), type: "image/jpeg", name: "IMG_9.jpg" },
          where: null,
        },
        `${JOB}/u1.jpg`,
      ),
    ).toEqual({
      service_job_id: JOB,
      repair_id: "r1",
      item_key: null,
      role: "after",
      storage_path: `${JOB}/u1.jpg`,
      file_name: "IMG_9.jpg",
      file_size: 3,
      taken_at: "2026-10-28T15:04:05.000Z",
      lat: null,
      lng: null,
    });
  });
});
