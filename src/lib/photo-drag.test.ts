/**
 * Dragging a ticket photo onto the desktop saves it (owner, Oct 7).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { photoDragData, setPhotoDrag } from "./photo-drag";

describe("photoDragData", () => {
  it("names the file as Download does and carries the browser's DownloadURL item", () => {
    const d = photoDragData("https://x/signed.jpg?t=1", 6008, "before", 2, "jobs/a/b.jpeg");
    expect(d.fileName).toBe("6008-before-2.jpg");
    expect(d.mime).toBe("image/jpeg");
    expect(d.downloadUrl).toBe("image/jpeg:6008-before-2.jpg:https://x/signed.jpg?t=1");
    expect(photoDragData("u", "6008", "after", 1, "p.PNG").mime).toBe("image/png");
    expect(photoDragData("u", null, "other", 3, "p.heic").fileName).toBe("ticket-other-3.heic");
  });
  it("setPhotoDrag puts the DownloadURL, the URL and a copy effect on the drag", () => {
    const set: Array<[string, string]> = [];
    const dt = {
      setData: (k: string, v: string) => void set.push([k, v]),
      effectAllowed: "none",
    } as unknown as DataTransfer;
    setPhotoDrag(dt, photoDragData("https://x/p.jpg", 1, "before", 1, "p.jpg"), "https://x/p.jpg");
    expect(set).toEqual([
      ["DownloadURL", "image/jpeg:1-before-1.jpg:https://x/p.jpg"],
      ["text/uri-list", "https://x/p.jpg"],
      ["text/plain", "https://x/p.jpg"],
    ]);
    expect(dt.effectAllowed).toBe("copy");
  });
});

describe("the wiring", () => {
  it("every photo thumbnail is draggable with the photo's download data", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../components/service/field-shared.tsx", import.meta.url)),
      "utf8",
    );
    expect(src).toContain("draggable={!!url.data}");
    expect(src).toContain("setPhotoDrag(");
    expect(src).toContain(
      "photoDragData(url.data, ticketNumber, photo.role, n, photo.storage_path)",
    );
    expect(src).toContain("drag it to your desktop to save it");
  });
});
