/**
 * The wiring of the Documents server half (owner, Oct 26): every server function the editor and
 * the lists call exists under its agreed name, a save checks the tab's version before it writes,
 * the migration carries the four tables, the bucket, the access helper and the two Account
 * columns, types.ts knows the tables, and the share route serves with the admin client without
 * ever logging the token. Text pins: the lead's live check is the proof on the database.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const MIGRATION = "../../../supabase/migrations/20261026150000_documents.sql";

const FUNCTIONS = [
  "listDocumentTemplates",
  "getDocumentTemplate",
  "saveDocumentTemplate",
  "deleteDocumentTemplate",
  "setDefaultDocumentTemplate",
  "duplicateDocumentTemplate",
  "listSavedModules",
  "saveSavedModule",
  "deleteSavedModule",
  "listDocumentAssets",
  "uploadDocumentAsset",
  "deleteDocumentAsset",
  "uploadDocumentImage",
  "documentImageUrl",
  "resolveDocumentVariables",
  "createDocument",
  "getDocument",
  "saveDocument",
  "refreshDocumentVariables",
  "listDocuments",
  "listDocumentRevisions",
  "restoreDocumentRevision",
  "deleteDocument",
  "restoreDocument",
  "renderDocumentPdf",
  "getDocumentPdf",
  "createDocumentShareLink",
  "revokeDocumentShareLink",
  "emailDocument",
];

function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

describe("documents.functions.ts", () => {
  const fn = read("../documents.functions.ts");
  it("defines every server function under its agreed name, authenticated and validated", () => {
    for (const name of FUNCTIONS) {
      const body = serverFn(fn, name);
      expect(body, name).toContain(".middleware([requireSupabaseAuth])");
      expect(body, name).toContain(".validator(");
    }
    expect(fn).toContain("export async function documentPdfBytes(");
  });
  it("saveDocument checks the tab's version before writing, guards the update on it, and keeps a revision", () => {
    const write = fn.slice(
      fn.indexOf("async function writeVersion("),
      fn.indexOf("export const saveDocument ="),
    );
    const check = write.indexOf("documentSaveIsStale(expectVersion, row.version)");
    const update = write.indexOf('.from("documents")\n    .update(');
    expect(check).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(check);
    expect(write).toContain('.eq("version", row.version)');
    expect(write).toContain('.from("document_revisions").insert(');
    expect(write).toContain("documentStaleMessage(row.updated_by_name, row.updated_at, byName)");
    expect(write).toContain("documentDeletedMessage(row.deleted_at)");
    expect(serverFn(fn, "saveDocument")).toContain("expectVersion: z.number().int().positive()");
    expect(serverFn(fn, "restoreDocumentRevision")).toContain("writeVersion(");
  });
  it("runs as the signed-in user: no admin client, soft deletes only, PDFs in the documents bucket", () => {
    expect(fn).not.toMatch(/supabaseAdmin|client\.server|SUPABASE_SERVICE/);
    expect(fn).not.toMatch(/\.delete\(\)/);
    expect(fn).toContain("documentPdfPath(row.id, row.version)");
    expect(fn).toContain("rendered_version: row.version");
    expect(fn).toContain('randomBytes(SHARE_TOKEN_BYTES).toString("base64url")');
    expect(fn).toContain("documentShareUrl(origin, row.share_token)");
  });
  it("templates, saved modules and the PDF library are a manager's to write", () => {
    for (const name of [
      "saveDocumentTemplate",
      "deleteDocumentTemplate",
      "setDefaultDocumentTemplate",
      "duplicateDocumentTemplate",
      "saveSavedModule",
      "deleteSavedModule",
      "uploadDocumentAsset",
      "deleteDocumentAsset",
    ])
      expect(serverFn(fn, name), name).toContain("managerOnly(me.profile)");
    expect(serverFn(fn, "uploadDocumentAsset")).toContain("PDFDocument.load(bytes");
    expect(serverFn(fn, "uploadDocumentImage")).toContain("sniffImageType(bytes)");
  });
});

describe("the migration 20261026150000_documents.sql", () => {
  it("exists with the four tables, the revisions, the bucket, the access helper, the view counter and the Account columns", () => {
    expect(existsSync(fileURLToPath(new URL(MIGRATION, import.meta.url)))).toBe(true);
    const sql = read(MIGRATION).replace(/--[^\n]*/g, "");
    for (const t of [
      "document_templates",
      "document_modules",
      "document_assets",
      "documents",
      "document_revisions",
    ])
      expect(sql, t).toContain(`create table if not exists public.${t} (`);
    expect(sql).toContain("create or replace function public.documents_access()");
    expect(sql).toContain("public.has_access('estimate')");
    expect(sql).toContain("public.has_access('invoices')");
    expect(sql).toContain("public.has_access('customers')");
    expect(sql).toContain("create or replace function public.document_share_viewed(p_token text)");
    expect(sql).toContain(
      "grant execute on function public.document_share_viewed(text) to service_role;",
    );
    expect(sql).toContain("values ('documents', 'documents', false, 26214400,");
    for (const p of [
      "documents_objects_read",
      "documents_objects_insert",
      "documents_objects_update",
      "documents_objects_delete",
    ])
      expect(sql, p).toContain(`create policy ${p} on storage.objects`);
    expect(sql).toContain(
      "alter table public.company_settings\n  add column if not exists website text,\n  add column if not exists email text;",
    );
    expect(sql).toContain(
      "on public.document_templates (kind) where is_default and deleted_at is null",
    );
    expect(sql).toContain("constraint documents_one_record check (");
    expect(sql).toContain("unique (document_id, version)");
    // Every created_by points at profiles (restore-door.test.ts maps user ids by that).
    expect(
      (sql.match(/created_by uuid references public\.profiles\(id\) on delete set null/g) ?? [])
        .length,
    ).toBe(4);
    // Re-runnable: every table "if not exists", every function "or replace", every policy and
    // trigger dropped first, every column "if not exists".
    expect(sql).not.toMatch(/^create table public\./m);
    expect(sql).not.toMatch(/^create function/m);
    expect(sql).not.toMatch(/^create trigger (\w+) on/m);
    for (const m of sql.matchAll(/^create policy (\w+) on ((?:public|storage)\.\w+)/gm))
      expect(sql, m[1]).toContain(`drop policy if exists ${m[1]} on ${m[2]};`);
    for (const m of sql.matchAll(/^create trigger (\w+) before update on (public\.\w+)/gm))
      expect(sql, m[1]).toContain(`drop trigger if exists ${m[1]} on ${m[2]};`);
    expect(sql).not.toMatch(/^\s+add column (?!if not exists)/m);
  });
  it("templates, modules and the library are written by admins and managers; documents by anyone with access", () => {
    const sql = read(MIGRATION)
      .replace(/--[^\n]*/g, "")
      .replace(/\s+/g, " ");
    for (const t of ["document_templates", "document_modules", "document_assets"])
      for (const op of ["insert", "update", "delete"])
        expect(sql, `${t}_${op}`).toMatch(
          new RegExp(
            `create policy ${t}_${op} on public\\.${t} for ${op} to authenticated [^;]*public\\.documents_access\\(\\) and \\(public\\.is_admin\\(\\) or public\\.is_manager\\(\\)\\)`,
          ),
        );
    expect(sql).toContain(
      "create policy documents_insert on public.documents for insert to authenticated with check (public.documents_access());",
    );
    expect(sql).toContain(
      "create policy document_revisions_read on public.document_revisions for select to authenticated using (public.documents_access());",
    );
  });
});

describe("types.ts and the share route", () => {
  it("types.ts knows the five tables, the two columns and the two functions", () => {
    const t = read("../../integrations/supabase/types.ts");
    for (const name of [
      "document_assets",
      "document_modules",
      "document_revisions",
      "document_templates",
      "documents",
    ])
      expect(t, name).toContain(`      ${name}: {\n        Row: {`);
    expect(t).toContain(
      "      document_share_viewed: { Args: { p_token: string }; Returns: undefined };",
    );
    expect(t).toContain("      documents_access: { Args: never; Returns: boolean };");
    const cs = t.slice(t.indexOf("      company_settings: {"), t.indexOf("      county_codes: {"));
    expect(cs).toContain("          website: string | null;");
    expect(cs).toContain("          email: string | null;");
  });
  it("GET /d/<token> reads with the admin client, serves this version's PDF, counts the view, never logs the token", () => {
    const route = read("../../routes/d.$token.ts");
    expect(route).toContain('createFileRoute("/d/$token")');
    expect(route).toContain('.eq("share_token", token)');
    expect(route).toContain('.is("deleted_at", null)');
    expect(route).toContain("documentPdfBytes(supabaseAdmin, doc)");
    expect(route).toContain('supabaseAdmin.rpc("document_share_viewed", { p_token: token })');
    expect(route).toContain('"cache-control": "private, no-store"');
    expect(route).toContain('"x-robots-tag": "noindex"');
    expect(route).not.toMatch(/console\.(info|warn|error)\([^)]*\btoken\b/);
    expect(route).toContain("documentShareLogLine(");
  });
  it("the PDF renderer only draws what the pure layout placed, and reuses the invoice's photo marks", () => {
    const pdf = read("./document-pdf.server.ts");
    expect(pdf).toContain('from "./pdf-layout"');
    expect(pdf).toContain(
      "drawPhotoMarks({ page: this.page, bold: this.fonts.bold }, img.marks, box)",
    );
    expect(pdf).toContain('import { drawPhotoMarks } from "@/lib/invoices.server"');
    expect(pdf).toContain("StandardFonts.HelveticaBoldOblique");
    expect(pdf).toContain("pdf.copyPages(asset, asset.getPageIndices())");
    expect(pdf).not.toContain("widthOfTextAtSize(clean(text), size) *");
  });
  it("global search finds documents by title and opens them in the editor; the pages are gated", () => {
    const search = read("../global-search.ts");
    expect(search).toContain('"document",\n] as const;');
    expect(search).toContain('document: ["title"]');
    expect(search).toContain('return { to: "/documents", search: { id: row.id } };');
    const access = read("../access.ts");
    expect(access).toContain('pathname.startsWith("/admin/documents")');
    expect(access).toContain('if (pathname.startsWith("/documents")) return null;');
  });
});
