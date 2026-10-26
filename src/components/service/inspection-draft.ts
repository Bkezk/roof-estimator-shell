/**
 * The inspection checklist as it is answered (owner, Oct 12: "the checklist saves as you go like
 * the other fields"). One hook for the tech's close-out (step 2 · Checklist, step 3's "Recommend
 * repairs" switch) and the office's ticket page (inspection-section.tsx): it reads the ticket's
 * inspection (getTicketInspection), holds the draft — the visible checklist rows with their
 * answers (inspection.ts visibleChecklist: the seed's "Recommend repairs" row is hidden, the
 * switch asks it) and the switch — saves it a moment after a change stops (useAutosave →
 * saveTicketInspection; a loud toast when it fails, the value kept and tried again), and says
 * whether what is on screen is what the server holds (`saved`). The manual "Save inspection"
 * button is gone from both screens.
 *
 * Like the close-out's text draft (closeout.tsx TextDraft), the answers are also kept in
 * localStorage per ticket (bid-o-matic:closeout-inspection:<id>) until the server has them, so a
 * lost signal on the roof does not lose a checklist; a draft found on open that differs from the
 * server's is restored and saved. Complete clears it (clearInspectionDraft).
 *
 * Owner, Oct 26: only a problem needs a status or a note, so a checklist nobody flagged anything
 * on is a valid answer — but it is not saved until something sends it. `saved` is therefore false
 * while the server holds no inspection JSON at all (`hasRecord`), and `saveNow` (Complete, the
 * "Save now" button) sends the draft as it stands in that case, so an all-OK roof is recorded.
 * The draft also carries Property Inspected / Property Grade (`inspected_on`, `grade`).
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import type { ServiceJobRow } from "@/lib/service.functions";
import {
  getTicketInspection,
  saveTicketInspection,
  type TicketInspection,
} from "@/lib/service-inspection.functions";
import {
  INSPECTION_STATUSES,
  asInspectionGrade,
  inspectionPayload,
  mergeChecklist,
  visibleChecklist,
  type Inspection,
  type InspectionDraftFields,
  type InspectionGrade,
  type InspectionItem,
} from "@/lib/inspection";
import { fieldKeys, useAutosave } from "@/components/service/field-utils";

export const inspectionKey = (jobId: string) => ["service-inspection", jobId] as const;

/** What the screen edits and the autosave sends (inspection.ts InspectionDraftFields). */
export type InspectionDraft = InspectionDraftFields;

const draftKey = (id: string) => `bid-o-matic:closeout-inspection:${id}`;
const isStatus = (v: unknown): v is InspectionItem["status"] =>
  v === null || (INSPECTION_STATUSES as readonly unknown[]).includes(v);
function readInspectionDraft(id: string): InspectionDraft | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<InspectionDraft>;
    if (typeof d !== "object" || d === null || !Array.isArray(d.items)) return null;
    const items: InspectionItem[] = [];
    for (const i of d.items as unknown[]) {
      if (typeof i !== "object" || i === null) return null;
      const o = i as Record<string, unknown>;
      if (typeof o["id"] !== "string" || typeof o["label"] !== "string" || !isStatus(o["status"]))
        return null;
      items.push({
        id: o["id"],
        label: o["label"],
        status: o["status"],
        note: typeof o["note"] === "string" ? o["note"] : "",
      });
    }
    return {
      items,
      recommend_repairs: d.recommend_repairs === true,
      inspected_on: typeof d.inspected_on === "string" ? d.inspected_on : null,
      grade: asInspectionGrade(d.grade),
    };
  } catch {
    return null;
  }
}
function writeInspectionDraft(id: string, d: InspectionDraft) {
  try {
    window.localStorage.setItem(draftKey(id), JSON.stringify(d));
  } catch {
    // Storage blocked (private mode): the draft lives only in this screen.
  }
}
export function clearInspectionDraft(id: string) {
  try {
    window.localStorage.removeItem(draftKey(id));
  } catch {
    // Nothing to clear.
  }
}

/** The server's record as a draft: its answers merged with the live checklist, hidden rows out. */
const fromServer = (data: TicketInspection): InspectionDraft => ({
  items: visibleChecklist(mergeChecklist(data.inspection, data.checklist)),
  recommend_repairs: data.inspection?.recommend_repairs ?? false,
  inspected_on: data.inspection?.inspected_on ?? null,
  grade: data.inspection?.grade ?? null,
});
/** The draft as the server takes it (notes trimmed, a blank date null): what is compared and sent. */
const trimmed = inspectionPayload;
const sameDraft = (a: InspectionDraft, b: InspectionDraft) =>
  JSON.stringify(trimmed(a)) === JSON.stringify(trimmed(b));

export interface InspectionDraftState {
  /** The read: its rows when it answered (the checklist and the saved record). */
  data: TicketInspection | undefined;
  loading: boolean;
  error: unknown;
  /** The visible checklist rows with the draft's answers ([] until the read answers). */
  items: InspectionItem[];
  recommendRepairs: boolean;
  /** Property Inspected (YYYY-MM-DD, "" when blank) and Property Grade (owner, Oct 26). */
  inspectedOn: string;
  grade: InspectionGrade | null;
  /**
   * What is on screen is what the server holds (nothing waiting, nothing failed) — and the
   * server holds a record at all: a checklist never saved is not saved, even untouched.
   */
  saved: boolean;
  /** The server has an inspection JSON for this ticket (a save landed, now or before). */
  hasRecord: boolean;
  state: ReturnType<typeof useAutosave>["state"];
  setItem: (id: string, patch: Partial<InspectionItem>) => void;
  setRecommendRepairs: (on: boolean) => void;
  setInspectedOn: (ymd: string) => void;
  setGrade: (grade: InspectionGrade | null) => void;
  /**
   * Save what is waiting now (Complete, the "Save now" button). With no record on the server
   * yet, the draft as it stands is sent — a checklist with nothing flagged is a real answer.
   */
  saveNow: () => Promise<void>;
}

/**
 * The checklist draft for one ticket. `enabled` false (a repair ticket, or a reader who cannot
 * edit) reads nothing / saves nothing; the hook is still called so the screen's hooks stay in
 * order.
 */
export function useInspectionDraft(
  job: ServiceJobRow,
  opts: { enabled: boolean; readOnly?: boolean | undefined },
): InspectionDraftState {
  const { session } = useAuth();
  const qc = useQueryClient();
  const getFn = useServerFn(getTicketInspection);
  const saveFn = useServerFn(saveTicketInspection);
  const q = useQuery({
    queryKey: inspectionKey(job.id),
    queryFn: () => getFn({ data: { id: job.id } }),
    enabled: !!session && opts.enabled,
    staleTime: 30_000,
  });

  const [draft, setDraft] = useState<InspectionDraft | null>(null);
  const latest = useRef<InspectionDraft | null>(null);
  // The server's record as this screen last knew it (the read, then each save's answer).
  const [snapshot, setSnapshot] = useState<InspectionDraft | null>(null);
  // Whether the server holds any inspection JSON (the read's answer, then true once a save lands).
  const [hasRecord, setHasRecord] = useState(false);

  const landed = (ins: Inspection) => {
    setHasRecord(true);
    const data = q.data;
    if (data) {
      const next: TicketInspection = { ...data, inspection: ins };
      setSnapshot(fromServer(next));
      qc.setQueryData<TicketInspection>(inspectionKey(job.id), (old) =>
        old ? { ...old, inspection: ins } : old,
      );
    }
    // The ticket row carries it too (the section header, the office's actions, the Done notice).
    qc.setQueryData<ServiceJobRow>(fieldKeys.job(job.id), (old) =>
      old ? { ...old, inspection: ins as unknown as ServiceJobRow["inspection"] } : old,
    );
    void qc.invalidateQueries({ queryKey: fieldKeys.events(job.id) });
  };

  const autosave = useAutosave<InspectionDraft>(
    async (d) => {
      const ins = await saveFn({ data: { id: job.id, inspection: trimmed(d) } });
      landed(ins);
      if (latest.current && sameDraft(d, latest.current)) clearInspectionDraft(job.id);
    },
    { what: "The checklist" },
  );

  // The first answer of the read starts the draft: the phone's copy when it has one (restored
  // and saved when it differs from the server's), else the server's.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !q.data) return;
    started.current = true;
    const server = fromServer(q.data);
    setSnapshot(server);
    setHasRecord(q.data.inspection !== null);
    const stored = opts.readOnly ? null : readInspectionDraft(job.id);
    const first = stored ?? server;
    latest.current = first;
    setDraft(first);
    if (stored && !sameDraft(stored, server)) {
      toast.info("Restored the checklist answers you gave here before; saving them now.");
      autosave.push(stored);
    }
  }, [q.data, job.id, opts.readOnly, autosave]);

  const update = (patch: Partial<InspectionDraft>) => {
    if (opts.readOnly || !latest.current) return;
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setDraft(next);
    writeInspectionDraft(job.id, next);
    autosave.push(next);
  };

  return {
    data: q.data,
    loading: opts.enabled && q.isLoading,
    error: q.error,
    items: draft?.items ?? [],
    recommendRepairs: draft?.recommend_repairs ?? false,
    inspectedOn: draft?.inspected_on ?? "",
    grade: draft?.grade ?? null,
    saved: hasRecord && draft !== null && snapshot !== null && sameDraft(draft, snapshot),
    hasRecord,
    state: autosave.state,
    setItem: (id, patch) =>
      update({
        items: (latest.current?.items ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)),
      }),
    setRecommendRepairs: (on) => update({ recommend_repairs: on }),
    setInspectedOn: (ymd) => update({ inspected_on: ymd || null }),
    setGrade: (grade) => update({ grade }),
    saveNow: async () => {
      // Nothing flagged and nothing ever saved: the untouched draft is the answer — send it.
      if (!hasRecord && !opts.readOnly && latest.current) autosave.push(latest.current);
      await autosave.flush();
    },
  };
}
