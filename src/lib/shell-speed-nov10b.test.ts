/**
 * Nov 10, the fixes from the speed pass that live in the page shell (docs/qa/speed-pass-2026-11-10.md,
 * findings 3, 5, 8, 9, 11 and 13) and the Documents access rule (owner, Nov 10: "keep technicians
 * off the documents page. Allow office users to have access").
 *
 * Each block fails on the code of commit 07d06d1 and passes after.
 */
import { existsSync, readFileSync, statSync } from "node:fs";

import { redirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import {
  canOpenPage,
  DOCUMENTS_NEEDS,
  hasDocumentsAccess,
  homeFor,
  pageForPath,
} from "@/lib/access";
import {
  gateDecision,
  PROFILE_REUSE_MS,
  reusableProfileLoad,
  type ProfileLoadMemo,
  type ProfileLoadResult,
} from "@/lib/auth-flow";
import { CLIENT_CHUNK_GROUPS, HEAVY_LIBRARIES, ICONS_TEST, VENDOR_TEST } from "@/lib/build-chunks";
import { HOME_REDIRECT, HOME_REDIRECT_MAX_AGE_S } from "@/lib/home-redirect";
import { readWhoHint, whoForList, WORK_WHO_HINT_KEY, writeWhoHint } from "@/lib/my-work";
import { EXCEL_LOAD_FAILED } from "@/lib/order-list-export";
import { canOpenPath, tileBlockedTitle } from "@/lib/work-tile-access";

const read = (p: string) => readFileSync(p, "utf8");

// ── finding 3: fewer files per page ──────────────────────────────────────────────────────────
describe("finding 3: the build groups the icons and the first screen's code", () => {
  const nm = "/home/x/app/node_modules";
  it("the icons go into one file", () => {
    const icons = CLIENT_CHUNK_GROUPS.find((g) => g.name === "icons");
    expect(icons?.test).toBe(ICONS_TEST);
    expect(ICONS_TEST.test(`${nm}/lucide-react/dist/esm/icons/check.js`)).toBe(true);
    expect(ICONS_TEST.test(`C:\\app\\node_modules\\lucide-react\\dist\\esm\\icons\\x.js`)).toBe(
      true,
    );
    expect(ICONS_TEST.test(`${nm}/react/index.js`)).toBe(false);
    expect(ICONS_TEST.test("/home/x/app/src/components/app-sidebar.tsx")).toBe(false);
    // The icons group may hold icons only: it has no tag to keep it to the first screen.
    for (const lib of HEAVY_LIBRARIES) expect(ICONS_TEST.test(`${nm}/${lib}/index.js`)).toBe(false);
  });
  it("the libraries and our own first-screen code go into two files, and only what the first screen needs", () => {
    const vendor = CLIENT_CHUNK_GROUPS.find((g) => g.name === "vendor");
    const shell = CLIENT_CHUNK_GROUPS.find((g) => g.name === "shell");
    expect(vendor?.tags).toEqual(["$initial"]);
    expect(shell?.tags).toEqual(["$initial"]);
    expect(shell?.test).toBeUndefined();
    expect(VENDOR_TEST.test(`${nm}/react-dom/client.js`)).toBe(true);
    expect(VENDOR_TEST.test(`${nm}/@tanstack/react-router/dist/esm/index.js`)).toBe(true);
    // The framework's browser entry imports our router: taking it would take all of our code.
    expect(VENDOR_TEST.test(`${nm}/@tanstack/react-start/dist/default-entry/client.tsx`)).toBe(
      false,
    );
    expect(VENDOR_TEST.test(`${nm}/@tanstack/start-client-core/dist/esm/index.js`)).toBe(false);
    // The icons have their own group.
    expect(VENDOR_TEST.test(`${nm}/lucide-react/dist/esm/icons/check.js`)).toBe(false);
    expect(VENDOR_TEST.test("/home/x/app/src/lib/access.ts")).toBe(false);
  });
  it("no group can pull a heavy library into a page that does not use it", () => {
    // A group that could match a heavy library by its path must be held to the first screen's
    // own imports ($initial): a page then gets it only if the first screen already needed it.
    for (const g of CLIENT_CHUNK_GROUPS)
      for (const lib of HEAVY_LIBRARIES) {
        const couldMatch = !g.test || g.test.test(`${nm}/${lib}/index.js`);
        if (couldMatch) expect(g.tags, `${g.name} / ${lib}`).toEqual(["$initial"]);
      }
    // React goes with the libraries, not with the icons: vendor is tried first.
    const pr = (n: string) => CLIENT_CHUNK_GROUPS.find((g) => g.name === n)?.priority ?? 0;
    expect(pr("vendor")).toBeGreaterThan(pr("icons"));
    expect(pr("icons")).toBeGreaterThan(pr("shell"));
  });
  it("vite.config.ts hands the groups to the browser's build only, through the Lovable config", () => {
    const cfg = read("vite.config.ts");
    expect(cfg).toContain('import { defineConfig } from "@lovable.dev/vite-tanstack-config";');
    expect(cfg).toContain('import { CLIENT_CHUNK_GROUPS } from "./src/lib/build-chunks";');
    expect(cfg).toMatch(
      /vite: \{[\s\S]*?environments: \{\s*client: \{\s*build: \{\s*rolldownOptions: \{\s*output: \{ codeSplitting: \{ groups: CLIENT_CHUNK_GROUPS \} \},/,
    );
    // Without this the bundler folds the two first-screen files back into one, and the
    // libraries would be fetched again after each of our own releases.
    expect(cfg).toContain("experimental: { chunkOptimization: { mergeCommonChunks: false } },");
    // No plugin the Lovable config already brings.
    expect(cfg).not.toMatch(/^\s*plugins: /m);
  });
  it("the first screen's own code names no heavy library", () => {
    // What every page loads: the root, the gate, the menu. (The build is measured in the notes.)
    for (const f of [
      "src/routes/__root.tsx",
      "src/components/auth-gate.tsx",
      "src/components/app-sidebar.tsx",
      "src/lib/auth-context.tsx",
      "src/routes/documents.tsx",
      "src/routes/index.tsx",
    ]) {
      const src = read(f);
      for (const lib of HEAVY_LIBRARIES)
        expect(src, `${f} / ${lib}`).not.toMatch(new RegExp(`from "${lib}["/]`));
    }
  });
});

// ── finding 5: the logo ──────────────────────────────────────────────────────────────────────
describe("finding 5: the menu's logo is a small copy with an address the browser keeps", () => {
  const small = "src/assets/jbk-logo-360.webp";
  it("the copy is a 360 px wide WebP of a few KB", () => {
    expect(existsSync(small)).toBe(true);
    const bytes = readFileSync(small);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect(bytes.length).toBeLessThan(20_000);
    // The original it was made from: 88 KB.
    expect(statSync("public/jbk-logo.webp").size).toBeGreaterThan(80_000);
    // VP8X header: canvas width - 1 and height - 1, 24 bits each, at offsets 24 and 27.
    if (bytes.subarray(12, 16).toString("latin1") === "VP8X") {
      expect(bytes.readUIntLE(24, 3) + 1).toBe(360);
      expect(bytes.readUIntLE(27, 3) + 1).toBe(203);
    }
  });
  it("the menu imports it through the build and no longer asks for the 88 KB file", () => {
    const nav = read("src/components/app-sidebar.tsx");
    expect(nav).toContain('import logoSmall from "@/assets/jbk-logo-360.webp";');
    expect(nav).toMatch(/<img\s+src=\{logoSmall\}\s+width=\{360\}\s+height=\{203\}/);
    expect(nav).not.toContain('src="/jbk-logo.webp"');
  });
  it("what is printed keeps its own copies", () => {
    // The document editor's preview and the PDFs do not use the menu's small copy.
    expect(read("src/lib/documents/editor-helpers.ts")).toContain(
      'export const LOGO_SRC = "/jbk-logo.webp";',
    );
    expect(read("src/lib/documents/document-pdf.server.ts")).toContain(
      'import { jbkLogoPng } from "@/lib/jbk-logo.server";',
    );
    expect(read("src/lib/jbk-logo.server.ts")).not.toContain("jbk-logo-360");
  });
});

// ── finding 8a: one profile read ─────────────────────────────────────────────────────────────
describe("finding 8: the profile is read once per page load", () => {
  type P = { id: string };
  const ok: ProfileLoadResult<P> = { ok: true, profile: { id: "u1" } };
  const memo = (o: Partial<ProfileLoadMemo<P>>): ProfileLoadMemo<P> => ({
    userId: "u1",
    promise: Promise.resolve(ok),
    okAt: null,
    settled: false,
    ...o,
  });
  it("asks that arrive together share the read in flight", () => {
    const m = memo({});
    expect(reusableProfileLoad(m, "u1", 1_000)).toBe(m.promise);
    // Even refreshProfile joins a read that has not answered yet.
    expect(reusableProfileLoad(m, "u1", 1_000, true)).toBe(m.promise);
  });
  it("a read that found the row answers the next ask for a moment, then a new read is made", () => {
    const m = memo({ settled: true, okAt: 5_000 });
    expect(reusableProfileLoad(m, "u1", 5_000 + PROFILE_REUSE_MS - 1)).toBe(m.promise);
    expect(reusableProfileLoad(m, "u1", 5_000 + PROFILE_REUSE_MS)).toBeNull();
    // A tab woken an hour later reads again, so a changed role still arrives.
    expect(reusableProfileLoad(m, "u1", 5_000 + 60 * 60_000)).toBeNull();
  });
  it("refreshProfile, a failed read, and another person each get a new read", () => {
    const m = memo({ settled: true, okAt: 5_000 });
    expect(reusableProfileLoad(m, "u1", 5_001, true)).toBeNull();
    expect(reusableProfileLoad(memo({ settled: true, okAt: null }), "u1", 5_001)).toBeNull();
    expect(reusableProfileLoad(m, "u2", 5_001)).toBeNull();
    expect(reusableProfileLoad(null, "u1", 5_001)).toBeNull();
  });
  it("the provider goes through it: getMyProfile is called in one place", () => {
    const auth = read("src/lib/auth-context.tsx");
    expect(auth).toContain(
      "let pending = reusableProfileLoad(loadMemoRef.current, userId, Date.now(), force);",
    );
    expect(auth).toMatch(
      /if \(!pending\) \{\s*const memo: ProfileLoadMemo<UserProfile> = \{\s*userId,\s*promise: readProfile\(\),/,
    );
    expect(auth).toContain("const result = await pending;");
    // The only calls are inside readProfile (the read and its one retry).
    const read1 = auth.slice(auth.indexOf("async function readProfile()"));
    const body = read1.slice(0, read1.indexOf("async function loadProfile("));
    expect((body.match(/await getMyProfile\(\)/g) ?? []).length).toBe(2);
    expect((auth.match(/await getMyProfile\(\)/g) ?? []).length).toBe(2);
    // refreshProfile asks for a new read.
    expect(auth).toMatch(/forceReadRef\.current = true;\s*await loadProfile\(data\.session\);/);
  });
});

// ── finding 8b: Work Overview's list once ────────────────────────────────────────────────────
describe("finding 8: Work Overview asks for its list once", () => {
  const admin = { role: "admin", id: "a1" };
  const plain = { role: "user", id: "p1" };
  const none = { selfId: "a1", profileFailed: false, hint: null } as const;
  it("with the profile it is resolveWho, as before", () => {
    expect(whoForList(null, admin, none)).toEqual({ who: "all", ready: true });
    expect(whoForList(null, plain, { ...none, selfId: "p1" })).toEqual({
      who: "mine",
      ready: true,
    });
    expect(whoForList("mine", admin, none)).toEqual({ who: "mine", ready: true });
    expect(whoForList("a1", admin, none)).toEqual({ who: "mine", ready: true });
  });
  it("before the profile: a named person at once; the remembered default; else it waits", () => {
    // The old code started as "mine" here and started again as "all" when an admin's profile landed.
    expect(whoForList(null, null, none)).toEqual({ who: "mine", ready: false });
    expect(whoForList(null, null, { ...none, hint: "all" })).toEqual({ who: "all", ready: true });
    expect(whoForList(null, null, { ...none, hint: "mine" })).toEqual({ who: "mine", ready: true });
    expect(whoForList("all", null, none)).toEqual({ who: "all", ready: true });
    expect(whoForList("b2", null, none)).toEqual({ who: "b2", ready: true });
    // The caller's own id reads as Mine before the profile too (no second fetch when it lands).
    expect(whoForList("a1", null, none)).toEqual({ who: "mine", ready: true });
    // A failed profile read does not leave the list waiting for ever.
    expect(whoForList(null, null, { ...none, profileFailed: true })).toEqual({
      who: "mine",
      ready: true,
    });
  });
  it("the hint is kept per person in the browser, and a blocked storage is survived", () => {
    const m = new Map<string, string>();
    const storage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
    expect(readWhoHint(storage, "a1")).toBeNull();
    writeWhoHint(storage, "a1", "all");
    expect(m.get(`${WORK_WHO_HINT_KEY}:a1`)).toBe("all");
    expect(readWhoHint(storage, "a1")).toBe("all");
    expect(readWhoHint(storage, "p1")).toBeNull();
    m.set(`${WORK_WHO_HINT_KEY}:p1`, "everyone");
    expect(readWhoHint(storage, "p1")).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readWhoHint(broken, "a1")).toBeNull();
    expect(() => writeWhoHint(broken, "a1", "all")).not.toThrow();
    expect(readWhoHint(null, "a1")).toBeNull();
  });
  it("the page waits for it, remembers the default, and shows Loading meanwhile", () => {
    const page = read("src/components/my-work-page.tsx");
    expect(page).toContain(
      "const whoHint = useMemo(() => readWhoHint(storage, userId), [storage, userId]);",
    );
    expect(page).toMatch(
      /const \{ who, ready: whoReady \} = whoForList\(landing\.who, profile, \{\s*selfId: userId,\s*profileFailed,\s*hint: whoHint,\s*\}\);/,
    );
    expect(page).toContain("enabled: !!session && whoReady,");
    expect(page).not.toMatch(/enabled: !!session,\s*\/\/ Owner, Oct 15/);
    expect(page).toContain(
      "if (profile && userId) writeWhoHint(storage, userId, defaultWho(profile));",
    );
    expect(page).toContain("{q.isLoading || !whoReady ? (");
  });
});

// ── finding 9: the Excel library ─────────────────────────────────────────────────────────────
describe("finding 9: the estimator fetches the Excel library when Excel is pressed", () => {
  const est = read("src/routes/estimate.tsx");
  it("there is no Excel import at the top of the file", () => {
    expect(est).not.toMatch(/^import \* as XLSX from "xlsx";/m);
    expect(est).not.toMatch(/^import .* from "xlsx";/m);
  });
  it("the export loads it, and says so plainly when it cannot", () => {
    expect(est).toMatch(
      /const exportOrderExcel = async \(\) => \{\s*let XLSX: typeof import\("xlsx"\);\s*try \{\s*XLSX = await import\("xlsx"\);\s*\} catch \{\s*toast\.error\(EXCEL_LOAD_FAILED\);\s*return;\s*\}/,
    );
    expect(est).toContain("onClick={() => void exportOrderExcel()}");
    expect(EXCEL_LOAD_FAILED).toBe(
      "Could not get the Excel part of the page. Check the connection and press Excel again",
    );
  });
});

// ── finding 11: the Documents editor on demand ───────────────────────────────────────────────
describe("finding 11: /documents loads the editor only for a document or a template", () => {
  const route = read("src/routes/documents.tsx");
  it("the route file holds the address and the card, and loads the editor lazily", () => {
    expect(route).toContain(
      'const DocumentsEditorScreen = lazy(() => import("@/components/documents/editor-screen"));',
    );
    expect(route).toMatch(/if \(id \|\| template\)\s*return \(\s*<Suspense/);
    expect(route).toContain("Documents open from a bid or a ticket.");
    expect(route).toContain("<a href={TEMPLATES_ADMIN_PATH}>Manage Templates</a>");
    // Nothing of the editor is imported by the route file itself.
    expect(route).not.toContain("@/components/documents/editor/");
    expect(route).not.toContain("@tiptap/");
    expect(route).not.toContain("documents.functions");
    expect(route.split("\n").length).toBeLessThan(90);
  });
  it("the editor screen is the moved file, with the same three ways in", () => {
    const screen = read("src/components/documents/editor-screen.tsx");
    expect(screen).toMatch(
      /export default function DocumentsEditorScreen\(props: DocumentSearch\) \{\s*const \{ id, template, kind \} = props;\s*if \(id\) return <DocumentEditorLoader id=\{id\} \/>;\s*if \(template === "new"\) return <TemplateEditor template=\{null\} kind=\{kind \?\? "bid"\} \/>;\s*if \(template\) return <TemplateEditorLoader id=\{template\} \/>;/,
    );
    expect(screen).not.toContain("createFileRoute");
  });
});

// ── finding 13: the home address ─────────────────────────────────────────────────────────────
describe("finding 13: the bare address is remembered instead of asked for every time", () => {
  it("the redirect is one the browser may keep for a week, for this person only", () => {
    expect(HOME_REDIRECT.statusCode).toBe(301);
    expect(HOME_REDIRECT_MAX_AGE_S).toBe(604_800);
    expect(HOME_REDIRECT.headers["Cache-Control"]).toBe("private, max-age=604800");
    // What the router builds from it (the server answers with this response).
    const r = redirect({ to: "/my-work", ...HOME_REDIRECT });
    expect(r.status).toBe(301);
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=604800");
  });
  it("the route uses it and still sends everyone to Work Overview", () => {
    const index = read("src/routes/index.tsx");
    expect(index).toContain('throw redirect({ to: "/my-work", ...HOME_REDIRECT });');
    expect(index).not.toContain('throw redirect({ to: "/my-work" });');
    // Where each kind of user lands is unchanged: the gate sends a technician on from there.
    expect(homeFor({ role: "user", access: ["service"], technician: true })).toBe("/service/today");
    expect(homeFor({ role: "user", access: ["estimate"], technician: false })).toBe("/my-work");
    expect(homeFor({ role: "admin", access: [] })).toBe("/my-work");
  });
  it("the home-screen icon opens Work Overview directly", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
      start_url: string;
      scope: string;
    };
    expect(manifest.start_url).toBe("/my-work");
    expect(manifest.scope).toBe("/");
  });
});

// ── Documents access ─────────────────────────────────────────────────────────────────────────
describe("Documents: technicians kept off, office users let in (owner, Nov 10)", () => {
  const tech = { role: "user", access: ["service"], technician: true };
  const office = {
    role: "user",
    access: ["estimate", "pricing", "customers", "service", "invoices", "prospect", "takeoff"],
    technician: true,
  };
  const customersOnly = { role: "user", access: ["customers"], technician: false };
  const invoicesOnly = { role: "user", access: ["invoices"], technician: false };
  const manager = { role: "manager", access: [] as string[], technician: false };
  const admin = { role: "admin", access: [] as string[], technician: true };
  const session = {};

  it("the Documents page and Admin › Documents belong to Documents access", () => {
    for (const p of [
      "/documents",
      "/documents?template=new",
      "/documents?id=x",
      "/admin/documents",
    ])
      expect(pageForPath(p), p).toBe("documents");
    // The public share link is not the Documents page.
    expect(pageForPath("/d/abc")).toBeNull();
    // The rest of /admin is as it was.
    expect(pageForPath("/admin/settings")).toBe("pricing");
    expect(pageForPath("/admin/users")).toBe("admin");
    expect(pageForPath("/setup")).toBe("manager");
  });
  it("a technician is sent away from both; an office user, a manager and an admin open both", () => {
    for (const path of ["/documents", "/documents?template=new", "/admin/documents"]) {
      const page = pageForPath(path);
      expect(gateDecision(session, tech, false, page), `tech ${path}`).toBe("blocked");
      for (const p of [office, customersOnly, invoicesOnly, manager, admin])
        expect(gateDecision(session, p, false, page), `${p.role} ${path}`).toBe("open");
      expect(canOpenPath(tech, path)).toBe(false);
      expect(canOpenPath(office, path)).toBe(true);
    }
    // The old code let the technician in (the page was every signed-in user's) and kept the
    // office user out of Admin › Documents (it was a manager's).
    expect(homeFor(tech)).toBe("/service/today");
    // Until the profile is here nothing is blocked; a failed profile read blocks it.
    expect(gateDecision(session, null, false, "documents")).toBe("open");
    expect(gateDecision(session, null, true, "documents")).toBe("blocked");
  });
  it("canOpenPage keeps the other rules: admin, manager, a ticked page", () => {
    expect(canOpenPage(office, "manager")).toBe(false);
    expect(canOpenPage(manager, "manager")).toBe(true);
    expect(canOpenPage(manager, "admin")).toBe(false);
    expect(canOpenPage(admin, "admin")).toBe(true);
    expect(canOpenPage(tech, "service")).toBe(true);
    expect(canOpenPage(tech, "customers")).toBe(false);
    expect(canOpenPage(tech, "inventory")).toBe(true);
    expect(canOpenPage(null, "documents")).toBe(false);
  });
  it("the twin of documents_access(): Estimate, Invoices or Customers, a manager, an admin", () => {
    expect(hasDocumentsAccess(tech)).toBe(false);
    for (const p of [office, customersOnly, invoicesOnly, manager, admin])
      expect(hasDocumentsAccess(p)).toBe(true);
    expect(hasDocumentsAccess({ role: "user", access: ["takeoff", "prospect"] })).toBe(false);
  });
  it("templates, snippets and the PDF library are written by Documents access, not managers only", () => {
    const fn = read("src/lib/documents.functions.ts");
    expect(fn).toMatch(
      /function documentsOnly\(p: \{ role: string; access: string\[\] \}\) \{\s*if \(!hasDocumentsAccess\(p\)\) throw new Error\(DOCUMENTS_NEEDS\);\s*\}/,
    );
    expect((fn.match(/documentsOnly\(me\.profile\)/g) ?? []).length).toBe(8);
    expect(fn).not.toContain("managerOnly");
    expect(fn).not.toContain("are a manager's");
    expect(fn).not.toContain("managesTickets");
    expect(DOCUMENTS_NEEDS).toBe("Documents needs Estimate, Invoices or Customers access");
  });
  it("the menu shows Documents to everyone who may open it, and the tile title names it", () => {
    const nav = read("src/components/app-sidebar.tsx");
    expect(nav).toContain('{(role === "admin" || hasDocumentsAccess(profile)) && (');
    expect(nav).not.toContain('{(role === "admin" || managesTickets(profile)) && (');
    // The admin-only items stay the admins'.
    expect(nav).toContain('.filter((item) => !item.adminOnly || role === "admin")');
    expect(read("src/lib/work-tile-access.ts")).toContain('page === "documents"');
    // (No tile links to Documents today; the helper still answers for it.)
    expect(typeof tileBlockedTitle).toBe("function");
  });
});
