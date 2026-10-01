-- Marks on ticket photos, and the photos an invoice prints (owner, Oct 1: "Ticket pictures need
-- to be able to be annotated like issues circled, text added etc, and those pictures need to be
-- able to be exported if so desired. This helps show what was wrong before on a repair job, and
-- the pictures should be able to be added to the invoice."). Idempotent.
--
-- A. A photo's marks (circle, arrow, box, text, tag) are vector JSON on its row,
--    service_job_photos.annotations: { "v": 1, "kind": "photo", "marks": [...] }, positions as
--    0..1 of the picture's width and height (src/lib/photo-annotations.ts). The photo itself is
--    never altered. The column was added for the aerial's markup (20260930092000); an aerial row
--    keeps its own markup there. Written by savePhotoAnnotations under the photo rules
--    (service_job_photos_write: Service access; a technician only their own ticket, checked by
--    the server function).
-- B. The photos an invoice prints: invoices.photo_ids, the chosen service_job_photos ids. Null =
--    never chosen: the default (each printed repair's first Before and first After photo, what
--    printed before). Per invoice, so a ticket's second invoice keeps its own choice. Written by
--    setInvoicePhotos under the invoice's own policy (invoices_office) and logged with the rest
--    of the invoice (audit_row).

-- ── A. Photo marks ──────────────────────────────────────────────────────────────────────────

alter table public.service_job_photos add column if not exists annotations jsonb;

alter table public.service_job_photos drop constraint if exists service_job_photos_annotations_shape;
alter table public.service_job_photos add constraint service_job_photos_annotations_shape
  check (
    annotations is null
    or (jsonb_typeof(annotations) = 'object' and pg_column_size(annotations) <= 262144)
  ) not valid;

comment on column public.service_job_photos.annotations is
  'Marks drawn over the photo ({v:1, kind:"photo", marks:[...]}, positions 0..1 of the picture; src/lib/photo-annotations.ts), or an aerial row''s markup (src/lib/aerial-markup.ts). The image is never altered.';

-- ── B. The photos an invoice prints ─────────────────────────────────────────────────────────

alter table public.invoices add column if not exists photo_ids uuid[];

alter table public.invoices drop constraint if exists invoices_photo_ids_size;
alter table public.invoices add constraint invoices_photo_ids_size
  check (photo_ids is null or coalesce(array_length(photo_ids, 1), 0) <= 200) not valid;

comment on column public.invoices.photo_ids is
  'The ticket photos (service_job_photos.id) printed on this invoice, with their marks. Null = the default: each printed repair''s first Before and first After photo (src/lib/invoice-photos.ts).';

-- PostgREST picks up the new column without a restart.
notify pgrst, 'reload schema';
