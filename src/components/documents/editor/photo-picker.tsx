/**
 * The picture in a photo module: shows an ImageRef (an upload in the documents bucket, a ticket
 * photo with or without its marks, the property's cover photo, or the company logo) and the dialog
 * that chooses one — the ticket's photos as thumbnails (a "With marks" switch when a photo has
 * marks), "Property photo" when the record's property has a cover, "Upload picture" (read as a
 * data URL, measured, sent as base64 to uploadDocumentImage), and "Company logo".
 *
 * Phase 2 (owner, Oct 26: "mark up the pictures in the documents"): every picture draws its marks
 * on the canvas (MarksOverlay, the ticket thumbnails' drawer) and carries a "Mark up" pencil on
 * hover. An uploaded picture opens the drawing surface (photo-markup.tsx PhotoMarkupSurface) and
 * keeps the marks on its ImageRef (`upload.marks`); a ticket photo opens the same surface and
 * saves on the ticket's row (savePhotoAnnotations), as the ticket page does — the document only
 * draws the ticket's marks. Nothing is saved until Done is pressed.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Home, ImagePlus, Loader2, PenLine, Trash2 } from "lucide-react";

import {
  canMarkUp,
  dataUrlBase64,
  imageMarks,
  imageRotation,
  LOGO_SRC,
} from "@/lib/documents/editor-helpers";
import type { ImageRef } from "@/lib/documents/model";
import { documentImageUrl, uploadDocumentImage } from "@/lib/documents.functions";
import { type PhotoMark, type Rotation, serializePhotoMarks } from "@/lib/photo-annotations";
import { savePhotoAnnotations } from "@/lib/service-field.functions";
import { cn } from "@/lib/utils";
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
import { Switch } from "@/components/ui/switch";
import { PhotoMarkupSurface, RotatedPhoto } from "@/components/service/photo-markup";

import { documentKey, errText, imageUrlKey } from "../document-types";
import { useEditorEnv } from "./editor-context";
import { readImageFile } from "./editor-dom";

/**
 * The picture for an ImageRef (the url of an upload is fetched once per path), its marks drawn
 * over it and, for a ticket photo, turned the way the ticket shows it (RotatedPhoto).
 */
export function DocImage(props: {
  image: ImageRef;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  alt?: string | undefined;
}) {
  const env = useEditorEnv();
  const urlFn = useServerFn(documentImageUrl);
  const { image } = props;
  const upload = image.kind === "upload" ? image : null;
  const q = useQuery({
    queryKey: imageUrlKey(upload?.path ?? ""),
    queryFn: async () => (await urlFn({ data: { path: upload!.path } })).url,
    enabled: !!upload,
    staleTime: 10 * 60_000,
  });
  let src: string | null = null;
  let label = props.alt ?? "";
  if (image.kind === "logo") {
    src = LOGO_SRC;
    label ||= "Company logo";
  } else if (image.kind === "ticketPhoto") {
    const p = env.photos.find((x) => x.id === image.photoId);
    src = p?.url ?? null;
    label ||= p ? `${p.fileName}${image.marks ? " (with marks)" : ""}` : "Ticket photo";
  } else if (image.kind === "siteCover") {
    src = env.siteCoverUrl ?? null;
    label ||= "Property photo";
  } else {
    src = q.data ?? null;
    label ||= image.name ?? "Picture";
  }
  if (!src)
    return (
      <div
        // On the white paper in both themes, so the grey is the same in both.
        className={cn(
          "flex items-center justify-center bg-neutral-100 text-xs text-neutral-500 dark:bg-neutral-100",
          props.className,
        )}
        style={props.style}
      >
        {q.isError
          ? "Picture not found"
          : image.kind === "ticketPhoto"
            ? "Photo not on this ticket"
            : image.kind === "siteCover"
              ? "No property photo"
              : "…"}
      </div>
    );
  const marks = imageMarks(image, env.photos);
  const rotation = imageRotation(image, env.photos);
  return (
    <span className="relative block h-full w-full">
      <RotatedPhoto
        url={src}
        alt={label}
        title={label}
        marks={marks}
        rotation={rotation}
        fit="contain"
        className={props.className}
        style={props.style}
        draggable={false}
      />
    </span>
  );
}

/** The empty slot / picture that opens the picker on click, with Mark up on hover. */
export function ImageSlot(props: {
  image: ImageRef | null;
  onChange: (image: ImageRef | null) => void;
  className?: string | undefined;
  /** Fixed height in px (fullPhoto's inches); undefined keeps the picture's shape. */
  heightPx?: number | undefined;
  title?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [markup, setMarkup] = useState(false);
  const style: React.CSSProperties | undefined = props.heightPx
    ? { height: props.heightPx }
    : undefined;
  return (
    <div className="group/slot relative">
      <button
        type="button"
        title={props.title ?? (props.image ? "Change picture" : "Choose photo")}
        className={cn(
          "block w-full overflow-hidden rounded-sm text-left",
          !props.image && "border-2 border-dashed border-neutral-300 hover:border-neutral-400",
          props.className,
        )}
        style={style}
        onClick={() => setOpen(true)}
      >
        {props.image ? (
          <DocImage
            image={props.image}
            className={cn("w-full", props.heightPx ? "h-full" : "max-h-[7in]")}
          />
        ) : (
          <div
            className="flex h-full min-h-32 w-full flex-col items-center justify-center gap-1 text-neutral-500"
            style={style}
          >
            <ImagePlus className="h-6 w-6" />
            <span className="text-sm">Choose photo</span>
          </div>
        )}
      </button>
      {canMarkUp(props.image) ? (
        <button
          type="button"
          title="Mark up"
          aria-label="Mark up"
          className="absolute right-1 top-1 hidden items-center gap-1 rounded-md border bg-popover px-1.5 py-1 text-xs text-popover-foreground shadow-md group-hover/slot:flex"
          onClick={(e) => {
            e.stopPropagation();
            setMarkup(true);
          }}
        >
          <PenLine className="h-3.5 w-3.5" /> Mark up
        </button>
      ) : null}
      <PhotoPicker
        open={open}
        onOpenChange={setOpen}
        value={props.image}
        onPick={(img) => {
          props.onChange(img);
          setOpen(false);
        }}
      />
      {props.image && canMarkUp(props.image) ? (
        <MarkupDialog
          open={markup}
          onOpenChange={setMarkup}
          image={props.image}
          onChange={props.onChange}
        />
      ) : null}
    </div>
  );
}

/**
 * Mark up a picture of a photo module (phase 2). An upload keeps the marks on its ImageRef (the
 * document's own; saved with the document); a ticket photo saves on its row, as the ticket page
 * does, and the document redraws the ticket's marks. Done saves; closing the dialog does not.
 */
export function MarkupDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  image: ImageRef;
  onChange: (image: ImageRef) => void;
}) {
  const env = useEditorEnv();
  const qc = useQueryClient();
  const urlFn = useServerFn(documentImageUrl);
  const saveFn = useServerFn(savePhotoAnnotations);
  const { image } = props;
  const upload = image.kind === "upload" ? image : null;
  const ticket = image.kind === "ticketPhoto" ? image : null;
  const photo = ticket ? env.photos.find((p) => p.id === ticket.photoId) : null;
  const q = useQuery({
    queryKey: imageUrlKey(upload?.path ?? ""),
    queryFn: async () => (await urlFn({ data: { path: upload!.path } })).url,
    enabled: !!upload && props.open,
    staleTime: 10 * 60_000,
  });
  const url = upload ? (q.data ?? null) : (photo?.url ?? null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const size = upload ? { w: upload.width, h: upload.height } : natural;
  const marksAllowed = env.options.marks;
  // The ticket photo's marks and its rotation save together on its row, as the ticket page does.
  const saveTicket = useMutation({
    mutationFn: (m: { marks: PhotoMark[]; rotation: Rotation }) =>
      saveFn({
        data: {
          id: photo!.id,
          service_job_id: photo!.serviceJobId,
          annotations: serializePhotoMarks(m.marks, m.rotation),
        },
      }),
    onSuccess: async (_row, m) => {
      // The document redraws the ticket's marks (getDocument reads the row again).
      if (env.documentId) await qc.invalidateQueries({ queryKey: documentKey(env.documentId) });
      props.onChange({ ...ticket!, marks: marksAllowed && m.marks.length > 0 });
      toast.success("Marks saved on the ticket photo");
      props.onOpenChange(false);
    },
    onError: (e) => toast.error(`The photo's marks did not save: ${errText(e)}`),
  });
  const done = (marks: PhotoMark[], rotation: Rotation) => {
    if (upload) {
      // An uploaded picture keeps no rotation (the surface offers none for it).
      const { marks: _old, ...rest } = upload;
      props.onChange(marks.length ? { ...rest, marks } : rest);
      props.onOpenChange(false);
      return;
    }
    if (photo) saveTicket.mutate({ marks, rotation });
  };
  const initial = upload ? (upload.marks ?? []) : (photo?.marks ?? []);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[96vh] w-[calc(100vw-1rem)] max-w-4xl overflow-y-auto p-3 sm:p-6">
        <DialogHeader>
          <DialogTitle>Mark up the picture</DialogTitle>
          <DialogDescription>
            {upload
              ? "Circle the problem, point at it, box it, write on it or tag it. The marks stay with this document; Done keeps them."
              : "The marks are saved on the ticket's photo when you press Done, and every document drawing it shows them."}
            {!marksAllowed
              ? " Marks on photos is off for this document, so they will not print until it is on."
              : ""}
          </DialogDescription>
        </DialogHeader>
        {url && !size ? (
          <img
            src={url}
            alt=""
            className="hidden"
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
        ) : null}
        {url && size ? (
          <PhotoMarkupSurface
            key={`${image.kind}:${upload?.path ?? ticket?.photoId}`}
            url={url}
            size={size}
            initialMarks={initial}
            initialRotation={photo?.rotation ?? 0}
            rotatable={!upload}
            onDone={done}
            status={saveTicket.isPending ? " · saving…" : ""}
          />
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the picture…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PhotoPicker(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ImageRef | null;
  onPick: (image: ImageRef | null) => void;
}) {
  const env = useEditorEnv();
  const uploadFn = useServerFn(uploadDocumentImage);
  const fileRef = useRef<HTMLInputElement>(null);
  const [marks, setMarks] = useState(
    props.value?.kind === "ticketPhoto" ? props.value.marks : env.options.marks,
  );
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { dataUrl, width, height } = await readImageFile(file);
      const r = await uploadFn({
        data: {
          ...(env.documentId ? { documentId: env.documentId } : {}),
          ...(env.templateId ? { templateId: env.templateId } : {}),
          fileName: file.name,
          base64: dataUrlBase64(dataUrl),
          width,
          height,
        },
      });
      return { ...r, name: file.name };
    },
    onSuccess: (r) =>
      props.onPick({
        kind: "upload",
        path: r.path,
        width: r.width,
        height: r.height,
        name: r.name,
      }),
    onError: (e) => toast.error(`Could not upload the picture: ${errText(e)}`),
  });
  const marksAllowed = env.options.marks;
  const siteCover = env.siteId && env.siteCoverUrl ? env.siteId : null;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a picture</DialogTitle>
          <DialogDescription>
            {env.kind === "ticket"
              ? "A photo from the ticket, a picture from your computer, or the company logo."
              : "A picture from your computer, or the company logo."}
            {siteCover ? " The property's cover photo is here too." : ""}
          </DialogDescription>
        </DialogHeader>
        {env.photos.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Ticket photos</div>
              {env.photos.some((p) => p.hasMarks) ? (
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={marks && marksAllowed}
                    disabled={!marksAllowed}
                    onCheckedChange={setMarks}
                    title={
                      marksAllowed
                        ? "Draw the marks on the photo"
                        : "Marks on photos is off for this document"
                    }
                  />
                  With marks
                </label>
              ) : null}
            </div>
            <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto">
              {env.photos.map((p) => {
                const selected =
                  props.value?.kind === "ticketPhoto" && props.value.photoId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={p.fileName}
                    className={cn(
                      "overflow-hidden rounded-md border bg-image-plate",
                      selected && "ring-2 ring-ring",
                    )}
                    onClick={() =>
                      props.onPick({
                        kind: "ticketPhoto",
                        photoId: p.id,
                        marks: marksAllowed && marks && p.hasMarks,
                      })
                    }
                  >
                    <span className="relative block">
                      <RotatedPhoto
                        url={p.url}
                        alt={p.fileName}
                        marks={[]}
                        rotation={p.rotation}
                        fit="cover"
                        className="aspect-square w-full"
                        loading="lazy"
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload.mutate(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            title="A picture from your computer"
            disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {upload.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
            Upload picture
          </Button>
          {siteCover ? (
            <Button
              type="button"
              variant="outline"
              title="The property's cover photo (set on the property card)"
              onClick={() => props.onPick({ kind: "siteCover", siteId: siteCover })}
            >
              <Home className="h-4 w-4" />
              Property photo
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            title="The JBK logo"
            onClick={() => props.onPick({ kind: "logo" })}
          >
            <Building2 className="h-4 w-4" />
            Company logo
          </Button>
          {props.value ? (
            <Button
              type="button"
              variant="ghost"
              className="ml-auto text-destructive"
              title="Leave the slot empty"
              onClick={() => props.onPick(null)}
            >
              <Trash2 className="h-4 w-4" />
              Remove picture
            </Button>
          ) : null}
        </div>
        <DialogFooter>
          <Label className="mr-auto text-xs text-muted-foreground">
            Pictures print at the page width; a tall one is scaled to fit.
          </Label>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
