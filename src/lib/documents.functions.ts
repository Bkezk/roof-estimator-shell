/**
 * Documents (phase 1; owner, Oct 26: "bid advantage has a fairly robust document generator …
 * with or without cost, with or without pictures … save templates", CenterPoint's Build-a-Bid
 * editor as the model, and the rule that shapes it: "they need to be able to edit it after its
 * generated from the checkboxes"). A document is generated once from a template and the
 * checkboxes — its pages copied, its variables snapshotted from the bid or the ticket — and is
 * then edited on its own: the record is never touched, every save is a revision, and a save from
 * a tab that missed someone else's save is refused in plain words (the bid's stale-tab rule,
 * bid-stale-save.ts). The PDF (documents/document-pdf.server.ts) is drawn on demand and stored
 * per version; the share link (GET /d/<token>, src/routes/d.$token.ts) and Send serve that file.
 * Nothing is automated: no document is made or sent without someone pressing the button.
 *
 * Who: the database decides (migration 20261026150000: documents_access() = admins, managers,
 * Estimate / Invoices / Customers access; templates, saved modules and the PDF library are
 * written by admins and managers). Every read and write here runs as the signed-in user.
 * Pure helpers live in documents/server-pure.ts; the model in documents/model.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { managesTickets } from "@/lib/access";
import { easternYmd } from "@/lib/field-day";
import { parseInspection } from "@/lib/inspection";
import { SHARE_TOKEN_BYTES } from "@/lib/invoice-share";
import { parsePhotoMarks, type PhotoMark } from "@/lib/photo-annotations";
import { toBase64 } from "@/lib/webpush";

import { missingDefaultTemplates } from "./documents/defaults";
import {
  DOC_KINDS,
  type DocKind,
  type DocModule,
  type DocOptions,
  type DocPage,
  type ImageRef,
  moduleSchema,
  optionsSchema,
  pagesSchema,
} from "./documents/model";
import {
  backTo,
  bidFromSavedState,
  bytesFromBase64,
  copyName,
  displayName,
  displayVariables,
  DOCUMENTS_BUCKET,
  documentAssetPath,
  documentDeletedMessage,
  documentFileName,
  documentImagePath,
  documentPdfPath,
  documentSaveIsStale,
  documentShareUrl,
  documentStaleMessage,
  inspectionSnapshotFrom,
  isDocumentImagePath,
  isPdfBytes,
  MAX_ASSET_BYTES,
  MAX_IMAGE_BYTES,
  pagesForNewDocument,
  customerFromSavedState,
  propertyFallback,
  personOf,
  pickContact,
  poLine,
  recordLabel,
  recordProblem,
  SERVICE_BUCKET,
  shareOrigin,
  sniffImageType,
  withStoredInspection,
  withStoredPricing,
} from "./documents/server-pure";
import { type DocumentSource, resolveVariables } from "./documents/variables";

type Client = SupabaseClient<Database>;
type Ctx = { supabase: Client; userId: string };
type DbDocumentRow = Database["public"]["Tables"]["documents"]["Row"];
type DbDocumentTemplateRow = Database["public"]["Tables"]["document_templates"]["Row"];
/** A document as the editor reads it: the jsonb columns carry the model's types (validated on write). */
export type DocumentRow = Omit<DbDocumentRow, "kind" | "pages" | "options" | "variables"> & {
  kind: DocKind;
  pages: DocPage[];
  options: DocOptions;
  variables: Record<string, string>;
};
export type DocumentTemplateRow = Omit<DbDocumentTemplateRow, "kind" | "pages" | "options"> & {
  kind: DocKind;
  pages: DocPage[];
  options: DocOptions;
};
// The jsonb columns are validated on every write (pagesSchema / optionsSchema), so a row read
// back carries the model's types; these casts say so at the boundary.
const asTemplate = (r: DbDocumentTemplateRow) => r as unknown as DocumentTemplateRow;
const asDocument = (r: DbDocumentRow) => r as unknown as DocumentRow;
export type DocumentModuleRow = Database["public"]["Tables"]["document_modules"]["Row"];
export type DocumentAssetRow = Database["public"]["Tables"]["document_assets"]["Row"];
export type DocumentRevisionRow = Database["public"]["Tables"]["document_revisions"]["Row"];

const SIGNED_SECONDS = 3600;
const kindSchema = z.enum(DOC_KINDS);
const idInput = (d: unknown) => z.object({ id: z.string().uuid() }).parse(d);
const err = (e: { message: string } | null | undefined, fallback: string) =>
  new Error(e?.message || fallback);

/** Who is calling: the profile (the database has already decided what they may read). */
async function whoami(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician, full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data) throw new Error("Forbidden: no profile");
  return { profile: data, name: displayName(data) };
}
/** Templates, saved modules and the PDF library are written by admins and managers (RLS too). */
function managerOnly(p: { role: string; access: string[] }) {
  if (!managesTickets(p))
    throw new Error("Templates, saved modules and the PDF library are a manager's");
}

const json = (v: unknown) => v as Json;

// ---- Templates ------------------------------------------------------------------------------

const TEMPLATE_LIST_COLUMNS =
  "id, kind, name, description, options, is_default, updated_at, updated_by_name";
export type DocumentTemplateListRow = Pick<
  DocumentTemplateRow,
  | "id"
  | "kind"
  | "name"
  | "description"
  | "options"
  | "is_default"
  | "updated_at"
  | "updated_by_name"
>;

/**
 * The shipped templates (documents/defaults.ts) a database has never had — by kind and name,
 * deleted rows counted, so a template the office removed stays removed and one added in a later
 * phase (the Inspection report, Oct 26) reaches an install that already has the others — are
 * inserted; the first of a kind with no live template becomes its default. A reader who may not
 * write templates (RLS) simply sees none yet. Pure: missingDefaultTemplates.
 */
async function ensureDefaultTemplates(sb: Client, byName: string | null, userId: string) {
  const { data: all, error } = await sb.from("document_templates").select("kind, name, deleted_at");
  if (error) throw err(error, "Could not read the templates");
  const rows = missingDefaultTemplates(all ?? []).map((t) => ({
    kind: t.kind,
    name: t.name,
    description: t.description,
    pages: json(t.pages),
    options: json(t.options),
    is_default: t.isDefault,
    created_by: userId,
    updated_by_name: byName,
  }));
  if (!rows.length) return;
  const { error: iErr } = await sb.from("document_templates").insert(rows);
  if (iErr) console.warn(`Documents: the default templates were not inserted (${iErr.message})`);
}

export const listDocumentTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ kind: kindSchema.optional() }).parse(d))
  .handler(async ({ data, context }): Promise<DocumentTemplateListRow[]> => {
    const me = await whoami(context);
    const sb = context.supabase;
    await ensureDefaultTemplates(sb, me.name, context.userId);
    let q = sb
      .from("document_templates")
      .select(TEMPLATE_LIST_COLUMNS)
      .is("deleted_at", null)
      .order("kind")
      .order("is_default", { ascending: false })
      .order("name");
    if (data.kind) q = q.eq("kind", data.kind);
    const { data: rows, error } = await q;
    if (error) throw err(error, "Could not read the templates");
    return (rows ?? []) as unknown as DocumentTemplateListRow[];
  });

async function templateRow(sb: Client, id: string): Promise<DocumentTemplateRow> {
  const { data, error } = await sb
    .from("document_templates")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw err(error, "Could not read the template");
  if (!data) throw new Error("Template not found");
  return asTemplate(data);
}

export const getDocumentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<DocumentTemplateRow> => {
    await whoami(context);
    return templateRow(context.supabase, data.id);
  });

export const saveDocumentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        kind: kindSchema,
        name: z.string().trim().min(1).max(120),
        description: z.string().max(500).optional(),
        pages: pagesSchema,
        options: optionsSchema,
        isDefault: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<DocumentTemplateRow> => {
    const me = await whoami(context);
    managerOnly(me.profile);
    const sb = context.supabase;
    if (data.isDefault) await clearDefault(sb, data.kind, data.id ?? null, me.name);
    const patch = {
      kind: data.kind,
      name: data.name,
      ...(data.description !== undefined ? { description: data.description } : {}),
      pages: json(data.pages),
      options: json(data.options),
      ...(data.isDefault !== undefined ? { is_default: data.isDefault } : {}),
      updated_by_name: me.name,
    };
    if (data.id) {
      const { data: row, error } = await sb
        .from("document_templates")
        .update(patch)
        .eq("id", data.id)
        .is("deleted_at", null)
        .select("*")
        .maybeSingle();
      if (error) throw err(error, "The template was not saved");
      if (!row) throw new Error("Template not found");
      return asTemplate(row);
    }
    const { data: row, error } = await sb
      .from("document_templates")
      .insert({ ...patch, description: data.description ?? "", created_by: context.userId })
      .select("*")
      .single();
    if (error) throw err(error, "The template was not saved");
    return asTemplate(row);
  });

/** Clear the default flag on every live template of a kind but `keepId`. */
async function clearDefault(
  sb: Client,
  kind: DocKind,
  keepId: string | null,
  byName: string | null,
) {
  let q = sb
    .from("document_templates")
    .update({ is_default: false, updated_by_name: byName })
    .eq("kind", kind)
    .eq("is_default", true)
    .is("deleted_at", null);
  if (keepId) q = q.neq("id", keepId);
  const { error } = await q;
  if (error) throw err(error, "The default was not changed");
}

export const deleteDocumentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const me = await whoami(context);
    managerOnly(me.profile);
    const { error } = await context.supabase
      .from("document_templates")
      .update({ deleted_at: new Date().toISOString(), is_default: false, updated_by_name: me.name })
      .eq("id", data.id);
    if (error) throw err(error, "The template was not deleted");
    return { ok: true };
  });

export const setDefaultDocumentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<DocumentTemplateRow> => {
    const me = await whoami(context);
    managerOnly(me.profile);
    const sb = context.supabase;
    const t = await templateRow(sb, data.id);
    await clearDefault(sb, t.kind as DocKind, t.id, me.name);
    const { data: row, error } = await sb
      .from("document_templates")
      .update({ is_default: true, updated_by_name: me.name })
      .eq("id", t.id)
      .select("*")
      .single();
    if (error) throw err(error, "The default was not changed");
    return asTemplate(row);
  });

export const duplicateDocumentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<DocumentTemplateRow> => {
    const me = await whoami(context);
    managerOnly(me.profile);
    const sb = context.supabase;
    const t = await templateRow(sb, data.id);
    const { data: row, error } = await sb
      .from("document_templates")
      .insert({
        kind: t.kind,
        name: copyName(t.name),
        description: t.description,
        pages: json(t.pages),
        options: json(t.options),
        is_default: false,
        created_by: context.userId,
        updated_by_name: me.name,
      })
      .select("*")
      .single();
    if (error) throw err(error, "The template was not copied");
    return asTemplate(row);
  });

// ---- Saved modules --------------------------------------------------------------------------

export type SavedModuleRow = Omit<
  Pick<DocumentModuleRow, "id" | "name" | "module" | "updated_at">,
  "module"
> & {
  module: DocModule;
};

export const listSavedModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({})
      .optional()
      .parse(d ?? {}),
  )
  .handler(async ({ context }): Promise<SavedModuleRow[]> => {
    await whoami(context);
    const { data, error } = await context.supabase
      .from("document_modules")
      .select("id, name, module, updated_at")
      .is("deleted_at", null)
      .order("name");
    if (error) throw err(error, "Could not read the saved modules");
    return (data ?? []) as unknown as SavedModuleRow[];
  });

export const saveSavedModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(120),
        module: moduleSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<SavedModuleRow> => {
    const me = await whoami(context);
    managerOnly(me.profile);
    const sb = context.supabase;
    const patch = { name: data.name, module: json(data.module), updated_by_name: me.name };
    const q = data.id
      ? sb.from("document_modules").update(patch).eq("id", data.id).is("deleted_at", null)
      : sb.from("document_modules").insert({ ...patch, created_by: context.userId });
    const { data: row, error } = await q.select("id, name, module, updated_at").maybeSingle();
    if (error) throw err(error, "The module was not saved");
    if (!row) throw new Error("Saved module not found");
    return row as unknown as SavedModuleRow;
  });

export const deleteSavedModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const me = await whoami(context);
    managerOnly(me.profile);
    const { error } = await context.supabase
      .from("document_modules")
      .update({ deleted_at: new Date().toISOString(), updated_by_name: me.name })
      .eq("id", data.id);
    if (error) throw err(error, "The module was not deleted");
    return { ok: true };
  });

// ---- The PDF library ------------------------------------------------------------------------

export type DocumentAssetListRow = Pick<
  DocumentAssetRow,
  "id" | "name" | "page_count" | "size_bytes" | "created_at"
>;

export const listDocumentAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({})
      .optional()
      .parse(d ?? {}),
  )
  .handler(async ({ context }): Promise<DocumentAssetListRow[]> => {
    await whoami(context);
    const { data, error } = await context.supabase
      .from("document_assets")
      .select("id, name, page_count, size_bytes, created_at")
      .is("deleted_at", null)
      .order("name");
    if (error) throw err(error, "Could not read the PDF library");
    return data ?? [];
  });

/** A PDF into the library: checked by loading it (pdf-lib), stored at library/<uuid>.pdf. */
export const uploadDocumentAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(160),
        base64: z
          .string()
          .min(1)
          .max(Math.ceil((MAX_ASSET_BYTES * 4) / 3) + 1024),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<DocumentAssetRow> => {
    const me = await whoami(context);
    managerOnly(me.profile);
    const sb = context.supabase;
    const bytes = bytesFromBase64(data.base64);
    if (bytes.length > MAX_ASSET_BYTES) throw new Error("The PDF is over 20 MB");
    if (!isPdfBytes(bytes)) throw new Error("That file is not a PDF");
    const { PDFDocument } = await import("pdf-lib");
    let pageCount = 0;
    try {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      pageCount = pdf.getPageCount();
    } catch {
      throw new Error("That PDF could not be read");
    }
    if (!pageCount) throw new Error("That PDF has no pages");
    const { randomUUID } = await import("node:crypto");
    const path = documentAssetPath(randomUUID());
    const { error: upErr } = await sb.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(`Could not store the PDF: ${upErr.message}`);
    const { data: row, error } = await sb
      .from("document_assets")
      .insert({
        name: data.name.replace(/\.pdf$/i, ""),
        storage_path: path,
        page_count: pageCount,
        size_bytes: bytes.length,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw err(error, "The PDF was not added to the library");
    return row;
  });

/** Out of the library; the file stays (a document that inserted it still renders). */
export const deleteDocumentAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const me = await whoami(context);
    managerOnly(me.profile);
    const { error } = await context.supabase
      .from("document_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw err(error, "The PDF was not removed");
    return { ok: true };
  });

// ---- Pictures -------------------------------------------------------------------------------

/** A picture into a document (or a template): jpeg / png / webp by its bytes, 10 MB at most. */
export const uploadDocumentImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        documentId: z.string().uuid().optional(),
        templateId: z.string().uuid().optional(),
        fileName: z.string().max(200),
        base64: z
          .string()
          .min(1)
          .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .refine((v) => v.documentId || v.templateId, {
        message: "A picture belongs to a document or a template",
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ path: string; width: number; height: number }> => {
    await whoami(context);
    const bytes = bytesFromBase64(data.base64);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error("The picture is over 10 MB");
    const type = sniffImageType(bytes);
    if (!type) throw new Error("Pictures must be JPEG, PNG or WebP");
    const { randomUUID } = await import("node:crypto");
    const path = documentImagePath(data, randomUUID(), type);
    const { error } = await context.supabase.storage.from(DOCUMENTS_BUCKET).upload(path, bytes, {
      contentType: type === "jpeg" ? "image/jpeg" : `image/${type}`,
      upsert: false,
    });
    if (error) throw new Error(`Could not store the picture: ${error.message}`);
    return { path, width: data.width, height: data.height };
  });

/** A signed link (an hour) so the editor can show an uploaded picture. */
export const documentImageUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ path: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    await whoami(context);
    if (!isDocumentImagePath(data.path)) throw new Error("Not a document picture");
    const { data: signed, error } = await context.supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(data.path, SIGNED_SECONDS);
    if (error || !signed) throw new Error(error?.message ?? "Could not sign the picture");
    return { url: signed.signedUrl };
  });

// ---- Variables ------------------------------------------------------------------------------

interface LoadedSource {
  source: DocumentSource;
  label: string;
  accountId: string | null;
  /** The record's property and its cover photo (phase 2), when it has them. */
  siteId: string | null;
  siteCoverPath: string | null;
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Everything a document's variables come from, loaded with the caller's client and every lookup
 * tolerant of a blank (a bid with no customer yet, a ticket with no site): JBK itself
 * (company_settings), the bid or the ticket, the customer and a contact, the property and its
 * county, whoever made the record and the customer's account manager.
 */
async function loadSource(
  sb: Client,
  input: {
    kind: DocKind;
    bidId?: string | null | undefined;
    serviceJobId?: string | null | undefined;
    documentTitle: string;
  },
): Promise<LoadedSource> {
  const problem = recordProblem(input);
  if (problem) throw new Error(problem);
  const settingsQ = sb.from("company_settings").select("*").eq("id", 1).maybeSingle();

  let bid: DocumentSource["bid"] = null;
  let ticket: DocumentSource["ticket"] = null;
  let accountId: string | null = null;
  let siteId: string | null = null;
  let createdBy: string | null = null;
  let contactId: string | null = null;
  let label = "";
  let fallbackProperty: DocumentSource["property"] = null;
  let fallbackCompany: DocumentSource["company"] = null;
  let fallbackManagerName = "";
  let inspection: DocumentSource["inspection"] = null;

  if (input.kind === "bid") {
    const { data: row, error } = await sb
      .from("bids")
      .select("id, name, data, grand_total, due_date, account_id, site_id, created_by")
      .eq("id", input.bidId!)
      .maybeSingle();
    if (error) throw err(error, "Could not read the bid");
    if (!row) throw new Error("Bid not found");
    bid = bidFromSavedState(row.data, row);
    accountId = row.account_id;
    siteId = row.site_id;
    createdBy = row.created_by;
    label = recordLabel("bid", row);
    // Not linked to a customer record: the Setup step's typed-in customer block fills the
    // Company / Property variables (owner, Oct 26), with the bid's name as the property.
    const typed = customerFromSavedState(row.data, row.name);
    if (!accountId) fallbackCompany = typed.company;
    if (!siteId) {
      fallbackProperty = typed.property ? { ...typed.property, areaSqFt: bid.sqFt ?? null } : null;
    }
    fallbackManagerName = typed.estimatorName;
  } else {
    const { data: row, error } = await sb
      .from("service_jobs")
      .select(
        "id, number, description, scheduled_date, created_at, service_type, account_id, site_id, created_by, po_number, site_name, site_address, contact_id, inspection, technician_id",
      )
      .eq("id", input.serviceJobId!)
      .maybeSingle();
    if (error) throw err(error, "Could not read the ticket");
    if (!row) throw new Error("Ticket not found");
    const { data: pos } = await sb
      .from("service_job_purchase_orders")
      .select("po_number")
      .eq("service_job_id", row.id)
      .order("created_at");
    if (row.service_type === "inspection") inspection = await loadInspection(sb, row);
    ticket = {
      number: String(row.number),
      description: s(row.description),
      // The day it was made, in the office's zone, when it was never scheduled.
      date: row.scheduled_date ?? easternYmd(new Date(row.created_at)),
      po: poLine(pos ?? [], row.po_number),
      type: s(row.service_type),
    };
    accountId = row.account_id;
    siteId = row.site_id;
    createdBy = row.created_by;
    contactId = row.contact_id;
    label = recordLabel("ticket", row);
    if (!siteId && (s(row.site_name) || s(row.site_address)))
      fallbackProperty = {
        name: s(row.site_name),
        address: s(row.site_address),
        city: "",
        county: "",
        state: "",
        zip: "",
        areaSqFt: null,
      };
  }

  const [settings, account, contacts, site, manager] = await Promise.all([
    settingsQ,
    accountId
      ? sb
          .from("crm_accounts")
          .select(
            "id, name, contact_name, phone, mobile, email, address1, city, state, zip, external_id, account_manager_id",
          )
          .eq("id", accountId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    accountId
      ? sb
          .from("crm_contacts")
          .select("id, name, position, office_phone, mobile, email, is_billing")
          .eq("account_id", accountId)
          .is("deleted_at", null)
          .order("is_billing", { ascending: false })
          .order("created_at")
      : Promise.resolve({ data: null }),
    siteId
      ? sb
          .from("crm_sites")
          .select("id, name, address1, city, state, zip, county_code_id, cover_photo_path")
          .eq("id", siteId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    createdBy
      ? sb.from("profiles").select("full_name, email").eq("id", createdBy).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const acc = account.data;
  const [county, accountManager] = await Promise.all([
    site.data?.county_code_id
      ? sb.from("county_codes").select("county").eq("id", site.data.county_code_id).maybeSingle()
      : Promise.resolve({ data: null }),
    acc?.account_manager_id
      ? sb
          .from("profiles")
          .select("full_name, email")
          .eq("id", acc.account_manager_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const cs = settings.data;
  const officePhone = s(cs?.phone);
  const contactRows = contacts.data ?? [];
  const contact =
    (contactId ? contactRows.find((c) => c.id === contactId) : null) ?? pickContact(contactRows);

  const source: DocumentSource = {
    kind: input.kind,
    today: new Date(),
    documentTitle: input.documentTitle,
    account: {
      name: s(cs?.company_name),
      address: s(cs?.address),
      city: s(cs?.city),
      state: s(cs?.state),
      zip: s(cs?.zip),
      phone: officePhone,
      website: s(cs?.website),
      email: s(cs?.email),
    },
    company: acc
      ? {
          name: s(acc.name),
          contact: s(contact?.name) || s(acc.contact_name),
          contactPosition: s(contact?.position),
          phone: s(contact?.office_phone) || s(contact?.mobile) || s(acc.phone) || s(acc.mobile),
          email: s(contact?.email) || s(acc.email),
          address: s(acc.address1),
          city: s(acc.city),
          state: s(acc.state),
          zip: s(acc.zip),
          externalId: s(acc.external_id),
        }
      : fallbackCompany,
    property: site.data
      ? {
          name: s(site.data.name),
          address: s(site.data.address1),
          city: s(site.data.city),
          county: s(county.data?.county),
          state: s(site.data.state),
          zip: s(site.data.zip),
          areaSqFt: input.kind === "bid" ? (bid?.sqFt ?? null) : null,
        }
      : // No property picked: the customer's own address rather than blanks (owner, Oct 26,
        // Monticello: the bid is linked to the general contractor with no property), under the
        // typed / bid-name property when that carries an address of its own.
        propertyFallback(fallbackProperty, acc, input.kind === "bid" ? (bid?.sqFt ?? null) : null),
    bid,
    ticket,
    inspection,
    manager:
      personOf(manager.data, officePhone) ??
      (fallbackManagerName ? { name: fallbackManagerName, email: "", phone: officePhone } : null),
    accountManager: personOf(accountManager.data, officePhone),
  };
  return {
    source,
    label,
    accountId,
    siteId: site.data?.id ?? null,
    siteCoverPath: s(site.data?.cover_photo_path) || null,
  };
}

/**
 * An inspection ticket's snapshot (phase 2): the saved checklist (service_jobs.inspection) merged
 * with the live checklist, each item's photos (role other, no repair, item_key = the item), and
 * the technician's name (else the inspection's saved_by). server-pure.ts inspectionSnapshotFrom.
 */
async function loadInspection(
  sb: Client,
  row: { id: string; inspection: unknown; technician_id: string | null },
): Promise<NonNullable<DocumentSource["inspection"]>> {
  const [checklist, photos, tech] = await Promise.all([
    sb.from("inspection_checklist_items").select("id, label, sort").order("sort").order("label"),
    sb
      .from("service_job_photos")
      .select("id, role, repair_id, item_key, created_at")
      .eq("service_job_id", row.id)
      .eq("role", "other")
      .is("repair_id", null)
      .not("item_key", "is", null)
      .order("created_at"),
    row.technician_id
      ? sb.from("profiles").select("full_name, email").eq("id", row.technician_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return inspectionSnapshotFrom(
    parseInspection(row.inspection),
    checklist.data ?? [],
    photos.data ?? [],
    displayName(tech.data),
  );
}

/** The variables map a document stores: the resolved text plus the reserved pricing / inspection keys. */
const snapshot = (src: DocumentSource) =>
  withStoredInspection(
    withStoredPricing(resolveVariables(src), src.kind === "bid" ? src.bid : null),
    src.kind === "ticket" ? src.inspection : null,
  );

export const resolveDocumentVariables = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        kind: kindSchema,
        bidId: z.string().uuid().optional(),
        serviceJobId: z.string().uuid().optional(),
        documentTitle: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ variables: Record<string, string>; label: string; accountId: string | null }> => {
      await whoami(context);
      const loaded = await loadSource(context.supabase, {
        ...data,
        documentTitle: data.documentTitle ?? "",
      });
      return {
        variables: displayVariables(snapshot(loaded.source)),
        label: loaded.label,
        accountId: loaded.accountId,
      };
    },
  );

// ---- Documents ------------------------------------------------------------------------------

async function documentRow(sb: Client, id: string, includeDeleted = false): Promise<DocumentRow> {
  let q = sb.from("documents").select("*").eq("id", id);
  if (!includeDeleted) q = q.is("deleted_at", null);
  const { data, error } = await q.maybeSingle();
  if (error) throw err(error, "Could not read the document");
  if (!data) throw new Error("Document not found");
  return asDocument(data);
}

export const createDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        kind: kindSchema,
        bidId: z.string().uuid().optional(),
        serviceJobId: z.string().uuid().optional(),
        templateId: z.string().uuid().nullable(),
        title: z.string().trim().min(1).max(200),
        options: optionsSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const me = await whoami(context);
    const sb = context.supabase;
    const loaded = await loadSource(sb, { ...data, documentTitle: data.title });
    let templatePages: DocPage[] | null = null;
    if (data.templateId) {
      const t = await templateRow(sb, data.templateId);
      if (t.kind !== data.kind) throw new Error("That template is for the other kind of record");
      const parsed = pagesSchema.safeParse(t.pages);
      templatePages = parsed.success ? parsed.data : [];
    }
    // The property's cover photo (phase 2) fills the template's first empty Full Photo on page 1.
    const cover: ImageRef | null =
      loaded.siteId && loaded.siteCoverPath ? { kind: "siteCover", siteId: loaded.siteId } : null;
    const pages = pagesForNewDocument(templatePages, data.options, cover);
    const variables = snapshot(loaded.source);
    const { data: row, error } = await sb
      .from("documents")
      .insert({
        kind: data.kind,
        bid_id: data.kind === "bid" ? data.bidId! : null,
        service_job_id: data.kind === "ticket" ? data.serviceJobId! : null,
        account_id: loaded.accountId,
        title: data.title,
        template_id: data.templateId,
        pages: json(pages),
        options: json(data.options),
        variables: json(variables),
        version: 1,
        created_by: context.userId,
        updated_by_name: me.name,
      })
      .select("*")
      .single();
    if (error) throw err(error, "The document was not created");
    const { error: rErr } = await sb.from("document_revisions").insert({
      document_id: row.id,
      version: 1,
      title: row.title,
      pages: row.pages,
      options: row.options,
      saved_by_name: me.name,
    });
    if (rErr) console.warn(`Documents: revision 1 of ${row.id} was not written (${rErr.message})`);
    return { id: row.id };
  });

export interface DocumentPhoto {
  id: string;
  serviceJobId: string;
  fileName: string;
  url: string;
  hasMarks: boolean;
  /** The ticket's marks (photo-annotations.ts), drawn on the editor's canvas (phase 2). */
  marks: PhotoMark[];
  /** The checklist item the photo was taken for (service_job_photos.item_key), or null. */
  itemKey: string | null;
  takenAt: string | null;
}
export interface DocumentBundle {
  document: DocumentRow;
  photos: DocumentPhoto[];
  recordLabel: string;
  backTo: ReturnType<typeof backTo>;
  contacts: Array<{ name: string; email: string }>;
  templateName: string | null;
  /** The record's property (phase 2) and a signed link to its cover photo, when it has one. */
  siteId: string | null;
  siteCoverUrl: string | null;
}

/** The record's label for a document row (its bid's name or "Ticket <number>"). */
async function labelOf(sb: Client, doc: Pick<DocumentRow, "kind" | "bid_id" | "service_job_id">) {
  if (doc.kind === "bid" && doc.bid_id) {
    const { data } = await sb.from("bids").select("name").eq("id", doc.bid_id).maybeSingle();
    return recordLabel("bid", data);
  }
  if (doc.service_job_id) {
    const { data } = await sb
      .from("service_jobs")
      .select("number")
      .eq("id", doc.service_job_id)
      .maybeSingle();
    return recordLabel("ticket", data);
  }
  return recordLabel(doc.kind as DocKind, null);
}

export const getDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<DocumentBundle> => {
    await whoami(context);
    const sb = context.supabase;
    const doc = await documentRow(sb, data.id, true);
    const [label, photos, contacts, template, site] = await Promise.all([
      labelOf(sb, doc),
      ticketPhotos(sb, doc),
      doc.account_id
        ? sb
            .from("crm_contacts")
            .select("name, email, is_billing")
            .eq("account_id", doc.account_id)
            .is("deleted_at", null)
            .not("email", "is", null)
            .order("is_billing", { ascending: false })
            .order("name")
        : Promise.resolve({ data: null }),
      doc.template_id
        ? sb.from("document_templates").select("name").eq("id", doc.template_id).maybeSingle()
        : Promise.resolve({ data: null }),
      recordSite(sb, doc),
    ]);
    return {
      document: doc,
      photos,
      recordLabel: label,
      backTo: backTo(doc.kind as DocKind, { bidId: doc.bid_id, serviceJobId: doc.service_job_id }),
      contacts: (contacts.data ?? [])
        .filter((c) => s(c.email))
        .map((c) => ({ name: s(c.name), email: s(c.email) })),
      templateName: template.data?.name ?? null,
      siteId: site.id,
      siteCoverUrl: site.coverUrl,
    };
  });

/** The record's property and a signed link (an hour) to its cover photo (phase 2); none → nulls. */
async function recordSite(
  sb: Client,
  doc: Pick<DocumentRow, "kind" | "bid_id" | "service_job_id">,
): Promise<{ id: string | null; coverUrl: string | null }> {
  const none = { id: null, coverUrl: null };
  const rec =
    doc.kind === "bid" && doc.bid_id
      ? await sb.from("bids").select("site_id").eq("id", doc.bid_id).maybeSingle()
      : doc.service_job_id
        ? await sb.from("service_jobs").select("site_id").eq("id", doc.service_job_id).maybeSingle()
        : { data: null };
  const siteId = rec.data?.site_id ?? null;
  if (!siteId) return none;
  const { data: site } = await sb
    .from("crm_sites")
    .select("id, cover_photo_path")
    .eq("id", siteId)
    .maybeSingle();
  if (!site) return none;
  if (!site.cover_photo_path) return { id: site.id, coverUrl: null };
  const { data: signed } = await sb.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(site.cover_photo_path, SIGNED_SECONDS);
  return { id: site.id, coverUrl: signed?.signedUrl ?? null };
}

/** A ticket document's photos (signed an hour), for the editor's picture picker; a bid's: none. */
async function ticketPhotos(sb: Client, doc: DocumentRow): Promise<DocumentPhoto[]> {
  if (doc.kind !== "ticket" || !doc.service_job_id) return [];
  const { data: rows } = await sb
    .from("service_job_photos")
    .select("id, file_name, storage_path, annotations, taken_at, created_at, role, item_key")
    .eq("service_job_id", doc.service_job_id)
    .neq("role", "signature")
    .order("created_at");
  if (!rows?.length) return [];
  const { data: signed } = await sb.storage.from(SERVICE_BUCKET).createSignedUrls(
    rows.map((r) => r.storage_path),
    SIGNED_SECONDS,
  );
  const urls = new Map<string, string>();
  for (const d of signed ?? [])
    if (d.path && d.signedUrl && !d.error) urls.set(d.path, d.signedUrl);
  return rows
    .filter((r) => urls.has(r.storage_path))
    .map((r) => {
      const marks = parsePhotoMarks(r.annotations);
      return {
        id: r.id,
        serviceJobId: doc.service_job_id!,
        fileName: r.file_name ?? "",
        url: urls.get(r.storage_path)!,
        hasMarks: marks.length > 0,
        marks,
        itemKey: r.item_key,
        takenAt: r.taken_at ?? r.created_at,
      };
    });
}

/**
 * Write a new version: refused when the row was deleted or its version moved on since the tab
 * opened it (the stale-tab rule — the row's version, never its updated_at, which the trigger
 * moves on any update). The update is guarded on the version too, so two tabs saving at once
 * cannot both win. Every version is kept as a revision.
 */
async function writeVersion(
  sb: Client,
  row: DocumentRow,
  next: { title: string; pages: DocPage[]; options: DocOptions },
  expectVersion: number,
  byName: string | null,
): Promise<{ version: number; updated_at: string }> {
  if (row.deleted_at) throw new Error(documentDeletedMessage(row.deleted_at));
  if (documentSaveIsStale(expectVersion, row.version))
    throw new Error(documentStaleMessage(row.updated_by_name, row.updated_at, byName));
  const version = row.version + 1;
  const { data, error } = await sb
    .from("documents")
    .update({
      title: next.title,
      pages: json(next.pages),
      options: json(next.options),
      version,
      updated_at: new Date().toISOString(),
      updated_by_name: byName,
    })
    .eq("id", row.id)
    .eq("version", row.version)
    .is("deleted_at", null)
    .select("version, updated_at")
    .maybeSingle();
  if (error) throw err(error, "The document was not saved");
  if (!data) {
    // Someone saved between our read and our write: say who.
    const again = await documentRow(sb, row.id, true);
    if (again.deleted_at) throw new Error(documentDeletedMessage(again.deleted_at));
    throw new Error(documentStaleMessage(again.updated_by_name, again.updated_at, byName));
  }
  const { error: rErr } = await sb.from("document_revisions").insert({
    document_id: row.id,
    version,
    title: next.title,
    pages: json(next.pages),
    options: json(next.options),
    saved_by_name: byName,
  });
  if (rErr)
    console.warn(`Documents: revision ${version} of ${row.id} was not written (${rErr.message})`);
  return data;
}

export const saveDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        pages: pagesSchema,
        options: optionsSchema,
        expectVersion: z.number().int().positive(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ version: number; updated_at: string }> => {
    const me = await whoami(context);
    const sb = context.supabase;
    const row = await documentRow(sb, data.id, true);
    return writeVersion(sb, row, data, data.expectVersion, me.name);
  });

/** Re-read the record and store the variables again (the Variables tab's "Refresh data"). */
export const refreshDocumentVariables = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<{ variables: Record<string, string> }> => {
    const me = await whoami(context);
    const sb = context.supabase;
    const row = await documentRow(sb, data.id);
    const loaded = await loadSource(sb, {
      kind: row.kind as DocKind,
      bidId: row.bid_id,
      serviceJobId: row.service_job_id,
      documentTitle: row.title,
    });
    const variables = snapshot(loaded.source);
    const { error } = await sb
      .from("documents")
      .update({
        variables: json(variables),
        account_id: loaded.accountId,
        updated_by_name: me.name,
      })
      .eq("id", row.id);
    if (error) throw err(error, "The variables were not refreshed");
    return { variables: displayVariables(variables) };
  });

export interface DocumentListItem {
  id: string;
  kind: string;
  bid_id: string | null;
  service_job_id: string | null;
  title: string;
  version: number;
  updated_at: string;
  updated_by_name: string | null;
  rendered_at: string | null;
  rendered_version: number | null;
  sent_at: string | null;
  shared: boolean;
  recordLabel: string;
}

export const listDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        bidId: z.string().uuid().optional(),
        serviceJobId: z.string().uuid().optional(),
        accountId: z.string().uuid().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<DocumentListItem[]> => {
    await whoami(context);
    const sb = context.supabase;
    let q = sb
      .from("documents")
      .select(
        "id, kind, bid_id, service_job_id, title, version, updated_at, updated_by_name, rendered_at, rendered_version, sent_at, share_token",
      )
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (data.bidId) q = q.eq("bid_id", data.bidId);
    if (data.serviceJobId) q = q.eq("service_job_id", data.serviceJobId);
    if (data.accountId) q = q.eq("account_id", data.accountId);
    const { data: rows, error } = await q;
    if (error) throw err(error, "Could not read the documents");
    const bidIds = [...new Set((rows ?? []).map((r) => r.bid_id).filter((x): x is string => !!x))];
    const jobIds = [
      ...new Set((rows ?? []).map((r) => r.service_job_id).filter((x): x is string => !!x)),
    ];
    const [bids, jobs] = await Promise.all([
      bidIds.length
        ? sb.from("bids").select("id, name").in("id", bidIds)
        : Promise.resolve({ data: null }),
      jobIds.length
        ? sb.from("service_jobs").select("id, number").in("id", jobIds)
        : Promise.resolve({ data: null }),
    ]);
    const bidName = new Map((bids.data ?? []).map((b) => [b.id, b]));
    const jobNumber = new Map((jobs.data ?? []).map((j) => [j.id, j]));
    return (rows ?? []).map(({ share_token, ...r }) => ({
      ...r,
      shared: !!share_token,
      recordLabel:
        r.kind === "bid"
          ? recordLabel("bid", r.bid_id ? bidName.get(r.bid_id) : null)
          : recordLabel("ticket", r.service_job_id ? jobNumber.get(r.service_job_id) : null),
    }));
  });

export type DocumentRevisionListRow = Pick<
  DocumentRevisionRow,
  "version" | "title" | "saved_by_name" | "saved_at"
>;

export const listDocumentRevisions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<DocumentRevisionListRow[]> => {
    await whoami(context);
    const { data: rows, error } = await context.supabase
      .from("document_revisions")
      .select("version, title, saved_by_name, saved_at")
      .eq("document_id", data.id)
      .order("version", { ascending: false });
    if (error) throw err(error, "Could not read the revisions");
    return rows ?? [];
  });

/** Bring a revision back as a NEW version (the same path as a save; nothing is overwritten). */
export const restoreDocumentRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), version: z.number().int().positive() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ version: number; updated_at: string }> => {
    const me = await whoami(context);
    const sb = context.supabase;
    const row = await documentRow(sb, data.id, true);
    const { data: rev, error } = await sb
      .from("document_revisions")
      .select("*")
      .eq("document_id", data.id)
      .eq("version", data.version)
      .maybeSingle();
    if (error) throw err(error, "Could not read the revision");
    if (!rev) throw new Error("Revision not found");
    const pages = pagesSchema.safeParse(rev.pages);
    const options = optionsSchema.safeParse(rev.options);
    if (!pages.success || !options.success) throw new Error("That revision cannot be read");
    return writeVersion(
      sb,
      row,
      { title: rev.title, pages: pages.data, options: options.data },
      row.version,
      me.name,
    );
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const me = await whoami(context);
    const { error } = await context.supabase
      .from("documents")
      .update({ deleted_at: new Date().toISOString(), updated_by_name: me.name })
      .eq("id", data.id)
      .is("deleted_at", null);
    if (error) throw err(error, "The document was not deleted");
    return { ok: true };
  });

export const restoreDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const me = await whoami(context);
    const { error } = await context.supabase
      .from("documents")
      .update({ deleted_at: null, updated_by_name: me.name })
      .eq("id", data.id);
    if (error) throw err(error, "The document was not restored");
    return { ok: true };
  });

// ---- The PDF --------------------------------------------------------------------------------

/** Draw the document and store the file for its version; the row remembers which version. */
async function renderAndStore(sb: Client, row: DocumentRow): Promise<Uint8Array> {
  const { renderDocumentPdf: render } = await import("@/lib/documents/document-pdf.server");
  const pdf = await render(sb, row);
  const path = documentPdfPath(row.id, row.version);
  const { error: upErr } = await sb.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) {
    console.warn(
      `Documents: the PDF of ${row.id} v${row.version} was not stored (${upErr.message})`,
    );
    return pdf;
  }
  // Only while the row is still at this version: a save in between must not claim this file.
  const { error } = await sb
    .from("documents")
    .update({
      pdf_path: path,
      rendered_at: new Date().toISOString(),
      rendered_version: row.version,
    })
    .eq("id", row.id)
    .eq("version", row.version);
  if (error) console.warn(`Documents: pdf_path of ${row.id} was not recorded (${error.message})`);
  return pdf;
}

/**
 * The document's PDF: the stored file when it is this version's, else drawn now and stored.
 * Exported for the public share-link route (src/routes/d.$token.ts), which serves the same
 * bytes with the admin client.
 */
export async function documentPdfBytes(
  sb: Client,
  raw: DocumentRow | DbDocumentRow,
): Promise<Uint8Array> {
  const row = raw as DocumentRow;
  if (row.pdf_path && row.rendered_version === row.version) {
    const { data, error } = await sb.storage.from(DOCUMENTS_BUCKET).download(row.pdf_path);
    if (!error && data) return new Uint8Array(await data.arrayBuffer());
    console.warn(`Documents: the stored PDF ${row.pdf_path} is missing; drawn again`);
  }
  return renderAndStore(sb, row);
}

export const renderDocumentPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(
    async ({ data, context }): Promise<{ base64: string; fileName: string; version: number }> => {
      await whoami(context);
      const row = await documentRow(context.supabase, data.id);
      const pdf = await renderAndStore(context.supabase, row);
      return { base64: toBase64(pdf), fileName: documentFileName(row.title), version: row.version };
    },
  );

export const getDocumentPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(
    async ({ data, context }): Promise<{ base64: string; fileName: string; version: number }> => {
      await whoami(context);
      const row = await documentRow(context.supabase, data.id);
      const pdf = await documentPdfBytes(context.supabase, row);
      return { base64: toBase64(pdf), fileName: documentFileName(row.title), version: row.version };
    },
  );

// ---- The share link -------------------------------------------------------------------------

/** A fresh share token: 32 random bytes as base64url (43 characters; invoice-share.ts isShareToken). */
async function newShareToken(): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

/** The origin a link starts with: APP_URL, else the request's host (server-pure.ts shareOrigin). */
async function linkOrigin(): Promise<string> {
  const { appUrl } = await import("@/lib/notify.server");
  let headers: Headers | null = null;
  let url: string | null = null;
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    headers = req.headers;
    url = req.url;
  } catch {
    /* no request (a test) */
  }
  return shareOrigin(appUrl(), headers, url);
}

export interface DocumentShareState {
  url: string | null;
  share_views: number;
  share_last_viewed_at: string | null;
}

/** Make the document's share link (or return the one it has) — written only where the row has none. */
export const createDocumentShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<DocumentShareState & { url: string }> => {
    const me = await whoami(context);
    const sb = context.supabase;
    let row = await documentRow(sb, data.id);
    if (!row.share_token) {
      const { data: updated, error } = await sb
        .from("documents")
        .update({ share_token: await newShareToken(), updated_by_name: me.name })
        .eq("id", row.id)
        .is("share_token", null)
        .select("*")
        .maybeSingle();
      if (error) throw err(error, "The share link was not saved");
      // Made meanwhile by someone else: theirs is the link.
      row = updated ? asDocument(updated) : await documentRow(sb, data.id);
      if (!row.share_token) throw new Error("The share link was not saved");
    }
    const origin = await linkOrigin();
    if (!origin) throw new Error("The portal's address is not known (set APP_URL)");
    return {
      url: documentShareUrl(origin, row.share_token),
      share_views: row.share_views,
      share_last_viewed_at: row.share_last_viewed_at,
    };
  });

/** Turn the link off: the token cleared (the view counts stay); a new link can be made later. */
export const revokeDocumentShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<DocumentShareState> => {
    const me = await whoami(context);
    const { data: row, error } = await context.supabase
      .from("documents")
      .update({ share_token: null, updated_by_name: me.name })
      .eq("id", data.id)
      .select("share_views, share_last_viewed_at")
      .maybeSingle();
    if (error) throw err(error, "The share link was not turned off");
    if (!row) throw new Error("Document not found");
    return { url: null, ...row };
  });

// ---- Email ----------------------------------------------------------------------------------

/** Email the PDF (this version's, drawn now when needed); the row remembers when and to whom. */
export const emailDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        to: z.array(z.string().trim().email()).min(1).max(10),
        subject: z.string().trim().min(1).max(200),
        text: z.string().max(5000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const me = await whoami(context);
    const sb = context.supabase;
    const row = await documentRow(sb, data.id);
    const pdf = await documentPdfBytes(sb, row);
    const { emailPdf } = await import("@/lib/documents/email.server");
    const r = await emailPdf({
      to: data.to,
      subject: data.subject,
      text: data.text,
      pdf,
      fileName: documentFileName(row.title),
    });
    if (!r.ok) throw new Error(`The document was not sent: ${r.error}`);
    const { error } = await sb
      .from("documents")
      .update({ sent_at: new Date().toISOString(), sent_to: data.to, updated_by_name: me.name })
      .eq("id", row.id);
    if (error) console.warn(`Documents: sent_at of ${row.id} was not recorded (${error.message})`);
    return { ok: true };
  });
