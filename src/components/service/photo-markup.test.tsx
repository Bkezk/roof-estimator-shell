/**
 * RotatedPhoto (owner, Oct 28: "allow rotation of photos on markup"), rendered to a string
 * (react-dom/server): the one piece every thumbnail, the lightbox and the document canvas use to
 * show a ticket photo turned the way it is kept, its marks over it. Not turned, it is the <img>
 * with the marks overlay as before; turned, an SVG whose viewBox is the turned box with the
 * picture and the marks in one group carrying the rotation transform.
 */
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { PhotoMark } from "@/lib/photo-annotations";

import { MarkShapes, PhotoMarkupSurface, RotatedPhoto } from "./photo-markup";

const circle: PhotoMark = { kind: "ellipse", id: "c1", color: "red", a: [0.2, 0.2], b: [0.4, 0.6] };
const size = { w: 2000, h: 1000 };

/** The editor's surface as it first shows (no device memory here: Circle, red). */
const surface = (props: Partial<React.ComponentProps<typeof PhotoMarkupSurface>> = {}) =>
  renderToString(
    <PhotoMarkupSurface
      url="/p.jpg"
      size={size}
      initialMarks={[circle]}
      initialRotation={90}
      onDone={() => {}}
      status=" · saving…"
      footer={<button type="button">Take another</button>}
      {...props}
    />,
  );
/** The tags of all buttons / the divider, in order, as they render. */
const controls = (html: string) =>
  (html.match(/<button[^>]*>|<span[^>]*data-divider[^>]*>/g) ?? []).map((t) =>
    t.includes("data-divider")
      ? "|"
      : (/aria-label="([^"]*)"/.exec(t)?.[1] ?? /title="([^"]*)"/.exec(t)?.[1] ?? "?"),
  );

describe("the two-row toolbar (owner, Oct 28)", () => {
  it("row 1: the six tools, a divider, one colour button with the current swatch, then Undo and Clear", () => {
    const html = surface();
    // Row 1 ends where the picture's stage begins (the tool icons are <svg>s too).
    const row1 = html.slice(html.indexOf('data-row="tools"'), html.indexOf("<svg viewBox"));
    expect(controls(row1)).toEqual([
      "Move",
      "Circle",
      "Arrow",
      "Box",
      "Text",
      "Tag",
      "|",
      "Colour: Red",
      "Undo",
      "Clear",
    ]);
    // The divider: thin, aria-hidden, a dark tone.
    expect(row1).toMatch(
      /<span aria-hidden="true" data-divider="true" class="[^"]*border-l[^"]*dark:[^"]*"/,
    );
    // One colour button showing the colour itself (a swatch); the three colours are in its popover.
    expect(row1).toMatch(
      /<button[^>]*aria-label="Colour: Red"[^>]*data-colour="red"[^>]*aria-haspopup="dialog"[^>]*>\s*<span[^>]*rounded-full[^>]*style="background:#/,
    );
    for (const c of ["Red", "Yellow", "White"]) expect(html).not.toContain(`aria-label="${c}"`);
    expect(html).not.toContain('aria-label="Delete"');
    expect(html).not.toContain(">Delete<");
    // The tools are icons only on a phone; their label shows from sm up.
    expect(row1).toMatch(/<span class="hidden sm:inline">Circle<\/span>/);
    expect(row1).toMatch(
      /aria-label="Undo"[^>]*>[\s\S]*?<span class="hidden sm:inline">Undo<\/span>/,
    );
  });
  it("row 2 under the picture: Zoom in, Zoom out, Fit, Rotate left, Rotate right on one line; no status line", () => {
    const html = surface();
    const row2 = html.slice(html.indexOf('data-row="view"'), html.indexOf('data-line="how"'));
    expect(html.indexOf("</svg>")).toBeLessThan(html.indexOf('data-row="view"'));
    expect(controls(row2)).toEqual([
      "Zoom in",
      "Zoom out",
      "The whole photo",
      "Rotate left",
      "Rotate right",
    ]);
    expect(row2).toContain("Fit");
    expect(html).not.toContain("turned 90°");
    expect(html).not.toMatch(/\d+ marks?(<|\s*·)/);
    expect(html).not.toContain("1 mark");
    // The save state still shows, without the old " · " joiner.
    expect(row2).toMatch(/<span[^>]*role="status"[^>]*>saving…<\/span>/);
    // Without a rotation the Rotate group is gone and so is nothing else.
    expect(controls(surface({ rotatable: false }).slice(html.indexOf('data-row="view"')))).toEqual(
      expect.arrayContaining(["Zoom in", "Zoom out", "The whole photo"]),
    );
    expect(surface({ rotatable: false })).not.toContain('aria-label="Rotate left"');
  });
  it("Done and the caller's buttons: one row pinned to the dialog's bottom, full width on a phone", () => {
    const html = surface();
    const done = html.slice(html.indexOf('data-row="done"'));
    expect(done).toMatch(/class="[^"]*sticky bottom-0[^"]*"/);
    expect(done).toMatch(/class="[^"]*border-t[^"]*bg-card[^"]*"/);
    expect(done).toMatch(/class="[^"]*grid grid-cols-1[^"]*sm:flex[^"]*"/);
    expect(done).toMatch(/<button[^>]*class="[^"]*h-11 sm:h-9"[^>]*>Done<\/button>/);
    expect(done).toContain(">Take another</button>");
    // It is the last thing in the surface (after the mark list), so it sticks while the rest scrolls.
    expect(html.indexOf('aria-label="Marks"')).toBeLessThan(html.indexOf('data-row="done"'));
  });
  it("the mark list's × removes a mark (Delete left the toolbar); the hint line reads for the tool", () => {
    const html = surface();
    expect(html).toMatch(/<button[^>]*aria-label="Remove Circle 1"/);
    expect(html).toContain('data-line="how"');
    expect(html).toContain("Drag across the problem, or tap for a quick one.");
  });
});

describe("labels one size up (textScale) in the drawn marks", () => {
  const text: PhotoMark = { kind: "text", id: "t", color: "red", at: [0.5, 0.5], text: "Leak" };
  const tag: PhotoMark = {
    kind: "tag",
    id: "g",
    color: "red",
    at: [0.2, 0.2],
    label: "Seam",
    note: "",
  };
  it("a text's font and a tag's label grow by the scale; the tag's pin does not", () => {
    const plain = renderToString(<MarkShapes marks={[text, tag]} w={2000} h={1000} />);
    const big = renderToString(
      <MarkShapes marks={[text, tag]} w={2000} h={1000} textScale={1.25} />,
    );
    expect(plain).toMatch(/<text[^>]*font-size="80"[^>]*>Leak<\/text>/);
    expect(big).toMatch(/<text[^>]*font-size="100"[^>]*>Leak<\/text>/);
    expect(plain).toMatch(/<text[^>]*font-size="64"[^>]*>Seam<\/text>/);
    expect(big).toMatch(/<text[^>]*font-size="80"[^>]*>Seam<\/text>/);
    // The pin keeps its radius; the number in it its size.
    const pin = (h: string) => /<circle[^>]*r="([\d.]+)"/.exec(h)?.[1];
    expect(pin(big)).toBe(pin(plain));
  });
});

describe("RotatedPhoto turns a photo and its marks as one, everywhere a photo shows", () => {
  it("not turned: the <img> as before (object-fit from `fit`), the marks overlay over it", () => {
    const html = renderToString(
      <RotatedPhoto
        url="/p.jpg"
        alt="Before photo"
        marks={[circle]}
        rotation={0}
        fit="cover"
        size={size}
        className="h-full w-full"
        loading="lazy"
      />,
    );
    expect(html).toMatch(/<img[^>]*class="object-cover h-full w-full"/);
    expect(html).toContain('alt="Before photo"');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain("invisible");
    // MarksOverlay: the picture's own viewBox, cropped like object-cover.
    expect(html).toMatch(
      /<svg[^>]*viewBox="0 0 2000 1000"[^>]*preserveAspectRatio="xMidYMid slice"/,
    );
    expect(html).toMatch(/<ellipse[^>]*cx="600"[^>]*cy="400"/);
    expect(html).not.toContain("transform=");
    expect(html).not.toContain("data-rotation");
  });
  it("turned 90: an SVG in the turned box (sides swapped), picture and marks in one group with the rotation transform", () => {
    const html = renderToString(
      <RotatedPhoto
        url="/p.jpg"
        alt="Before photo"
        marks={[circle]}
        rotation={90}
        fit="contain"
        size={size}
        className="h-full w-full"
        title="Open the photo"
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toMatch(/<svg[^>]*viewBox="0 0 1000 2000"/);
    expect(html).toMatch(/<svg[^>]*width="1000"[^>]*height="2000"/);
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain('data-rotation="90"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Before photo"');
    expect(html).toContain("<title>Open the photo</title>");
    // The caller's sizing wins over the SVG's own h-auto (tailwind-merge).
    expect(html).toMatch(/<svg[^>]*class="h-full w-full"/);
    // One group turns the picture and the marks together; the marks keep the picture's own px.
    expect(html).toContain('<g transform="translate(1000 0) rotate(90)">');
    expect(html).toMatch(
      /<g transform="translate\(1000 0\) rotate\(90\)"><image href="\/p.jpg"[^>]*width="2000"[^>]*height="1000"[^>]*preserveAspectRatio="none"/,
    );
    expect(html).toMatch(/<ellipse[^>]*cx="600"[^>]*cy="400"/);
  });
  it("180 keeps the box and 270 swaps it; each carries its own transform", () => {
    const at = (rotation: 180 | 270) =>
      renderToString(
        <RotatedPhoto url="/p.jpg" alt="" marks={[]} rotation={rotation} fit="cover" size={size} />,
      );
    expect(at(180)).toMatch(/viewBox="0 0 2000 1000"/);
    expect(at(180)).toContain('<g transform="translate(2000 1000) rotate(180)">');
    expect(at(180)).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(at(270)).toMatch(/viewBox="0 0 1000 2000"/);
    expect(at(270)).toContain('<g transform="translate(0 2000) rotate(270)">');
    // Without a caller's height class the SVG's height follows its width (h-auto).
    expect(at(270)).toMatch(/<svg[^>]*class="h-auto"/);
  });
  it("turned but not yet measured: the <img> loads invisibly (its crop would be wrong), no SVG yet", () => {
    const measuring = renderToString(
      <RotatedPhoto
        url="/p.jpg"
        alt="Photo"
        marks={[circle]}
        rotation={90}
        fit="cover"
        className="h-full w-full"
        loading="lazy"
      />,
    );
    expect(measuring).toMatch(/<img[^>]*class="object-cover h-full w-full invisible"/);
    expect(measuring).toContain('loading="lazy"');
    expect(measuring).not.toContain("<svg");
    // A caller that measures itself and does not know the size yet: the same.
    const waiting = renderToString(
      <RotatedPhoto url="/p.jpg" alt="Photo" marks={[]} rotation={270} fit="contain" size={null} />,
    );
    expect(waiting).toMatch(/<img[^>]*class="object-contain invisible"/);
    expect(waiting).not.toContain("<svg");
    // Not turned and not measured: the plain <img>, visible, no overlay until the size is known.
    const plain = renderToString(
      <RotatedPhoto url="/p.jpg" alt="Photo" marks={[circle]} rotation={0} fit="contain" />,
    );
    expect(plain).toMatch(/<img[^>]*class="object-contain"/);
    expect(plain).not.toContain("invisible");
    expect(plain).not.toContain("<svg");
  });
});

describe("the phone's label sheet, compact (owner, Oct 28: it was too tall and a stray tap placed another mark)", () => {
  it("is capped at 70vh with the box and Done on one line, the note behind 'Add a note', and a tap guard after it closes", () => {
    const src = readFileSync("src/components/service/photo-markup.tsx", "utf8");
    expect(src).toContain('className="max-h-[70vh] overflow-y-auto rounded-t-xl');
    expect(src).toContain("export const TAP_GUARD_MS = 600;");
    expect(src).toContain("if (Date.now() < tapGuardUntil.current) return;");
    expect(src).toContain("onOpenChange={(o) => !o && closeSheet(true)}");
    expect(src).toContain("onCancel={() => closeSheet(true)}");
    expect(src).toContain('data-action="done"');
    expect(src).toContain('data-action="add-note"');
    expect(src).toContain("              compact\n");
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root).toContain("interactive-widget=resizes-content");
  });
});
