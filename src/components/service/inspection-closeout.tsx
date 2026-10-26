/**
 * The inspection close-out's own cards (owner, Oct 12; the steps are closeout-steps.ts
 * closeoutSteps("inspection"), the screen closeout.tsx):
 *
 *   step 2 · Checklist — the Aerial fold once (plain, inside the card; only with an address),
 *   then every checklist item as one compact line (inspection-section.tsx ChecklistRows; owner,
 *   Oct 26: only a problem needs a status or a note). A flagged item opens to its note, its
 *   camera (a photo of role "other" on no repair, `item_key` naming the item), its thumbnails
 *   (Detach puts one back among the ticket's loose photos) and "From ticket photos" (attach
 *   loose ticket pictures to the item — inspection-item-photos.tsx); under the rows the counts
 *   and whether the server has the answers (inspection-draft.ts: saved as you go, "Save now"
 *   when the signal dropped or nothing was flagged). No repair picker.
 *
 *   step 3 · Findings — ONE note (the ticket's closing_notes: step 6's Closing notes box is not
 *   shown on an inspection), the "Recommend repairs" switch (service_jobs.inspection
 *   .recommend_repairs) and the "Recommend a new roof" switch (service_jobs.recommend_new_roof),
 *   Property inspected (a date; "Today" is the phone's own day) and Property grade (A–F), saved
 *   with the checklist (inspection-section.tsx InspectionDetails), an optional photo roll (role
 *   "other", no repair, no item), and "Nothing to add" — the same per-ticket phone mark step 6
 *   uses (notesSkippedKey).
 *
 * Photos are optional everywhere here: none is ever a gap. The camera is one hidden input and
 * one upload mutation for the whole flow (inspection-camera.ts useInspectionCamera), aimed at an
 * item or at the roll,
 * the same upload path as a repair's photo (shrinkPhoto → the service bucket → registerJobPhoto);
 * a failed upload keeps its file for "Retry upload", as on a repair. The photos show on the
 * ticket page's Repairs fold under "Other photos" (ticket-field-sections.tsx lists every photo
 * that is not a signature, loose ones under that heading).
 */
import { Camera, CheckCircle2, Loader2, RefreshCw } from "lucide-react";

import type { ServiceJobRow } from "@/lib/service.functions";
import type { JobPhotoRow } from "@/lib/service-field.functions";
import type { InspectionItem } from "@/lib/inspection";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AerialSection } from "@/components/service/aerial-markup";
import { PhotoThumb } from "@/components/service/field-shared";
import {
  ChecklistRows,
  ChecklistSavedLine,
  InspectionDetails,
} from "@/components/service/inspection-section";
import type { InspectionDraftState } from "@/components/service/inspection-draft";
import {
  FromTicketPhotosButton,
  ItemPhotoThumbs,
} from "@/components/service/inspection-item-photos";
import { useDeleteJobPhoto } from "@/components/service/item-photo-mutations";
import type {
  InspectionCamera,
  InspectionPhotoControls,
} from "@/components/service/inspection-camera";
import { errText } from "@/components/service/field-utils";

/**
 * The camera button with its count, the thumbnails, and a failed shot's Retry / Discard. On a
 * checklist item (`itemKey`) the thumbnails carry Detach and the row offers "From ticket photos"
 * (inspection-item-photos.tsx); the findings roll (no item) is the plain roll.
 */
function PhotoRoll({
  photos,
  allPhotos,
  itemKey,
  camera,
  label,
  jobId,
  ticketNumber,
  compact,
}: {
  /** The roll's own photos (the item's, or the loose ones on the findings step). */
  photos: JobPhotoRow[];
  /** Every photo on the ticket (the item's pictures and the loose ones to attach). */
  allPhotos: readonly JobPhotoRow[];
  itemKey: string | null;
  camera: InspectionPhotoControls;
  label: string;
  jobId: string;
  ticketNumber: number;
  compact?: boolean | undefined;
}) {
  const delPhoto = useDeleteJobPhoto(jobId);
  return (
    <div className="space-y-2">
      {itemKey ? (
        <ItemPhotoThumbs
          jobId={jobId}
          itemKey={itemKey}
          itemLabel={label}
          photos={allPhotos}
          ticketNumber={ticketNumber}
          canEdit
          compact={compact}
        />
      ) : (
        photos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <PhotoThumb
                key={p.id}
                photo={p}
                size={compact ? "sm" : undefined}
                deleting={delPhoto.isPending && delPhoto.variables === p.id}
                onDelete={() => delPhoto.mutate(p.id)}
                canAnnotate
                ticketNumber={ticketNumber}
              />
            ))}
          </div>
        )
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className={compact ? "h-10 px-3 text-sm" : "h-11 text-base"}
          disabled={camera.uploading}
          onClick={camera.onPhoto}
          aria-label={`${label}: photo`}
        >
          {camera.uploading ? (
            <Loader2
              className={compact ? "mr-1 h-4 w-4 animate-spin" : "mr-2 h-5 w-5 animate-spin"}
            />
          ) : (
            <Camera className={compact ? "mr-1 h-4 w-4" : "mr-2 h-5 w-5"} />
          )}
          Photo{photos.length ? ` (${photos.length})` : ""}
        </Button>
        {itemKey && (
          <FromTicketPhotosButton
            jobId={jobId}
            itemKey={itemKey}
            itemLabel={label}
            photos={allPhotos}
            compact={compact}
          />
        )}
        <span className="text-xs text-muted-foreground">Optional</span>
        {camera.failed && (
          <>
            <span className="text-sm text-destructive">The photo did not upload</span>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              disabled={camera.uploading}
              onClick={camera.onRetry}
            >
              <RefreshCw className="mr-1 h-4 w-4" /> Retry upload
            </Button>
            <Button type="button" variant="ghost" className="h-10" onClick={camera.onDiscard}>
              Discard
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 2 · Checklist

/** The ticket's photos taken for checklist items / the roll: role "other", on no repair. */
const itemPhotos = (photos: readonly JobPhotoRow[], itemKey: string | null) =>
  photos.filter((p) => p.role === "other" && !p.repair_id && (p.item_key ?? null) === itemKey);

export function InspectionChecklistStep({
  job,
  draft,
  photos,
  camera,
}: {
  job: ServiceJobRow;
  draft: InspectionDraftState;
  photos: readonly JobPhotoRow[];
  camera: InspectionCamera;
}) {
  return (
    <section className="space-y-3" aria-label="Checklist">
      <AerialSection job={job} canEdit plain />
      {draft.error ? (
        <p className="text-sm text-destructive">
          Could not load the checklist: {errText(draft.error)}
        </p>
      ) : !draft.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the checklist…
        </p>
      ) : (
        <>
          <ChecklistRows
            items={draft.items}
            readOnly={false}
            onChange={draft.setItem}
            jobId={job.id}
            extra={(item: InspectionItem) => (
              <PhotoRoll
                photos={itemPhotos(photos, item.id)}
                allPhotos={photos}
                itemKey={item.id}
                camera={camera.controls(item.id)}
                label={item.label}
                jobId={job.id}
                ticketNumber={job.number}
                compact
              />
            )}
          />
          <ChecklistSavedLine draft={draft} canEdit />
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 3 · Findings

export function InspectionFindingsStep({
  job,
  draft,
  notes,
  onNotes,
  recommendRepairs,
  onRecommendRepairs,
  recommendNewRoof,
  onRecommendNewRoof,
  skipped,
  onSkip,
  photos,
  camera,
}: {
  job: ServiceJobRow;
  /** The checklist draft: Property inspected / Property grade save with it (owner, Oct 26). */
  draft: InspectionDraftState;
  /** The ticket's closing_notes draft (closeout.tsx TextDraft): the one notes box. */
  notes: string;
  onNotes: (v: string) => void;
  recommendRepairs: boolean;
  onRecommendRepairs: (on: boolean) => void;
  recommendNewRoof: boolean;
  onRecommendNewRoof: (on: boolean) => void;
  /** "Nothing to add" pressed (the notesSkippedKey mark). */
  skipped: boolean;
  onSkip: (on: boolean) => void;
  photos: readonly JobPhotoRow[];
  camera: InspectionCamera;
}) {
  const nothingYet = !notes.trim() && !recommendRepairs && !recommendNewRoof;
  return (
    <section className="space-y-3" aria-label="Findings">
      <div className="space-y-1">
        <Label htmlFor="co-findings">Findings</Label>
        <Textarea
          id="co-findings"
          rows={5}
          className="text-base"
          placeholder="What you found on the roof (the keyboard's microphone works here)"
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
        />
      </div>
      <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2">
        <span className="font-medium">Recommend repairs</span>
        <Switch
          checked={recommendRepairs}
          onCheckedChange={onRecommendRepairs}
          aria-label="Recommend repairs"
        />
      </label>
      <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2">
        <span className="font-medium">Recommend a new roof</span>
        <Switch
          checked={recommendNewRoof}
          onCheckedChange={onRecommendNewRoof}
          aria-label="Recommend a new roof"
        />
      </label>
      <InspectionDetails draft={draft} canEdit idPrefix="co" />
      <PhotoRoll
        photos={itemPhotos(photos, null)}
        allPhotos={photos}
        itemKey={null}
        camera={camera.controls(null)}
        label="Findings"
        jobId={job.id}
        ticketNumber={job.number}
      />
      {nothingYet &&
        (skipped ? (
          <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl border px-4 py-1 text-sm">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Nothing to add
            </span>
            <Button type="button" variant="ghost" className="h-10" onClick={() => onSkip(false)}>
              Undo
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full text-base"
            onClick={() => onSkip(true)}
          >
            Nothing to add
          </Button>
        ))}
    </section>
  );
}
