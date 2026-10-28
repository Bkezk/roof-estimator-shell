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
import { Camera, Check, CheckCircle2, Loader2, RefreshCw } from "lucide-react";

import type { ServiceJobRow } from "@/lib/service.functions";
import type { JobPhotoRow } from "@/lib/service-field.functions";
import { photosOnItem, unattachedTicketPhotos, type InspectionItem } from "@/lib/inspection";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import {
  PendingThumbs,
  UploadBadge,
  WaitingForSignalLine,
} from "@/components/service/picture-queue-ui";
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
  items,
  camera,
  label,
  jobId,
  ticketNumber,
  compact,
  heading,
  children,
}: {
  /** The roll's own photos (the item's, or the loose ones on the findings step). */
  photos: JobPhotoRow[];
  /** Every photo on the ticket (the item's pictures and the loose ones to attach). */
  allPhotos: readonly JobPhotoRow[];
  itemKey: string | null;
  /** The checklist rows, for the "also on …" labels (a picture on several items, Oct 28). */
  items?: readonly InspectionItem[] | undefined;
  camera: InspectionPhotoControls;
  label: string;
  jobId: string;
  ticketNumber: number;
  compact?: boolean | undefined;
  /**
   * Compact findings layout (owner, Oct 28): the camera button sits at the right of this
   * heading, `children` (the notes box) goes under it, the thumbnails under that — and no
   * "Optional" word, nothing on that step is required.
   */
  heading?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const delPhoto = useDeleteJobPhoto(jobId);
  // The pictures still going up (the portal's one queue): grey placeholders until each row lands.
  const placeholders = (
    <PendingThumbs
      entries={camera.pending}
      size={compact ? "sm" : undefined}
      onRetry={camera.onRetry}
      onDiscard={camera.onDiscard}
    />
  );
  const button = (
    <Button
      type="button"
      variant="outline"
      className={compact ? "h-10 px-3 text-sm" : "h-11 text-base"}
      onClick={camera.onPhoto}
      aria-label={`${label}: photo`}
    >
      <Camera className={compact ? "mr-1 h-4 w-4" : "mr-2 h-5 w-5"} />
      Photo{photos.length ? ` (${photos.length})` : ""}
    </Button>
  );
  return (
    <div className="space-y-2">
      {heading && (
        <div className="flex items-center justify-between gap-2" data-line="roll-heading">
          {heading}
          <div className="flex shrink-0 items-center gap-2">
            {button}
            <UploadBadge n={camera.uploading} />
          </div>
        </div>
      )}
      {children}
      {itemKey ? (
        <>
          <ItemPhotoThumbs
            jobId={jobId}
            itemKey={itemKey}
            itemLabel={label}
            photos={allPhotos}
            items={items}
            ticketNumber={ticketNumber}
            canEdit
            compact={compact}
          />
          {camera.pending.length > 0 && <div className="flex flex-wrap gap-2">{placeholders}</div>}
        </>
      ) : (
        (photos.length > 0 || camera.pending.length > 0) && (
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
            {placeholders}
          </div>
        )
      )}
      {!heading && (
        <div className="flex flex-wrap items-center gap-2">
          {button}
          <UploadBadge n={camera.uploading} />
          {itemKey && (
            <FromTicketPhotosButton
              jobId={jobId}
              itemKey={itemKey}
              itemLabel={label}
              photos={allPhotos}
              items={items}
              compact={compact}
            />
          )}
          <span className="text-xs text-muted-foreground">Optional</span>
        </div>
      )}
      <WaitingForSignalLine n={camera.waitingForSignal} />
      {camera.pending
        .filter((p) => p.status === "failed")
        .map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center gap-2 text-sm"
            data-line="photo-failed"
          >
            <span className="text-destructive">
              The photo did not upload{p.error ? `: ${p.error}` : ""}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={() => camera.onRetry(p.id)}
            >
              <RefreshCw className="mr-1 h-4 w-4" /> Retry upload
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-10"
              onClick={() => camera.onDiscard(p.id)}
            >
              Discard
            </Button>
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 2 · Checklist

/**
 * The ticket's photos on a checklist item (`item_keys` includes it — a photo may be on several,
 * Oct 28) or, for the findings roll (null), on no item at all: role "other", on no repair.
 */
const itemPhotos = (photos: readonly JobPhotoRow[], itemKey: string | null) =>
  itemKey === null ? unattachedTicketPhotos(photos) : photosOnItem(photos, itemKey);

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
                items={draft.items}
                camera={camera.controls(item.id, item.label)}
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
  photos,
  camera,
}: {
  job: ServiceJobRow;
  /** The checklist draft: Inspected / Grade save with it (owner, Oct 26). */
  draft: InspectionDraftState;
  /** The ticket's closing_notes draft (closeout.tsx TextDraft): the one notes box. */
  notes: string;
  onNotes: (v: string) => void;
  recommendRepairs: boolean;
  onRecommendRepairs: (on: boolean) => void;
  recommendNewRoof: boolean;
  onRecommendNewRoof: (on: boolean) => void;
  photos: readonly JobPhotoRow[];
  camera: InspectionCamera;
}) {
  return (
    <section className="space-y-3" aria-label="Findings">
      <PhotoRoll
        photos={itemPhotos(photos, null)}
        allPhotos={photos}
        itemKey={null}
        camera={camera.controls(null, "Findings")}
        label="Findings"
        jobId={job.id}
        ticketNumber={job.number}
        heading={<Label htmlFor="co-findings">Findings</Label>}
      >
        <Textarea
          id="co-findings"
          rows={5}
          className="text-base"
          placeholder="What you found on the roof (the keyboard's microphone works here)"
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
        />
      </PhotoRoll>
      <div className="grid grid-cols-2 gap-2" data-section="recommendations">
        <RecommendButton
          label="Recommend repairs"
          on={recommendRepairs}
          onChange={onRecommendRepairs}
        />
        <RecommendButton
          label="Recommend new roof"
          on={recommendNewRoof}
          onChange={onRecommendNewRoof}
        />
      </div>
      <InspectionDetails draft={draft} canEdit idPrefix="co" />
    </section>
  );
}

/** One of the two recommendations: a press-to-select button (owner, Oct 28; was a switch row). */
function RecommendButton({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-pressed={on}
      className={`h-11 whitespace-normal px-2 text-sm font-medium leading-tight ${
        on ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90" : ""
      }`}
      onClick={() => onChange(!on)}
    >
      {on && <Check className="mr-1 h-4 w-4 shrink-0" aria-hidden />}
      {label}
    </Button>
  );
}

/**
 * The Findings step's "Nothing to add" (the notesSkippedKey mark, the same as step 6's Skip):
 * a small link beside the missing line under Next while the step is blank (closeout-steps.ts
 * findingsBlank); once pressed, the mark with Undo.
 */
export function NothingToAdd({
  skipped,
  onSkip,
  blank,
}: {
  skipped: boolean;
  onSkip: (on: boolean) => void;
  blank: boolean;
}) {
  if (skipped)
    return (
      <span className="flex items-center gap-1" data-line="nothing-to-add">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        Nothing to add
        <Button type="button" variant="ghost" className="h-10 px-2" onClick={() => onSkip(false)}>
          Undo
        </Button>
      </span>
    );
  if (!blank) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-10 px-2 text-sm"
      data-line="nothing-to-add"
      onClick={() => onSkip(true)}
    >
      Nothing to add
    </Button>
  );
}
