/**
 * "No access" on the ticket of a Roof Care plan's inspection (owner, Nov 19: "10. Go."; the rule
 * is lib/roof-care-no-access.ts). The crew arrived and could not get on the roof. The box asks
 * what happened in a short note, says before it is pressed whether this return trip is free or
 * charged, and records it. In the technician's workflow (`big`) and on the office's ticket page.
 *
 * Nothing shows on a ticket that is not a plan's inspection, or once the inspection is done and
 * nothing was recorded on it.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DoorClosed, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isFieldOnly } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { longDay } from "@/lib/followup-rules";
import {
  NO_ACCESS_LABEL,
  NO_ACCESS_NOTE_HINT,
  NO_ACCESS_NOTE_LABEL,
  NO_ACCESS_NOTE_NEEDED,
  NO_ACCESS_QUESTION,
  NO_ACCESS_RECORD,
  NO_ACCESS_TITLE,
  noAccessAfter,
  noAccessBefore,
  roofCareNoAccessKey,
  type NoAccessPreview,
} from "@/lib/roof-care-no-access";
import { recordRoofCareNoAccess, roofCareNoAccess } from "@/lib/roof-care-no-access.functions";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function NoAccessBox({
  jobId,
  big = false,
  className = "",
}: {
  jobId: string;
  /** The technician's workflow: a button for a thumb. */
  big?: boolean;
  className?: string;
}) {
  const { profile, session } = useAuth();
  const readFn = useServerFn(roofCareNoAccess);
  const q = useQuery({
    queryKey: roofCareNoAccessKey(jobId),
    queryFn: () => readFn({ data: { job_id: jobId } }),
    enabled: !!session,
    staleTime: 60_000,
  });
  const [open, setOpen] = useState(false);
  if (!profile) return null;
  if (q.error)
    return (
      <p className={`text-xs text-destructive ${className}`} data-no-access="error">
        Could not read whether we got on the roof: {errText(q.error)}
      </p>
    );
  if (!q.data) return null;
  const { preview, records } = q.data;
  if (!preview && records.length === 0) return null;
  const office = !isFieldOnly(profile);
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${big ? "rounded-xl border border-dashed px-3 py-2 text-sm" : "text-xs"} ${className}`}
      data-no-access={records.length}
    >
      {records.map((r) => (
        <p key={r.id} className="basis-full text-muted-foreground" data-no-access-record>
          No access {longDay(r.on)}: {r.note.trim().replace(/[.\s]+$/, "")}
          {r.by_name ? ` (${r.by_name})` : ""}.{" "}
          {r.charged ? "The return trip is charged." : "The return trip is at no charge."}
        </p>
      ))}
      {preview && (
        <>
          <span className="text-muted-foreground">{NO_ACCESS_QUESTION}</span>
          <Button
            type="button"
            variant="outline"
            size={big ? "default" : "sm"}
            className={big ? "h-11" : "h-7 text-xs"}
            onClick={() => setOpen(true)}
            data-action="roof-care-no-access"
          >
            <DoorClosed className={`mr-1 ${big ? "h-5 w-5" : "h-3.5 w-3.5"}`} /> {NO_ACCESS_LABEL}
          </Button>
        </>
      )}
      {open && preview && (
        <NoAccessDialog
          jobId={jobId}
          preview={preview}
          office={office}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function NoAccessDialog({
  jobId,
  preview,
  office,
  onClose,
}: {
  jobId: string;
  preview: NoAccessPreview;
  office: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const saveFn = useServerFn(recordRoofCareNoAccess);
  const save = useMutation({
    mutationFn: () => saveFn({ data: { job_id: jobId, note: note.trim() } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: roofCareNoAccessKey(jobId) });
      void qc.invalidateQueries({ queryKey: ["roof-care-plans"] });
      toast.success(noAccessAfter(r), { duration: 15_000 });
      onClose();
    },
    onError: (e) => setProblem(errText(e)),
  });
  const lines = noAccessBefore(preview, office);
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent
        className="max-w-md"
        data-no-access-dialog={preview.charged ? "charged" : "free"}
      >
        <DialogHeader>
          <DialogTitle>{NO_ACCESS_TITLE}</DialogTitle>
          <DialogDescription>
            Record it when the crew arrived for this inspection and could not get on the roof. The
            inspection stays open for a new day.
          </DialogDescription>
        </DialogHeader>
        <div
          className={`space-y-1 rounded-md border px-3 py-2 text-sm ${preview.charged ? "border-amber-500/60 bg-amber-500/10" : "bg-muted/40"}`}
          data-no-access-before
        >
          {lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="no-access-note">{NO_ACCESS_NOTE_LABEL}</Label>
          <Textarea
            id="no-access-note"
            rows={3}
            maxLength={500}
            placeholder={NO_ACCESS_NOTE_HINT}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setProblem(null);
            }}
          />
        </div>
        {problem && (
          <p className="text-sm font-medium text-destructive" role="alert" data-no-access-problem>
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={save.isPending}
            onClick={() => {
              if (!note.trim()) return setProblem(NO_ACCESS_NOTE_NEEDED);
              save.mutate();
            }}
            data-action="roof-care-no-access-confirm"
          >
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {NO_ACCESS_RECORD}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
