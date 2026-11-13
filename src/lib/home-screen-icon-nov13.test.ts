/**
 * The home-screen icon is the JBK logo (owner, Nov 13: "can we have the icon match the JBK
 * logo"): the whole logo on white, under new file names so a phone that fetched the old blue
 * icon does not keep showing it. iOS reads the apple-touch-icon link, Android the manifest (with
 * a maskable copy that keeps the logo inside the middle of the picture), and a push notice shows
 * the same picture.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Width, height and colour type from a PNG's IHDR (2 = RGB with no see-through pixels). */
function png(path: string) {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b.readUInt8(25) };
}

describe("the home-screen icon is the JBK logo", () => {
  it("the four pictures exist at their sizes, with a solid background (iOS paints see-through black)", () => {
    expect(png("public/jbk-icon-180.png")).toEqual({ width: 180, height: 180, colourType: 2 });
    expect(png("public/jbk-icon-192.png")).toEqual({ width: 192, height: 192, colourType: 2 });
    expect(png("public/jbk-icon-512.png")).toEqual({ width: 512, height: 512, colourType: 2 });
    expect(png("public/jbk-icon-maskable-512.png")).toEqual({
      width: 512,
      height: 512,
      colourType: 2,
    });
  });

  it("the old blue icons are gone", () => {
    for (const f of ["icon-180.png", "icon-192.png", "icon-512.png"])
      expect(existsSync(`public/${f}`)).toBe(false);
  });

  it("iOS is pointed at the new picture", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root).toContain('{ rel: "apple-touch-icon", href: "/jbk-icon-180.png" },');
    expect(root).not.toContain('"/icon-180.png"');
  });

  it("Android's manifest lists them, with one it may cut to a circle", () => {
    const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")) as {
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(m.icons.map((i) => `${i.src} ${i.sizes} ${i.purpose}`)).toEqual([
      "/jbk-icon-192.png 192x192 any",
      "/jbk-icon-512.png 512x512 any",
      "/jbk-icon-maskable-512.png 512x512 maskable",
    ]);
  });

  it("a push notice shows it too", () => {
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain('icon: "/jbk-icon-192.png",');
    expect(sw).not.toContain('"/icon-192.png"');
  });

  it("the browser tab's icon is one 256 px picture in an .ico, as before", () => {
    const b = readFileSync("public/favicon.ico");
    expect([b.readUInt16LE(0), b.readUInt16LE(2), b.readUInt16LE(4)]).toEqual([0, 1, 1]);
    expect(b.subarray(23, 26).toString("latin1")).toBe("PNG");
    expect([b.readUInt32BE(22 + 16), b.readUInt32BE(22 + 20)]).toEqual([256, 256]);
  });
});
