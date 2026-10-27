/**
 * Pictures added to a checklist item from the web (owner, Oct 27: "can pictures be added to
 * inspections from the web view like the leaks"). The registration payload is pure
 * (jobPhotoRegistration): with an item key it lands on the item; without, loose on the ticket as
 * before. The picked files are copied out of the input before it is cleared (takePickedFiles),
 * and the Inspection row's button is pinned to its source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { takePickedFiles } from "./field-utils";
import { jobPhotoRegistration } from "./ticket-picture-upload";

const JOB = "0f4a3b1e-7c2d-4e5f-9a8b-1c2d3e4f5a6b";
const shrunk = { name: "IMG_0001.jpg", blob: { size: 1234 } };
const file = { name: "IMG_0001.HEIC", lastModified: Date.UTC(2026, 9, 27, 15, 4, 5) };

describe("jobPhotoRegistration", () => {
  it("registers a picture on the checklist item when an item key is given", () => {
    const data = jobPhotoRegistration({
      jobId: JOB,
      path: `${JOB}/u1.jpg`,
      shrunk,
      file,
      itemKey: "flashing",
    });
    expect(data).toEqual({
      service_job_id: JOB,
      repair_id: null,
      item_key: "flashing",
      role: "other",
      storage_path: `${JOB}/u1.jpg`,
      file_name: "IMG_0001.jpg",
      file_size: 1234,
      taken_at: "2026-10-27T15:04:05.000Z",
    });
  });
  it("registers a loose ticket photo (item_key null) when no item is given — the Photos fold", () => {
    expect(jobPhotoRegistration({ jobId: JOB, path: `${JOB}/u2.jpg`, shrunk, file }).item_key).toBe(
      null,
    );
    expect(
      jobPhotoRegistration({ jobId: JOB, path: `${JOB}/u2.jpg`, shrunk, file, itemKey: null })
        .item_key,
    ).toBe(null);
  });
  it("is always an 'other' photo on no repair (setJobPhotoItem's rule for a photo on an item)", () => {
    const data = jobPhotoRegistration({
      jobId: JOB,
      path: `${JOB}/u3.jpg`,
      shrunk,
      file,
      itemKey: "seams",
    });
    expect(data.role).toBe("other");
    expect(data.repair_id).toBe(null);
  });
  it("names the row after the shrunk file, then the picked one; taken now when the file has no date", () => {
    expect(
      jobPhotoRegistration({
        jobId: JOB,
        path: `${JOB}/u4.jpg`,
        shrunk: { name: "", blob: { size: 1 } },
        file: { name: "roof.png", lastModified: 0 },
        now: () => Date.UTC(2026, 9, 27, 12, 0, 0),
      }),
    ).toMatchObject({ file_name: "roof.png", taken_at: "2026-10-27T12:00:00.000Z" });
    expect(
      jobPhotoRegistration({
        jobId: JOB,
        path: `${JOB}/u5.jpg`,
        shrunk: { name: "", blob: { size: 1 } },
        file: { name: "", lastModified: 0 },
        now: () => 0,
      }).file_name,
    ).toBe(null);
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
    expect(button).toMatch(/\{upload\.progressText\}/);
  });
  it("sits beside From ticket photos on every flagged row an editor sees", () => {
    const tools = src.slice(src.indexOf("export function ItemPhotoTools"));
    expect(tools).toMatch(
      /props\.canEdit && \([\s\S]*<AddItemPicturesButton[\s\S]*<FromTicketPhotosButton/,
    );
  });
});
