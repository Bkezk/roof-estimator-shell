/**
 * Helpers shared by the technician's phone flow and the office ticket page
 * (docs/service-module-design.md §5.3): query keys, loud errors, dates, GPS with a short
 * timeout, and the private "service" bucket (browser upload, signed URLs).
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { createAutosave, type AutosaveState } from "@/lib/autosave";

import { supabase } from "@/integrations/supabase/client";
import { SERVICE_BUCKET } from "@/lib/service-field.functions";

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A failure the tech must not miss (on a roof, in the sun): red, and it stays a while. */
export function loudError(what: string, e: unknown) {
  toast.error(`${what}: ${errText(e)}`, { duration: 12_000 });
}

/** Query keys of the field flow, shared so each screen refreshes the others. */
export const fieldKeys = {
  today: ["service-today"] as const,
  job: (id: string) => ["service-job", id] as const,
  repairs: (id: string) => ["service-job-repairs", id] as const,
  photos: (id: string) => ["service-job-photos", id] as const,
  time: (id: string) => ["service-job-time", id] as const,
  events: (id: string) => ["service-job-events", id] as const,
  materials: (id: string) => ["service-job-materials", id] as const,
  crew: (id: string) => ["service-job-crew", id] as const,
  /** The ticket's purchase orders (the section and the invoice's Internal fold share it). */
  pos: (id: string) => ["service-job-pos", id] as const,
  /** The office → site travel estimate (the close-out's Time section; owner, Oct 9). */
  travelEstimate: (id: string) => ["service-travel-estimate", id] as const,
  /** History at this property (owner, Oct 21): the fold's rows, and the strip's numbers. */
  history: (id: string) => ["site-history", id] as const,
  historySummary: (id: string) => ["site-history-summary", id] as const,
  /** My running clock (owner, Oct 15; myClock): the Today banner, the cards, the close-out line. */
  clock: ["service-my-clock"] as const,
  /** The clock running on a ticket, whoever's (clockOnJob): the office ticket page. */
  jobClock: (id: string) => ["service-job-clock", id] as const,
};

/**
 * Save as the tech types or taps (owner, Sep 30: the field side has no Save button): `push`
 * the latest value; it saves after a short pause, one request at a time (lib/autosave.ts). A
 * failure is a loud toast with the server's message; the value is kept and tried again on the
 * next change, on `flush`, and when the screen closes.
 */
export function useAutosave<T>(
  save: (value: T) => Promise<void>,
  opts: {
    what: string;
    delay?: number;
    /** false: no "Check your signal" (the office's desktop, e.g. the invoice draft; Oct 14). */
    signal?: boolean;
  },
) {
  const [state, setState] = useState<AutosaveState>("idle");
  const saveRef = useRef(save);
  saveRef.current = save;
  const what = useRef(opts.what);
  what.current = opts.what;
  // "Check your signal" is for the field; the office's desktop (the invoice draft) leaves it off.
  const [tail] = useState(opts.signal === false ? "" : ". Check your signal");
  const [saver] = useState(() =>
    createAutosave<T>({
      delay: opts.delay ?? 700,
      save: (v) => saveRef.current(v),
      onState: setState,
      onError: (e) => loudError(`${what.current} did not save${tail}`, e),
    }),
  );
  // Leaving the screen: save what is still waiting.
  useEffect(
    () => () => {
      void saver.flush();
    },
    [saver],
  );
  return { push: saver.push, flush: saver.flush, cancel: saver.cancel, state };
}

/** Shrink a big camera photo (to 2048 px, JPEG) so it uploads on one bar of signal. */
export async function shrinkPhoto(file: File): Promise<{ blob: Blob; type: string; name: string }> {
  const keep = { blob: file as Blob, type: file.type || "image/jpeg", name: file.name };
  if (file.size < 1_500_000 || typeof createImageBitmap === "undefined") return keep;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return keep;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return keep;
    return { blob, type: "image/jpeg", name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
  } catch {
    return keep; // A format the browser cannot decode (e.g. HEIC): upload it as taken.
  }
}

/** Today as YYYY-MM-DD on the phone's own calendar (not UTC). */
export const localYmd = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "8:05 AM". */
export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

/** A date-only column (YYYY-MM-DD) read as a local calendar day: "Mon, Sep 29". */
export const shortDay = (ymd: string | null | undefined) => {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

export const whenShort = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** The phone's position, or null after `timeoutMs` / a refusal. Never throws, never blocks long. */
export function getPosition(timeoutMs = 3000): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    let done = false;
    const finish = (v: { lat: number; lng: number } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => finish({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => finish(null),
        { timeout: timeoutMs, maximumAge: 120_000, enableHighAccuracy: false },
      );
    } catch {
      finish(null);
    }
  });
}

/** Upload a file straight from the browser into the private "service" bucket. */
export async function uploadToServiceBucket(path: string, body: Blob, contentType: string) {
  const { error } = await supabase.storage
    .from(SERVICE_BUCKET)
    .upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(`upload failed (${error.message})`);
}

/** Best effort: drop an uploaded object whose row could not be recorded. */
export async function removeFromServiceBucket(path: string) {
  try {
    await supabase.storage.from(SERVICE_BUCKET).remove([path]);
  } catch {
    // Orphaned object; harmless (the ticket never lists it).
  }
}

/** A one-hour signed URL for a private object (photos, the signature). */
export function useSignedUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ["service-signed-url", path],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(SERVICE_BUCKET)
        .createSignedUrl(path!, 3600);
      if (error || !data) throw new Error(error?.message ?? "no link");
      return data.signedUrl;
    },
    enabled: !!path,
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------------------------
// Pictures added from the office ticket page (owner, Oct 26: "pictures can be added to the
// ticket via the ticket menu on the service page, not just in the service ticket workflow").

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tif",
};

/** The object's extension for a (shrunk) photo's MIME type; the file name's failing that; "jpg". */
export function photoExtension(type: string, fileName = ""): string {
  const fromType = EXT_BY_TYPE[(type.split(";")[0] ?? "").trim().toLowerCase()];
  if (fromType) return fromType;
  const dot = fileName.lastIndexOf(".");
  const fromName =
    dot > 0
      ? fileName
          .slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
      : "";
  return fromName || "jpg";
}

export interface PlannedUpload<T extends { type: string; name: string }> {
  /** The file (shrunk already), in the order it was picked. */
  file: T;
  /** `${jobId}/<uuid>.<ext>` — under the ticket's own folder, as registerJobPhoto requires. */
  path: string;
}

/**
 * Where each picked picture goes in the "service" bucket: `${jobId}/<uuid>.<ext>`, the extension
 * from the (shrunk) file's type, in the order picked. Pure: `uuid` is injectable for tests and
 * for a browser without crypto.randomUUID (an http origin).
 */
export function uploadPlan<T extends { type: string; name: string }>(
  files: readonly T[],
  jobId: string,
  uuid: () => string = randomId,
): PlannedUpload<T>[] {
  return files.map((file) => ({
    file,
    path: `${jobId}/${uuid()}.${photoExtension(file.type, file.name)}`,
  }));
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** "Uploading 2 of 5…" — the progress line while the office's pictures go up one at a time. */
export const uploadingLabel = (done: number, total: number) =>
  `Uploading ${Math.min(done + 1, total)} of ${total}…`;

/** Does a drag carry files (not a photo thumb dragged out to the desktop, not text)? */
export function dragHasFiles(dt: Pick<DataTransfer, "types"> | null | undefined): boolean {
  if (!dt) return false;
  return Array.from(dt.types ?? []).includes("Files");
}

/** The image files among what was dropped or picked (a dropped folder or PDF is left out). */
export function imageFiles(list: ArrayLike<File> | null | undefined): File[] {
  return Array.from(list ?? []).filter(
    (f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name),
  );
}
