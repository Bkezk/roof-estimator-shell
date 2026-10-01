/**
 * Debounced auto-save for the technician's field screens (owner, Sep 30: everything on the
 * field side saves as it is filled out — no Save button). Framework-free so it is testable; the
 * React hook is useAutosave in components/service/field-utils.ts.
 *
 * - push(v) keeps only the latest value and saves it `delay` ms after the last push;
 * - one save runs at a time: a push during a save is saved right after it (never lost, never
 *   two requests racing each other);
 * - flush() saves a pending value now (leaving the screen, Complete);
 * - the state goes pending → saving → saved, or error (the caller shows a loud toast; the value
 *   stays pending so the next push or flush tries again).
 */

export type AutosaveState = "idle" | "pending" | "saving" | "saved" | "error";

export interface Autosaver<T> {
  push(value: T): void;
  flush(): Promise<void>;
  cancel(): void;
  readonly state: AutosaveState;
}

export function createAutosave<T>(opts: {
  delay: number;
  save: (value: T) => Promise<void>;
  onState?: ((s: AutosaveState) => void) | undefined;
  onError?: ((e: unknown, value: T) => void) | undefined;
}): Autosaver<T> {
  let state: AutosaveState = "idle";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hasPending = false;
  let pending: T | undefined;
  let running: Promise<void> | null = null;

  const set = (s: AutosaveState) => {
    state = s;
    opts.onState?.(s);
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const run = async (): Promise<void> => {
    clear();
    if (running) {
      // Wait for the save in flight; the loop below picks up what arrived meanwhile.
      await running;
      return;
    }
    const loop = async () => {
      while (hasPending) {
        const value = pending as T;
        hasPending = false;
        pending = undefined;
        set("saving");
        try {
          await opts.save(value);
          set(hasPending ? "pending" : "saved");
        } catch (e) {
          // Keep the value (unless a newer one came) so the next push / flush tries again.
          if (!hasPending) {
            hasPending = true;
            pending = value;
          }
          set("error");
          opts.onError?.(e, value);
          return;
        }
      }
    };
    running = loop().finally(() => {
      running = null;
    });
    await running;
  };

  return {
    push(value: T) {
      hasPending = true;
      pending = value;
      if (state !== "saving") set("pending");
      clear();
      timer = setTimeout(() => void run(), opts.delay);
    },
    flush() {
      if (!hasPending && !running) return Promise.resolve();
      return run();
    },
    cancel() {
      clear();
      hasPending = false;
      pending = undefined;
    },
    get state() {
      return state;
    },
  };
}
