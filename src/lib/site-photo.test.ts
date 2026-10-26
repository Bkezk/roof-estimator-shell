/**
 * The property's cover photo (phase 2 of the documents; owner, Oct 26): the pure helpers, and
 * pins on the server half (site-photo.functions.ts: three authenticated, validated functions in
 * the documents bucket, the old file removed) and the card (property-sites.tsx SiteCoverPhoto:
 * shrunk on the client, Set cover photo / Replace / Remove, mounted on both property cards).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  coverButtonLabel,
  isSiteCoverPath,
  MAX_SITE_COVER_BYTES,
  siteCoverContentType,
  siteCoverPath,
  siteIdOfCoverPath,
} from "./site-photo";

const read = (p: string) => readFileSync(p, "utf8");
const SITE = "55555555-5555-4555-8555-555555555555";

describe("site-photo.ts", () => {
  it("paths live under sites/<site id>/, jpeg as .jpg; the check admits only those", () => {
    expect(siteCoverPath(SITE, "abc-123", "jpeg")).toBe(`sites/${SITE}/abc-123.jpg`);
    expect(siteCoverPath(SITE, "abc", "png")).toBe(`sites/${SITE}/abc.png`);
    expect(siteCoverPath(SITE, "abc", "webp")).toBe(`sites/${SITE}/abc.webp`);
    expect(isSiteCoverPath(`sites/${SITE}/abc.jpg`)).toBe(true);
    expect(isSiteCoverPath(`sites/${SITE}/../x.jpg`)).toBe(false);
    expect(isSiteCoverPath("docs/d/a.jpg")).toBe(false);
    expect(isSiteCoverPath(`sites/${SITE}/a.gif`)).toBe(false);
    expect(siteIdOfCoverPath(`sites/${SITE}/abc.jpg`)).toBe(SITE);
    expect(siteIdOfCoverPath("docs/d/a.jpg")).toBeNull();
  });
  it("4 MB after the client's shrink; the content type from the sniffed bytes; the button's words", () => {
    expect(MAX_SITE_COVER_BYTES).toBe(4 * 1024 * 1024);
    expect(siteCoverContentType("jpeg")).toBe("image/jpeg");
    expect(siteCoverContentType("webp")).toBe("image/webp");
    expect(coverButtonLabel(false)).toBe("Set cover photo");
    expect(coverButtonLabel(true)).toBe("Replace");
  });
});

describe("site-photo.functions.ts", () => {
  const fn = read("src/lib/site-photo.functions.ts");
  const serverFn = (name: string) => {
    const start = fn.indexOf(`export const ${name} = createServerFn`);
    expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
    const next = fn.indexOf("\nexport ", start + 1);
    return fn.slice(start, next < 0 ? undefined : next);
  };
  it("setSiteCoverPhoto, clearSiteCoverPhoto and siteCoverUrl: authenticated, validated, the property's editors only", () => {
    for (const name of ["setSiteCoverPhoto", "clearSiteCoverPhoto", "siteCoverUrl"]) {
      const body = serverFn(name);
      expect(body, name).toContain(".middleware([requireSupabaseAuth])");
      expect(body, name).toContain(".validator(");
      expect(body, name).toContain("await siteWriteAccess(context)");
    }
    expect(fn).toMatch(/canAccess\(p, "customers"\) \|\| canAccess\(p, "service"\)/);
    expect(fn).toContain("isFieldOnly(p)");
    expect(fn).not.toMatch(/supabaseAdmin|client\.server|SUPABASE_SERVICE/);
  });
  it("stores in the documents bucket at sites/<site>/<uuid>.<ext> by the sniffed type, caps 4 MB, writes the row, removes the old file; the link is signed an hour", () => {
    const set = serverFn("setSiteCoverPhoto");
    expect(set).toContain("sniffImageType(bytes)");
    expect(set).toContain("bytes.length > MAX_SITE_COVER_BYTES");
    expect(set).toContain("siteCoverPath(site.id, randomUUID(), type)");
    expect(set).toContain(".from(DOCUMENTS_BUCKET)\n      .upload(path, bytes");
    expect(set).toContain(".update({ cover_photo_path: path })");
    expect(set).toContain("await removeFile(sb, site.cover_photo_path);");
    const clear = serverFn("clearSiteCoverPhoto");
    expect(clear).toContain(".update({ cover_photo_path: null })");
    expect(clear).toContain("await removeFile(sb, site.cover_photo_path);");
    expect(serverFn("siteCoverUrl")).toContain(
      ".createSignedUrl(site.cover_photo_path, SIGNED_SECONDS)",
    );
    expect(fn).toContain("const SIGNED_SECONDS = 3600;");
    // A path that is not a cover path is never removed or signed.
    expect(fn).toContain("if (!path || !isSiteCoverPath(path)) return;");
  });
});

describe("the property card's cover photo (property-sites.tsx SiteCoverPhoto)", () => {
  const card = read("src/components/crm/property-sites.tsx");
  it("shrinks on the client, refuses over 4 MB, sends base64, offers Set cover photo / Replace / Remove to the property's editors", () => {
    expect(card).toContain("export function SiteCoverPhoto(");
    expect(card).toContain("const shrunk = await shrinkPhoto(file);");
    expect(card).toContain("shrunk.blob.size > MAX_SITE_COVER_BYTES");
    expect(card).toContain("bytesBase64: await fileBase64(shrunk.blob)");
    expect(card).toContain("{coverButtonLabel(has)}");
    expect(card).toMatch(/<Trash2 className="mr-1 h-4 w-4" \/> Remove/);
    expect(card).toContain("if (!has && !canEdit) return null;");
    expect(card).toContain('accept="image/*"');
  });
  it("is mounted on the customer page's property cards and the property's own page, editors only", () => {
    const customers = read("src/components/customers-page.tsx");
    const property = read("src/components/property-page.tsx");
    expect(customers).toContain(
      "<SiteCoverPhoto siteId={s.id} path={s.cover_photo_path} canEdit={!readOnly} />",
    );
    expect(property).toContain(
      "<SiteCoverPhoto siteId={s.id} path={s.cover_photo_path} canEdit={!deleted} />",
    );
  });
  it("the documents editor offers the Property photo when the record's property has a cover, and the renderer reads the row's path", () => {
    const picker = read("src/components/documents/editor/photo-picker.tsx");
    expect(picker).toContain("Property photo");
    expect(picker).toContain('props.onPick({ kind: "siteCover", siteId: siteCover })');
    expect(picker).toContain("src = env.siteCoverUrl ?? null;");
    const route = read("src/routes/documents.tsx");
    expect(route).toContain("siteId={bundle.siteId}");
    expect(route).toContain("siteCoverUrl={bundle.siteCoverUrl}");
    const fns = read("src/lib/documents.functions.ts");
    expect(fns).toContain("siteId: site.id,\n      siteCoverUrl: site.coverUrl,");
    expect(fns).toContain('{ kind: "siteCover", siteId: loaded.siteId }');
    expect(fns).toContain("pagesForNewDocument(templatePages, data.options, cover)");
    const pdf = read("src/lib/documents/document-pdf.server.ts");
    expect(pdf).toContain('.from("crm_sites")\n      .select("id, cover_photo_path")');
    expect(pdf).toContain("const path = coverPaths.get(ref.siteId);");
  });
});
