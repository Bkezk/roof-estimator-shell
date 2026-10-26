/**
 * The picture in a photo module: shows an ImageRef (an upload in the documents bucket, a ticket
 * photo with or without its marks, or the company logo) and the dialog that chooses one — the
 * ticket's photos as thumbnails (a "With marks" switch when a photo has marks), "Upload picture"
 * (read as a data URL, measured, sent as base64 to uploadDocumentImage), and "Company logo".
 */
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, ImagePlus, Loader2, Trash2 } from "lucide-react";

import { dataUrlBase64, LOGO_SRC } from "@/lib/documents/editor-helpers";
import type { ImageRef } from "@/lib/documents/model";
import { documentImageUrl, uploadDocumentImage } from "@/lib/documents.functions";
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

import { errText, imageUrlKey } from "../document-types";
import { useEditorEnv } from "./editor-context";
import { readImageFile } from "./editor-dom";

/** The <img> for an ImageRef (the url of an upload is fetched once per path). */
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
    // Phase 2 (built next): the property's cover photo.
    src = null;
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
            : "…"}
      </div>
    );
  return (
    <img
      src={src}
      alt={label}
      title={label}
      className={cn("object-contain", props.className)}
      style={props.style}
      draggable={false}
    />
  );
}

/** The empty slot / picture that opens the picker on click. */
export function ImageSlot(props: {
  image: ImageRef | null;
  onChange: (image: ImageRef | null) => void;
  className?: string | undefined;
  /** Fixed height in px (fullPhoto's inches); undefined keeps the picture's shape. */
  heightPx?: number | undefined;
  title?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const style: React.CSSProperties | undefined = props.heightPx
    ? { height: props.heightPx }
    : undefined;
  return (
    <>
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
      <PhotoPicker
        open={open}
        onOpenChange={setOpen}
        value={props.image}
        onPick={(img) => {
          props.onChange(img);
          setOpen(false);
        }}
      />
    </>
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
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a picture</DialogTitle>
          <DialogDescription>
            {env.kind === "ticket"
              ? "A photo from the ticket, a picture from your computer, or the company logo."
              : "A picture from your computer, or the company logo."}
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
                    <img
                      src={p.url}
                      alt={p.fileName}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
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
