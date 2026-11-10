/**
 * How the browser's build groups its files (vite.config.ts reads this; Nov 10, the speed pass,
 * finding 3: "a full page load fetches 82 to 218 files; a third to a half are icon files under
 * 1 KB").
 *
 * Left alone, the bundler gives every module that two pages share a file of its own. An icon is
 * 150 to 400 bytes, so the sign-in page asked for 28 files under 1 KB and the Service page 74.
 * Each group below names modules that travel together:
 *
 *  - `icons`: every lucide-react icon the pages use, in one file. A page pays for the icons of
 *    the other pages too, but all of them together are smaller than one photo thumbnail, and
 *    the file is fetched once and kept (hashed name, a year's cache).
 *  - `vendor` and `shell`: what every page needs before it can draw anything — the modules the
 *    first screen imports directly (the bundler's `$initial` tag: the entry and everything it
 *    statically imports). No page loads a byte more than it did; the same code arrives in two
 *    files instead of fifty. They are two on purpose: `vendor` is the libraries (React, the
 *    router, the database client…), which change only when a library is updated, so a browser
 *    keeps that file across our own releases; `shell` is our own code, which changes with them.
 *
 * What is NOT grouped, on purpose: the heavy libraries (the PDF reader, the Excel and Word
 * libraries, the map, the charts) stay in files of their own, fetched only by the pages that
 * use them. A group may only take what every page already needs (`$initial`), or tiny things
 * (the icons). The test (build-chunks-nov10b.test.ts) holds each group to that.
 *
 * Plain data, no imports: the config file loads this before the build exists.
 */
export interface ChunkGroup {
  name: string;
  /** Module ids (absolute paths) the group takes; absent = any module (the tags decide). */
  test?: RegExp;
  /** Only modules with all of these tags ("$initial": statically imported by the entry). */
  tags?: "$initial"[];
  priority?: number;
}

/** `[\\/]` so the same pattern holds on Windows paths. */
export const ICONS_TEST = /node_modules[\\/]lucide-react[\\/]/;
/**
 * Every library except two:
 *  - the Start framework's own packages: its browser entry lives in node_modules and imports our
 *    router, so a group that took it would take the whole of our own code with it (a group
 *    brings what its modules import) and nothing would be left for `shell`;
 *  - the icons, which have their own group.
 */
export const VENDOR_TEST = /[\\/]node_modules[\\/](?!@tanstack[\\/][a-z-]*start|lucide-react[\\/])/;

/**
 * Highest priority first. `vendor` goes before `icons` so React lands with the libraries: a
 * group brings what its modules import, and the icons import React.
 */
export const CLIENT_CHUNK_GROUPS: ChunkGroup[] = [
  { name: "vendor", test: VENDOR_TEST, tags: ["$initial"], priority: 30 },
  { name: "icons", test: ICONS_TEST, priority: 20 },
  { name: "shell", tags: ["$initial"], priority: 10 },
];

/** Libraries no group may ever pull into the first screen (each belongs to the pages that use it). */
export const HEAVY_LIBRARIES = [
  "pdfjs-dist",
  "pdf-lib",
  "xlsx",
  "mammoth",
  "docx",
  "maplibre-gl",
  "recharts",
  "jszip",
] as const;
