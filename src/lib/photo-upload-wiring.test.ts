/**
 * The one picture queue, as the screens wire it (owner, Oct 28; the core is tested in
 * photo-upload-queue.test.ts). Pinned to the sources:
 *
 *   1. shrinkPhoto is UNCHANGED: 2048 px, JPEG 0.85 (the owner refused smaller pictures).
 *   2. Every path feeds the one queue: the close-out's Before / After camera, the inspection
 *      camera, a checklist row's Add pictures, the office's Photos & repairs fold; none runs its
 *      own upload mutation any more.
 *   3. The technician keeps working: no camera button is disabled while a picture goes up; a
 *      "3 uploading" badge, placeholders in the strips, and "N pictures waiting for signal" where
 *      pictures are added and on My tickets (banner and card).
 *   4. No signal: the portal binding keeps pictures in IndexedDB (lib/picture-store.ts, no new
 *      dependency), restores on start, resumes on `online` / focus / the next pick, and warns
 *      loudly when the phone's storage is blocked. No jargon anywhere the technician reads.
 *   5. Mark up as you shoot: the camera inputs have `capture`; the editor opens only when
 *      shouldMarkUpAfterShot says so (the phone's camera, never a computer, never the camera
 *      roll); "Take another <role>" sits in the editor; the thin wrapper (the web's Add pictures)
 *      never opens it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
/** The source without its comments (a doc comment may name what the code must not call). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const fieldUtils = read("src/components/service/field-utils.ts");
const queue = read("src/components/service/picture-queue.ts");
const core = read("src/lib/photo-upload-queue.ts");
const store = read("src/lib/picture-store.ts");
const ui = read("src/components/service/picture-queue-ui.tsx");
const closeout = read("src/components/service/closeout.tsx");
const inspCamera = read("src/components/service/inspection-camera.ts");
const inspCards = read("src/components/service/inspection-closeout.tsx");
const fold = read("src/components/service/ticket-field-sections.tsx");
const itemPhotos = read("src/components/service/inspection-item-photos.tsx");
const wrapper = read("src/components/service/ticket-picture-upload.ts");
const today = read("src/components/service/today-page.tsx");
const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };

describe("1. the picture quality is unchanged", () => {
  it("shrinkPhoto still shrinks to 2048 px, JPEG 0.85, and the queue calls exactly it", () => {
    const shrink = fieldUtils.slice(
      fieldUtils.indexOf("export async function shrinkPhoto("),
      fieldUtils.indexOf("/** Today as YYYY-MM-DD"),
    );
    expect(shrink).toContain("const scale = Math.min(1, 2048 / Math.max(img.width, img.height));");
    expect(shrink).toContain('canvas.toBlob(r, "image/jpeg", 0.85)');
    expect(shrink).toContain(
      'if (file.size < 1_500_000 || typeof createImageBitmap === "undefined") return keep;',
    );
    expect(queue).toContain("shrink: shrinkPhoto,");
    expect(core).toContain("this.shrinkAtOnce = deps.shrinkAtOnce ?? 2;");
    expect(core).toContain("this.uploadAtOnce = deps.uploadAtOnce ?? 3;");
  });
});

describe("2. every path feeds the one queue", () => {
  it("the close-out's Before / After camera", () => {
    const camera = closeout.slice(
      closeout.indexOf("function useRepairCamera("),
      closeout.indexOf("return { inputs, controls: photoControls };"),
    );
    expect(camera).toContain("const pictures = usePictures({ jobId });");
    expect(camera).toContain(
      "pictures.add(files, { jobId, repairId, itemKey: null, role }, { fromCamera });",
    );
    expect(camera).toContain("const files = takePickedFiles(input);");
    expect(code(camera)).not.toMatch(/useMutation|shrinkPhoto|uploadToServiceBucket|registerFn/);
    expect(closeout).not.toContain("photoObjectPath");
  });
  it("the inspection camera (item or roll)", () => {
    expect(inspCamera).toContain(
      'const pictures = usePictures({ jobId, repairId: null, role: "other" });',
    );
    expect(inspCamera).toMatch(
      /pictures\.add\(\s*files,\s*\{ jobId, repairId: null, itemKey, role: "other" \},\s*\{ fromCamera \},?\s*\)/,
    );
    expect(code(inspCamera)).not.toMatch(
      /useMutation|shrinkPhoto|uploadToServiceBucket|registerJobPhoto/,
    );
  });
  it("the web's Add pictures (the fold and a checklist row) through the thin wrapper", () => {
    expect(wrapper).toMatch(/usePictures\(\{ jobId, repairId: null, itemKey, role: "other" \}\)/);
    expect(fold).toContain("const pictures = useTicketPictureUpload(jobId);");
    expect(itemPhotos).toContain("const upload = useTicketPictureUpload(jobId, { itemKey });");
  });
  it("one instance per tab, bound to the query cache: a registered row lands in the ticket's list and the events refresh", () => {
    expect(queue).toContain("let instance: PhotoUploadQueue<JobPhotoRow> | null = null;");
    expect(queue).toMatch(
      /onRegistered: \(entry: QueuedPicture, row: JobPhotoRow\) => \{[\s\S]*?qc\.setQueryData<JobPhotoRow\[\]>\(fieldKeys\.photos\(row\.service_job_id\)/,
    );
    expect(queue).toMatch(
      /invalidateQueries\(\{ queryKey: fieldKeys\.events\(row\.service_job_id\) \}\)/,
    );
  });
});

describe("3. the technician keeps working", () => {
  it("no camera / Add pictures button is disabled for an upload; the badge, the line and the placeholders show the queue", () => {
    const buttons = closeout.slice(
      closeout.indexOf("function PhotoButtons("),
      closeout.indexOf("function RepairRow("),
    );
    expect(buttons).not.toMatch(/disabled=/);
    expect(buttons).toContain("<UploadBadge n={uploading} />");
    expect(buttons).toContain("<WaitingForSignalLine n={waiting} />");
    const card = closeout.slice(
      closeout.indexOf("function RepairCard("),
      closeout.indexOf("// (f) Signature"),
    );
    expect(card).toMatch(
      /<PendingThumbs entries=\{pending\} onRetry=\{camera\.onRetry\} onDiscard=\{camera\.onDiscard\} \/>/,
    );
    const roll = inspCards.slice(
      inspCards.indexOf("function PhotoRoll("),
      inspCards.indexOf("// Step 2 · Checklist"),
    );
    expect(roll).not.toMatch(/disabled=\{camera\.uploading\}/);
    expect(roll).toContain("<UploadBadge n={camera.uploading} />");
    expect(roll).toContain("<WaitingForSignalLine n={camera.waitingForSignal} />");
    expect(roll).toContain("entries={camera.pending}");
    expect(fold).not.toMatch(/disabled=\{pictures\.uploading/);
    expect(fold).toContain("<UploadBadge n={pictures.uploading} />");
  });
  it("My tickets: the banner and every card say what is going up and what waits for signal", () => {
    const banner = today.slice(
      today.indexOf("function ClockBanner("),
      today.indexOf("function Group("),
    );
    const card = today.slice(today.indexOf("function JobCard("));
    for (const s of [banner, card]) {
      expect(s).toMatch(/usePictures\(\{ jobId: (clock\.service_job_id|j\.id) \}\)/);
      expect(s).toContain("<UploadBadge n={pictures.uploading} />");
      expect(s).toContain("<WaitingForSignalLine n={pictures.waitingForSignal} />");
    }
  });
  it("a placeholder is grey with a spinner; held shows an hourglass; failed is red with Retry and Discard", () => {
    const thumb = ui.slice(
      ui.indexOf("function PendingThumb("),
      ui.indexOf("export function PendingThumbs("),
    );
    expect(thumb).toMatch(/bg-muted\/60 \$\{\s*failed \? "border-destructive" : "opacity-70"/);
    expect(thumb).toMatch(/<Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/);
    expect(thumb).toMatch(/<Hourglass className="h-5 w-5 text-amber-700 dark:text-amber-400"/);
    expect(thumb).toMatch(/aria-label=\{`Retry \$\{entry\.fileName \|\| "this picture"\}`\}/);
    expect(thumb).toMatch(/aria-label=\{`Discard \$\{entry\.fileName \|\| "this picture"\}`\}/);
  });
});

describe("4. no signal", () => {
  it("the phone keeps pictures in IndexedDB with no new dependency; memory with a loud note when storage is blocked", () => {
    for (const dep of ["idb", "dexie", "localforage", "idb-keyval"])
      expect(pkg.dependencies[dep]).toBeUndefined();
    expect(store).toContain('export const PICTURE_DB = "jbk-pictures";');
    expect(store).toMatch(/factory\.open\(PICTURE_DB, VERSION\)/);
    expect(store).toMatch(/return \{ store: memoryPictureStore\(\), fallback: true, error: e \};/);
    expect(queue).toMatch(/if \(o\.fallback && typeof window !== "undefined"\)\s*toast\.error\(/);
    expect(queue).toMatch(/onStoreError: \(e: unknown\) => \{\s*toast\.error\(/);
  });
  it("restores on start and resumes on `online`, on focus / coming to the front, on a slow timer, and on the next pick", () => {
    expect(queue).toContain("return queue.restore();");
    expect(queue).toContain('window.addEventListener("online", resume);');
    expect(queue).toContain('window.addEventListener("focus", resume);');
    expect(queue).toMatch(
      /document\.addEventListener\("visibilitychange", \(\) => \{\s*if \(document\.visibilityState === "visible"\) resume\(\);/,
    );
    expect(queue).toMatch(
      /window\.setInterval\(\(\) => \{\s*if \(queue\.snapshot\(\)\.some\(\(e\) => e\.status === "held"\)\) resume\(\);/,
    );
    // The core: a pick resumes what was held; the shrunk picture is what is stored.
    expect(core).toMatch(/add\([\s\S]*?this\.resume\(false\);/);
    expect(core).toMatch(/picture: w\.picture,/);
  });
  it("never says offline, network or sync where the technician reads", () => {
    const words = /\b(offline|network|sync(ing|ed)?)\b/i;
    // Strings the screens show (JSX text and quoted toasts); comments and code names are not read by anyone on a roof.
    const shown = (src: string) =>
      src
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .filter((l) =>
          /toast\.|>[^<{]*[A-Za-z]{3,}[^<{]*<|"[^"]*\b(picture|photo)s?\b[^"]*"/i.test(l),
        )
        .join("\n");
    for (const src of [ui, queue, closeout, inspCards, fold, itemPhotos, today, wrapper])
      expect(shown(src)).not.toMatch(words);
    expect(core).toMatch(/waiting for signal/);
  });
});

describe("5. mark up as you shoot — the phone's camera only", () => {
  it("the close-out and inspection camera inputs have capture and ask shouldMarkUpAfterShot with the input's capture and the device's pointer", () => {
    expect(closeout.match(/capture="environment"/g)).toHaveLength(2);
    expect(inspCamera).toContain('capture: "environment",');
    for (const s of [closeout, inspCamera])
      expect(s).toMatch(
        /shouldMarkUpAfterShot\(\{\s*capture: input\.getAttribute\("capture"\),\s*coarsePointer: coarsePointer\(\),\s*\}\)/,
      );
    // One shot at a time opens the editor; a multi-pick never does.
    expect(closeout).toMatch(/if \(fromCamera && files\.length === 1 && first && id\)/);
    expect(inspCamera).toMatch(/if \(fromCamera && files\.length === 1 && first && id\)/);
  });
  it("the web's Add pictures (no capture) never opens the editor; the pointer helper is false on a computer", () => {
    expect(code(wrapper)).not.toMatch(/AfterShotEditor|shouldMarkUpAfterShot/);
    expect(code(itemPhotos)).not.toMatch(/\bcapture\b/);
    expect(fieldUtils).toMatch(/window\.matchMedia\("\(pointer: coarse\)"\)\.matches/);
  });
  it("the editor offers Take another <role>, Skip and Done; Done / Take another hand the marks to the queue for the row", () => {
    expect(ui).toContain("Take another {shot.label}");
    expect(ui).toMatch(/onClick=\{\(\) => finish\(true, onTakeAnother\)\}/);
    expect(ui).toMatch(/onClick=\{\(\) => finish\(false\)\}[\s\S]*?Skip/);
    expect(ui).toMatch(/void attachMarks\(shot\.id, marks\)/);
    expect(closeout).toMatch(/onTakeAnother=\{\(\) => takePhoto\(shot\.repairId, shot\.role\)\}/);
    expect(closeout).toContain("attachMarks={pictures.attachMarks}");
    expect(inspCamera).toContain("onTakeAnother: () => open(shot.itemKey, shot.label),");
    expect(inspCamera).toContain("attachMarks: pictures.attachMarks,");
    // The queue saves them onto the row through savePhotoAnnotations and refreshes the list.
    expect(queue).toMatch(
      /saveMarks: async \(row, marks\) => \{[\s\S]*?savePhotoAnnotations\(\{\s*data: \{ id: row\.id, service_job_id: row\.service_job_id, annotations: marks \}/,
    );
  });
});
