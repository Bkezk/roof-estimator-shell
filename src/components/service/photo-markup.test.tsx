/**
 * RotatedPhoto (owner, Oct 28: "allow rotation of photos on markup"), rendered to a string
 * (react-dom/server): the one piece every thumbnail, the lightbox and the document canvas use to
 * show a ticket photo turned the way it is kept, its marks over it. Not turned, it is the <img>
 * with the marks overlay as before; turned, an SVG whose viewBox is the turned box with the
 * picture and the marks in one group carrying the rotation transform.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { PhotoMark } from "@/lib/photo-annotations";

import { RotatedPhoto } from "./photo-markup";

const circle: PhotoMark = { kind: "ellipse", id: "c1", color: "red", a: [0.2, 0.2], b: [0.4, 0.6] };
const size = { w: 2000, h: 1000 };

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
