/**
 * Pictures added to a checklist item from the web (owner, Oct 27: "can pictures be added to
 * inspections from the web view like the leaks"). Since Oct 28 the hook is a thin wrapper over
 * the portal's one picture queue (picture-queue.ts; the core lib/photo-upload-queue.ts, whose
 * registration payload — item_key on the item, null loose — is tested there): pinned here are
 * the wrapper's shape, takePickedFiles (the files are copied out of the input before it is
 * cleared) and the Inspection row's button.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pictureRegistration } from "@/lib/photo-upload-queue";
import { takePickedFiles } from "./field-utils";

const JOB = "0f4a3b1e-7c2d-4e5f-9a8b-1c2d3e4f5a6b";
const picture = { blob: new Blob(["abc"]), type: "image/jpeg", name: "IMG_0001.jpg" };

describe("the registration of a web-added picture (the queue's pictureRegistration)", () => {
  it("lands on the checklist item when an item key is given", () => {
    const data = pictureRegistration(
      {
        target: { jobId: JOB, repairId: null, itemKey: "flashing", role: "other" },
        fileName: "IMG_0001.HEIC",
        takenAt: "2026-10-27T15:04:05.000Z",
        picture,
        where: null,
      },
      `${JOB}/u1.jpg`,
    );
    expect(data).toEqual({
      service_job_id: JOB,
      repair_id: null,
      item_key: "flashing",
      role: "other",
      storage_path: `${JOB}/u1.jpg`,
      file_name: "IMG_0001.jpg",
      file_size: 3,
      taken_at: "2026-10-27T15:04:05.000Z",
      lat: null,
      lng: null,
    });
  });
  it("is loose on the ticket (item_key null) with no item — the Photos fold", () => {
    const data = pictureRegistration(
      {
        target: { jobId: JOB, repairId: null, itemKey: null, role: "other" },
        fileName: "a.jpg",
        takenAt: "2026-10-27T15:04:05.000Z",
        picture,
        where: null,
      },
      `${JOB}/u2.jpg`,
    );
    expect(data.item_key).toBe(null);
    expect(data.role).toBe("other");
    expect(data.repair_id).toBe(null);
  });
  it("names the row after the shrunk file, then the picked one; null when neither has a name", () => {
    const base = {
      target: { jobId: JOB, repairId: null, itemKey: null, role: "other" as const },
      takenAt: "2026-10-27T12:00:00.000Z",
      where: null,
    };
    expect(
      pictureRegistration(
        { ...base, fileName: "roof.png", picture: { ...picture, name: "" } },
        `${JOB}/u4.jpg`,
      ).file_name,
    ).toBe("roof.png");
    expect(
      pictureRegistration(
        { ...base, fileName: "", picture: { ...picture, name: "" } },
        `${JOB}/u5.jpg`,
      ).file_name,
    ).toBe(null);
  });
});

describe("the wrapper (ticket-picture-upload.ts)", () => {
  const src = readFileSync("src/components/service/ticket-picture-upload.ts", "utf8");
  it("feeds the one queue as an 'other' photo on no repair, on the item when given", () => {
    expect(src).toMatch(/usePictures\(\{ jobId, repairId: null, itemKey, role: "other" \}\)/);
    expect(src).toMatch(
      /pictures\.add\(list, \{ jobId, repairId: null, itemKey, role: "other" \}\)/,
    );
    expect(src).toMatch(/const itemKey = opts\.itemKey \?\? null;/);
  });
  it("keeps only image files and says so loudly when none was picked; it never shrinks or uploads itself", () => {
    expect(src).toMatch(/imageFiles\(picked\)/);
    expect(src).toContain('toast.error("Pick picture files (JPG, PNG, HEIC…)")');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/shrinkPhoto|uploadToServiceBucket|registerJobPhoto|useMutation/);
  });
  it("has no blocking 'Uploading n of m…' line any more; the counts come from the queue", () => {
    expect(src).not.toContain("uploadingLabel");
    expect(src).toMatch(/uploadingAny: pictures\.uploading > 0/);
  });
});

describe("takePickedFiles (field-utils)", () => {
  /** A file input as the browser has it: `files` is live and empties when `value` is cleared. */
  function liveInput(picked: File[]) {
    const input = {
      value: "C:\\fakepath\\a.jpg",
      get files(): File[] | null {
        return this.value === "" ? [] : picked;
      },
    };
    return input;
  }
  it("copies the files out BEFORE clearing the input", () => {
    const a = new File(["a"], "a.jpg", { type: "image/jpeg" });
    const b = new File(["b"], "b.png", { type: "image/png" });
    const input = liveInput([a, b]);
    const files = takePickedFiles(input);
    expect(files).toEqual([a, b]);
    expect(input.value).toBe("");
    expect(input.files).toEqual([]); // the live list is empty now; the copy is not
  });
  it("is an empty list for no pick", () => {
    expect(takePickedFiles({ files: null, value: "" })).toEqual([]);
  });
});

describe("the Inspection fold's row (inspection-item-photos.tsx)", () => {
  const src = readFileSync("src/components/service/inspection-item-photos.tsx", "utf8");
  const button = src.slice(
    src.indexOf("export function AddItemPicturesButton"),
    src.indexOf("export function ItemPhotoTools"),
  );
  it("offers Add pictures over a hidden multi-file image input with no capture (camera or camera roll)", () => {
    expect(button).toContain("Add pictures");
    expect(button).toMatch(/<ImagePlus\b/);
    expect(button).toMatch(/type="file"/);
    expect(button).toMatch(/accept="image\/\*"/);
    expect(button).toMatch(/\bmultiple\b/);
    expect(button).not.toMatch(/\bcapture\b/);
  });
  it("uploads through the ticket pipeline with the row's item key, copying the files out first", () => {
    expect(button).toMatch(/useTicketPictureUpload\(jobId, \{ itemKey \}\)/);
    expect(button).toMatch(/onChange=\{\(e\) => upload\.add\(takePickedFiles\(e\.target\)\)\}/);
  });
  it("never blocks the next pick: the button is not disabled; a badge, the waiting line and placeholders show the queue", () => {
    expect(button).not.toMatch(/disabled=/);
    expect(button).toMatch(/<UploadBadge n=\{upload\.uploading\} \/>/);
    expect(button).toMatch(/<WaitingForSignalLine n=\{upload\.waitingForSignal\}/);
    expect(button).toMatch(/<PendingThumbs\s+entries=\{upload\.entries\}/);
    expect(button).not.toContain("progressText");
  });
  it("sits beside From ticket photos on every flagged row an editor sees", () => {
    const tools = src.slice(src.indexOf("export function ItemPhotoTools"));
    expect(tools).toMatch(
      /props\.canEdit && \([\s\S]*<AddItemPicturesButton[\s\S]*<FromTicketPhotosButton/,
    );
  });
});
