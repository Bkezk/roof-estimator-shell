/**
 * Pictures added from the office ticket page (owner, Oct 26: "for service can you make it to
 * where pictures can be added to the ticket via the ticket menu on the service page, not just in
 * the service ticket workflow"). The upload plan is pure (field-utils.ts); the fold's behaviour
 * is pinned to its source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  dragHasFiles,
  imageFiles,
  photoExtension,
  uploadPlan,
  uploadingLabel,
} from "./field-utils";

const JOB = "0f4a3b1e-7c2d-4e5f-9a8b-1c2d3e4f5a6b";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("uploadPlan", () => {
  const shrunk = [
    { type: "image/jpeg", name: "IMG_0001.jpg", blob: new Blob(["a"]) },
    { type: "image/png", name: "screen.png", blob: new Blob(["b"]) },
    { type: "image/jpeg", name: "roof.heic", blob: new Blob(["c"]) }, // shrunk to JPEG
  ];
  it("puts every picture under the ticket's own folder as <uuid>.<ext>, in the order picked", () => {
    const ids = ["u1", "u2", "u3"];
    const plan = uploadPlan(shrunk, JOB, () => ids.shift()!);
    expect(plan.map((p) => p.path)).toEqual([`${JOB}/u1.jpg`, `${JOB}/u2.png`, `${JOB}/u3.jpg`]);
    expect(plan.map((p) => p.file)).toEqual(shrunk);
    for (const p of plan) expect(p.path.startsWith(`${JOB}/`)).toBe(true); // registerJobPhoto's rule
  });
  it("takes the extension from the shrunk type, not the original file's name", () => {
    const [heic] = uploadPlan([shrunk[2]!], JOB, () => "x");
    expect(heic!.path).toBe(`${JOB}/x.jpg`);
  });
  it("names each object with a fresh UUID by default (crypto.randomUUID)", () => {
    const plan = uploadPlan(shrunk, JOB);
    const names = plan.map((p) => p.path.slice(JOB.length + 1).replace(/\.\w+$/, ""));
    for (const n of names) expect(n).toMatch(UUID_RE);
    expect(new Set(names).size).toBe(names.length);
  });
  it("keeps an empty pick empty", () => {
    expect(uploadPlan([], JOB)).toEqual([]);
  });
});

describe("photoExtension", () => {
  it("maps the browser's image types", () => {
    expect(photoExtension("image/jpeg")).toBe("jpg");
    expect(photoExtension("image/png")).toBe("png");
    expect(photoExtension("image/webp")).toBe("webp");
    expect(photoExtension("image/heic")).toBe("heic");
    expect(photoExtension("IMAGE/JPEG; charset=binary")).toBe("jpg");
  });
  it("falls back to the file name's extension, then jpg", () => {
    expect(photoExtension("", "photo.HEIC")).toBe("heic");
    expect(photoExtension("application/octet-stream", "photo.tif")).toBe("tif");
    expect(photoExtension("", "noext")).toBe("jpg");
    expect(photoExtension("", ".hidden")).toBe("jpg");
    expect(photoExtension("", "weird.j p?g")).toBe("jpg");
  });
});

describe("uploadingLabel", () => {
  it('reads "Uploading 2 of 5…" while the second file goes up', () => {
    expect(uploadingLabel(0, 5)).toBe("Uploading 1 of 5…");
    expect(uploadingLabel(1, 5)).toBe("Uploading 2 of 5…");
    expect(uploadingLabel(4, 5)).toBe("Uploading 5 of 5…");
  });
  it("never counts past the total", () => {
    expect(uploadingLabel(5, 5)).toBe("Uploading 5 of 5…");
  });
});

describe("dragHasFiles", () => {
  it("is true only for a drag that carries files", () => {
    expect(dragHasFiles({ types: ["Files"] })).toBe(true);
    expect(dragHasFiles({ types: ["text/uri-list", "Files"] })).toBe(true);
    // A photo thumb dragged out to the desktop (DownloadURL) passes over the fold too.
    expect(dragHasFiles({ types: ["DownloadURL", "text/uri-list"] })).toBe(false);
    expect(dragHasFiles({ types: [] })).toBe(false);
    expect(dragHasFiles(null)).toBe(false);
  });
});

describe("imageFiles", () => {
  it("keeps pictures (by type, or HEIC by name) and drops the rest", () => {
    const jpg = new File(["a"], "a.jpg", { type: "image/jpeg" });
    const heic = new File(["b"], "b.HEIC", { type: "" });
    const pdf = new File(["c"], "c.pdf", { type: "application/pdf" });
    expect(imageFiles([jpg, heic, pdf])).toEqual([jpg, heic]);
    expect(imageFiles(null)).toEqual([]);
  });
});

describe("the ticket page's Photos & repairs fold (ticket-field-sections.tsx)", () => {
  const src = readFileSync("src/components/service/ticket-field-sections.tsx", "utf8");
  const fold = src.slice(
    src.indexOf("function RepairsReadOnly"),
    src.indexOf("function CloseoutSummary"),
  );
  // The upload itself moved to ticket-picture-upload.ts on Oct 27 (the Inspection fold's rows
  // share it, with an item_key); the fold calls the hook with no item.
  const upload = readFileSync("src/components/service/ticket-picture-upload.ts", "utf8");

  it("offers Add pictures (ImagePlus) over a hidden multi-file image input, to the ticket's editors", () => {
    expect(fold).toContain("Add pictures");
    expect(fold).toMatch(/<ImagePlus\b/);
    expect(fold).toMatch(/type="file"/);
    expect(fold).toMatch(/accept="image\/\*"/);
    expect(fold).toMatch(/\bmultiple\b/);
    expect(fold).toMatch(/const addPictures = canEdit &&/);
    expect(src).toMatch(/^\s+ImagePlus,$/m); // imported from lucide-react
  });
  it("accepts pictures dropped onto the fold's photo area (files only)", () => {
    expect(fold).toContain("onDrop:");
    expect(fold).toContain("onDragOver:");
    expect(fold).toMatch(/dragHasFiles\(e\.dataTransfer\)/);
    expect(fold).toMatch(/pictures\.add\(e\.dataTransfer\.files\)/);
  });
  it("uploads with the field flow's path (shrinkPhoto → uploadPlan → the service bucket → registerJobPhoto as a loose 'other' photo)", () => {
    expect(fold).toMatch(/const pictures = useTicketPictureUpload\(jobId\);/); // no item_key
    expect(upload).toMatch(/await shrinkPhoto\(file\)/);
    expect(upload).toMatch(/uploadPlan\(\[shrunk\], jobId\)/);
    expect(upload).toMatch(/await uploadToServiceBucket\(path, shrunk\.blob, shrunk\.type\)/);
    expect(upload).toMatch(
      /data: jobPhotoRegistration\(\{ jobId, path, shrunk, file, itemKey \}\)/,
    );
    expect(upload).toMatch(
      /service_job_id: args\.jobId,\s+repair_id: null,\s+item_key: args\.itemKey \?\? null,\s+role: "other" as const,\s+storage_path: args\.path,/,
    );
    // A row that could not be recorded leaves no orphan in the bucket.
    expect(upload).toMatch(/await removeFromServiceBucket\(path\)/);
  });
  it("copies the picked files out before the input is cleared (a FileList is live)", () => {
    expect(fold).toMatch(/onChange=\{\(e\) => pictures\.add\(takePickedFiles\(e\.target\)\)\}/);
  });
  it("shows 'Uploading n of m…', names a failed file in a toast, and refreshes the photos when done", () => {
    expect(upload).toMatch(/uploadingLabel\(progress\.done, progress\.total\)/);
    expect(upload).toMatch(/loudError\(`\$\{file\.name \|\| "A picture"\} did not upload`, e\)/);
    expect(upload).toMatch(
      /onSettled: \(\) => \{[\s\S]*?invalidateQueries\(\{ queryKey: fieldKeys\.photos\(jobId\) \}\)/,
    );
  });
  it("no longer returns null for an editor with no repairs and no photos; a reader with nothing still gets nothing", () => {
    expect(fold).toMatch(
      /if \(!canEdit && !repairs\.error && !photos\.error && rows\.length === 0 && loose\.length === 0\)\s+return null;/,
    );
    expect(fold).toMatch(/if \(!canEdit && !repairs\.error && repairs\.isLoading\) return null;/);
    expect(fold).toContain("No pictures yet");
  });
  it('is titled "Photos & repairs" when it shows photos, and keeps its remembered fold (storageKey "repairs")', () => {
    expect(fold).toMatch(
      /const title = pics\.length > 0 \|\| canEdit \? "Photos & repairs" : "Repairs";/,
    );
    expect(fold).toMatch(/<Box title=\{title\} icon=\{Wrench\} collapsible storageKey="repairs"/);
  });
  it("lets the editor delete a picture through the thumb's own confirm (deleteJobPhoto), then refreshes", () => {
    expect(fold).toMatch(/useServerFn\(deleteJobPhoto\)/);
    expect(fold).toMatch(/onDelete=\{canEdit \? \(\) => delPhoto\.mutate\(p\.id\) : undefined\}/);
    expect(fold).toMatch(/deletePhotoFn\(\{ data: \{ id, service_job_id: jobId \} \}\)/);
  });
  it("is the fold the office ticket page renders with its canEdit", () => {
    const page = readFileSync("src/components/service-page.tsx", "utf8");
    expect(page).toMatch(
      /<TicketRepairs jobId=\{job\.id\} ticketNumber=\{job\.number\} canEdit=\{canEdit\} \/>/,
    );
  });
});

describe("the server keeps its guard (service-field.functions.ts)", () => {
  const src = readFileSync("src/lib/service-field.functions.ts", "utf8");
  const fn = (name: string) => {
    const start = src.indexOf(`export const ${name} = createServerFn`);
    return src.slice(start, src.indexOf("\n  });", start));
  };
  it("registerJobPhoto: the caller's own ticket (office: any), stored under the ticket's folder", () => {
    const body = fn("registerJobPhoto");
    expect(body).toMatch(/const job = await ownJob\(context, data\.service_job_id\);/);
    expect(body).toMatch(/if \(!data\.storage_path\.startsWith\(`\$\{job\.id\}\/`\)\)/);
  });
  it("deleteJobPhoto: the caller's own ticket, the row's own ticket", () => {
    const body = fn("deleteJobPhoto");
    expect(body).toMatch(/await ownJob\(context, data\.service_job_id\);/);
    expect(body).toMatch(/\.eq\("service_job_id", data\.service_job_id\)/);
  });
  it("ownJob lets the office touch any ticket and a technician only their own", () => {
    expect(src).toMatch(
      /if \(!isOffice\(p\) && job\.technician_id !== ctx\.userId\)\s+throw new Error\("This ticket is assigned to someone else"\);/,
    );
  });
});
