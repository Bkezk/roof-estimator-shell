/**
 * "Who is on this job with you?" (owner, Sep 30): once the technician has started a ticket, they
 * answer — "I'm alone", or the other technicians with them (the office's crew first, then the
 * rest of the technicians). It must be answered before the rest of the close-out opens and stays
 * editable after (before photos now, after photos on a later visit). Every tap saves by itself
 * (setJobCrew, debounced; "Saved" beside the title, a loud toast on failure) — no Save button.
 * Technicians never see money here; the office sets the crew's rates on the ticket.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { User, Users } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listTechnicians } from "@/lib/auth.functions";
import { listJobCrew, type ServiceJobRow } from "@/lib/service.functions";
import { setJobCrew, type TodayJob } from "@/lib/service-field.functions";
import { crewQuestionPending, othersOf } from "@/lib/service-crew";
import { CREW_FIELDS, mergeSaved } from "@/lib/job-cache";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SavedIndicator } from "@/components/service/field-shared";
import { errText, fieldKeys, useAutosave } from "@/components/service/field-utils";

type Mode = "alone" | "others" | null;

export function CrewBox({
  job,
  disabled,
  className,
}: {
  job: Pick<ServiceJobRow, "id" | "technician_id" | "crew_confirmed_at" | "stage">;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const { session, profile } = useAuth();
  const qc = useQueryClient();
  const crewFn = useServerFn(listJobCrew);
  const techFn = useServerFn(listTechnicians);
  const setFn = useServerFn(setJobCrew);
  // Owner, Oct 9 (S13): fresh for 30 s; a save invalidates it itself.
  const crew = useQuery({
    queryKey: fieldKeys.crew(job.id),
    queryFn: () => crewFn({ data: { id: job.id } }),
    enabled: !!session,
    staleTime: 30_000,
  });
  const techs = useQuery({
    queryKey: ["technicians"],
    queryFn: () => techFn(),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });

  const pending = crewQuestionPending(job);
  const [mode, setMode] = useState<Mode>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [seeded, setSeeded] = useState(false);
  // Start from what is saved: the office's crew (or the earlier answer).
  useEffect(() => {
    if (seeded || !crew.data) return;
    const others = othersOf(crew.data).map((r) => r.technician_id);
    setPicked(others);
    setMode(job.crew_confirmed_at ? (others.length ? "others" : "alone") : null);
    setSeeded(true);
  }, [crew.data, seeded, job.crew_confirmed_at]);

  const options = useMemo(() => {
    const out: { id: string; name: string }[] = [];
    const seen = new Set<string>(job.technician_id ? [job.technician_id] : []);
    for (const r of othersOf(crew.data ?? [])) {
      if (seen.has(r.technician_id)) continue;
      seen.add(r.technician_id);
      out.push({ id: r.technician_id, name: r.name });
    }
    for (const t of techs.data ?? []) {
      if (!t.technician || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ id: t.id, name: t.name });
    }
    return out;
  }, [crew.data, techs.data, job.technician_id]);

  const autosave = useAutosave<string[]>(
    async (others) => {
      const row = await setFn({ data: { id: job.id, others } });
      // Owner, Oct 9: only the crew fields this save wrote go into the caches (job-cache.ts) —
      // the whole row landing after a signature save used to blank the signature.
      qc.setQueryData<ServiceJobRow>(fieldKeys.job(job.id), (old) =>
        mergeSaved(old, row, CREW_FIELDS),
      );
      qc.setQueryData<TodayJob[]>(fieldKeys.today, (old) =>
        old?.map((x) =>
          x.id === row.id
            ? {
                ...(mergeSaved(x, row, CREW_FIELDS) ?? x),
                crew_names: others.map((id) => options.find((o) => o.id === id)?.name ?? "?"),
              }
            : x,
        ),
      );
      void qc.invalidateQueries({ queryKey: fieldKeys.crew(job.id) });
      void qc.invalidateQueries({ queryKey: fieldKeys.events(job.id) });
      void qc.invalidateQueries({ queryKey: ["service-jobs"] });
    },
    { what: "Who is on the job" },
  );

  // A choice saves at once (the rest of the close-out waits on it); ticks are debounced.
  const chooseAlone = () => {
    setMode("alone");
    autosave.push([]);
    void autosave.flush();
  };
  const chooseOthers = () => {
    setMode("others");
    if (!picked.length) return;
    autosave.push(picked);
    void autosave.flush();
  };
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...picked.filter((x) => x !== id), id] : picked.filter((x) => x !== id);
    setPicked(next);
    if (next.length) autosave.push(next);
  };

  const leadName =
    job.technician_id && job.technician_id === profile?.id
      ? "You"
      : (crew.data?.find((r) => r.sort === 0)?.name ??
        techs.data?.find((t) => t.id === job.technician_id)?.name ??
        "The technician");

  return (
    <section
      className={`space-y-3 rounded-xl border p-4 ${pending ? "border-primary bg-primary/5" : "bg-card"} ${className ?? ""}`}
      aria-label="Who is on this job"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="h-5 w-5 text-muted-foreground" /> Who is on this job with you?
        </h2>
        <SavedIndicator state={autosave.state} />
      </div>
      {pending && (
        <p className="text-sm text-muted-foreground">
          Answer this first; the rest of the ticket opens after.
        </p>
      )}
      {crew.error && (
        <p className="text-sm text-destructive">Could not load the crew: {errText(crew.error)}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={mode === "alone" ? "default" : "outline"}
          className="h-14 text-base"
          aria-pressed={mode === "alone"}
          disabled={disabled || !seeded}
          onClick={chooseAlone}
        >
          <User className="mr-2 h-5 w-5" /> I'm alone
        </Button>
        <Button
          type="button"
          variant={mode === "others" ? "default" : "outline"}
          className="h-14 text-base"
          aria-pressed={mode === "others"}
          disabled={disabled || !seeded}
          onClick={chooseOthers}
        >
          <Users className="mr-2 h-5 w-5" /> With other techs
        </Button>
      </div>
      {mode === "others" && (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-medium">{leadName}</span>
            <span className="text-muted-foreground"> (lead) and:</span>
          </p>
          {techs.error && (
            <p className="text-sm text-destructive">
              Could not load the technicians: {errText(techs.error)}
            </p>
          )}
          {options.length === 0 && !techs.isLoading ? (
            <p className="text-sm text-muted-foreground">No other technicians on the roster.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {options.map((o) => {
                const on = picked.includes(o.id);
                return (
                  <li key={o.id}>
                    <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2">
                      <Checkbox
                        className="h-6 w-6"
                        checked={on}
                        disabled={disabled}
                        onCheckedChange={(v) => toggle(o.id, v === true)}
                      />
                      <span className="text-base">{o.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {picked.length === 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Tick who is with you, or choose “I'm alone”.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
