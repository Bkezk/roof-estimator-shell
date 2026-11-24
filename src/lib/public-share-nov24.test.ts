// Nov 24 (public pages audit, B1): a shared or texted link to a public page shows the company
// and the page, never the staff portal's card. Proven on the rendered pages of a local server
// the same day: /care, /request and /pay/<token> each had exactly one of every og: and twitter:
// tag, with the wording below, and /login kept the staff tags.
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  hasOwnSharePreview,
  PUBLIC_SHARE_IMAGE,
  PUBLIC_SHARE_ROUTE_IDS,
  PUBLIC_SITE_NAME,
  PUBLIC_SITE_URL,
  publicShareMeta,
  type ShareMeta,
} from "./public-share";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");
const keyOf = (m: ShareMeta) => m.name ?? m.property ?? "";

/**
 * The router's own rule (headContentUtils of @tanstack/react-router, read Nov 24): the matched
 * routes' tags are laid end to end and one tag is kept for each `name` or `property`, the
 * deepest route's.
 */
function merged(root: ShareMeta[], page: ShareMeta[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of [...root, ...page]) out.set(keyOf(m), m.content);
  return out;
}

/** The staff portal's tags, as the root writes them for a page that is not public. */
const ROOT_STAFF: ShareMeta[] = [
  {
    name: "description",
    content: "Internal roofing estimating tool for Duro-Last commercial roofing systems.",
  },
  { property: "og:title", content: "JBK Portal" },
  {
    property: "og:description",
    content: "Internal roofing estimating tool for Duro-Last commercial roofing systems.",
  },
  { property: "og:type", content: "website" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "apple-mobile-web-app-title", content: "JBK Portal" },
];

describe("a public page's own preview card", () => {
  const care = publicShareMeta({
    title: "Roof Care Plans | JBK Commercial Roofing",
    description: "Two roof inspections a year.",
    path: "/care",
  });

  it("says the page, the company, the address and a picture, once each", () => {
    const keys = care.map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
    const m = merged([], care);
    expect(m.get("og:title")).toBe("Roof Care Plans | JBK Commercial Roofing");
    expect(m.get("og:description")).toBe("Two roof inspections a year.");
    expect(m.get("description")).toBe("Two roof inspections a year.");
    expect(m.get("og:type")).toBe("website");
    expect(m.get("og:url")).toBe("https://jbkbid.com/care");
    expect(m.get("og:site_name")).toBe("JBK Commercial Roofing");
    expect(m.get("og:image")).toBe("https://jbkbid.com/jbk-icon-512.png");
    expect(m.get("twitter:card")).toBe("summary");
    expect(m.get("twitter:title")).toBe("Roof Care Plans | JBK Commercial Roofing");
    expect(m.get("twitter:description")).toBe("Two roof inspections a year.");
  });

  it("replaces every staff tag of the same name, so none of the portal's words are left", () => {
    const m = merged(ROOT_STAFF, care);
    for (const m0 of ROOT_STAFF) expect(m.has(keyOf(m0))).toBe(true);
    const words = [...m.values()].join(" | ");
    expect(words).not.toContain("Internal roofing");
    expect(words).not.toContain("JBK Portal");
    expect(words).not.toContain("Lovable");
    expect(m.get("apple-mobile-web-app-title")).toBe("JBK Roofing");
  });

  it("the picture is a whole address of a file that is in public/", () => {
    expect(PUBLIC_SITE_URL).toBe("https://jbkbid.com");
    expect(PUBLIC_SITE_NAME).toBe("JBK Commercial Roofing");
    expect(PUBLIC_SHARE_IMAGE.startsWith(`${PUBLIC_SITE_URL}/`)).toBe(true);
    expect(PUBLIC_SHARE_IMAGE.endsWith(".png")).toBe(true);
    expect(existsSync(`public${PUBLIC_SHARE_IMAGE.slice(PUBLIC_SITE_URL.length)}`)).toBe(true);
  });

  it("a page with no path given writes no address at all (a payment link holds a token)", () => {
    const pay = publicShareMeta({ title: "Pay", description: "The payment page." });
    expect(pay.map(keyOf)).not.toContain("og:url");
    expect(JSON.stringify(pay)).not.toContain("/pay");
    expect(merged(ROOT_STAFF, pay).get("og:title")).toBe("Pay");
  });
});

describe("which routes say their own card", () => {
  it("the three public pages, and no staff page", () => {
    expect(PUBLIC_SHARE_ROUTE_IDS).toEqual(["/care", "/request", "/pay/$token"]);
    const root = { routeId: "__root__" };
    for (const id of PUBLIC_SHARE_ROUTE_IDS)
      expect(hasOwnSharePreview([root, { routeId: id }]), id).toBe(true);
    for (const id of ["/login", "/", "/my-work", "/reset-password", "/setup/qr"])
      expect(hasOwnSharePreview([root, { routeId: id }]), id).toBe(false);
    expect(hasOwnSharePreview([])).toBe(false);
  });

  it("the root leaves its two builder credits off those routes, and only those", () => {
    const root = flat("src/routes/__root.tsx");
    expect(root).toContain("head: ({ matches }) => ({");
    expect(root).toContain(
      '...(hasOwnSharePreview(matches) ? [] : [{ name: "author", content: "Lovable" }]),',
    );
    expect(root).toContain(
      '...(hasOwnSharePreview(matches) ? [] : [{ name: "twitter:site", content: "@Lovable" }]),',
    );
    // Neither credit is written anywhere else in the root.
    expect(root.split('content: "Lovable"').length - 1).toBe(1);
    expect(root.split('content: "@Lovable"').length - 1).toBe(1);
    // The staff pages' own tags are as they were.
    expect(root).toContain('{ property: "og:title", content: "JBK Portal" },');
    expect(root).toContain('{ name: "twitter:card", content: "summary_large_image" },');
  });
});

describe("the three public routes", () => {
  it("/care and /request say their own card with their own address, and stay off search engines", () => {
    for (const [file, path, title] of [
      ["src/routes/care.tsx", "/care", "Roof Care Plans | JBK Commercial Roofing"],
      ["src/routes/request.tsx", "/request", "Request Service | JBK Commercial Roofing"],
    ] as const) {
      const r = flat(file);
      expect(r, file).toContain('import { publicShareMeta } from "@/lib/public-share";');
      expect(r, file).toContain(`...publicShareMeta({ title: "${title}",`);
      expect(r, file).toContain(`path: "${path}", }),`);
      expect(r, file).toContain(`{ title: "${title}" },`);
      expect(r, file).toContain('{ name: "robots", content: "noindex" }');
      expect(r, file).not.toContain("Lovable");
      expect(r, file).not.toContain("JBK Portal");
    }
  });

  it("/pay/<token> says a plain card with no address, and stays off search engines", () => {
    const r = flat("src/routes/pay.$token.tsx");
    expect(r).toContain(
      '...publicShareMeta({ title: "Pay for your Roof Care plan | JBK Commercial Roofing", description: "The payment page for your Roof Care plan from JBK Commercial Roofing.", }),',
    );
    expect(r).not.toContain("path:");
    expect(r).not.toContain("og:url");
    expect(r).toContain('{ name: "robots", content: "noindex, nofollow" }');
    expect(r).toContain('{ name: "referrer", content: "no-referrer" }');
  });
});
