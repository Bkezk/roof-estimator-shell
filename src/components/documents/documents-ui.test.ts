/**
 * The Documents editor's wiring (owner, Oct 26: CenterPoint's "Build a Bid" — Modules / Variables
 * / Insert PDF / Add Page / Save Template As / Revisions): the route's path and its three tabs,
 * the hint strings copied from CenterPoint, the canvas buttons, the save menu, and the component
 * names the bid and ticket pages import. Read from the sources, so a rename or a dropped string
 * fails here before it reaches the owner.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const route = read("src/routes/documents.tsx");
const canvas = read("src/components/documents/editor/page-canvas.tsx");
const panel = read("src/components/documents/documents-panel.tsx");
const newDialog = read("src/components/documents/new-document-dialog.tsx");
const actions = read("src/components/documents/document-actions.tsx");
const richText = read("src/components/documents/editor/rich-text.tsx");
const moduleView = read("src/components/documents/editor/module-view.tsx");

describe("the /documents route", () => {
  it("is the file route at /documents with the search parser", () => {
    expect(route).toContain('createFileRoute("/documents")');
    expect(route).toContain("validateSearch: documentSearch");
    // The route tree knows it (the sidebar / panel links type-check against this).
    expect(read("src/routeTree.gen.ts")).toContain("'/documents'");
  });
  it("has the three tabs", () => {
    expect(route).toContain('<TabsTrigger value="document">Document</TabsTrigger>');
    expect(route).toContain('<TabsTrigger value="modules">Modules</TabsTrigger>');
    expect(route).toContain('<TabsTrigger value="variables">Variables</TabsTrigger>');
  });
  it("carries CenterPoint's hint lines", () => {
    expect(route).toContain("Drag a module onto a page, or use + to add it to the selected page.");
    expect(route).toContain(
      "Available variables. Type / in a text box, drag one in, or click to insert at the cursor.",
    );
    expect(read("src/lib/documents/editor-helpers.ts")).toContain(
      "Dotted page-breaker when Footer is on (default 8.8). Range 5–10.5.",
    );
    expect(route).toContain("PAGE_BREAK_HINT");
  });
  it("has Save Template As, Manage Templates and Revisions", () => {
    expect(route).toContain("Save Template As…");
    expect(route).toContain("Save Template As\n");
    expect(route).toContain("Manage Templates");
    expect(route).toContain("Revisions…");
    expect(route).toContain("RevisionsSheet");
    expect(route).toContain("restoreDocumentRevision");
  });
  it("saves with Ctrl/Cmd+S and offers Reload on a refused save", () => {
    expect(route).toContain("useSaveShortcut");
    expect(route).toMatch(/e\.key\.toLowerCase\(\) === "s"/);
    expect(route).toContain('label: "Reload"');
    expect(route).toContain('msg.startsWith("Not saved")');
  });
  it("Back goes to the record, or to the templates page in template mode", () => {
    expect(route).toContain("backHref(bundle.backTo)");
    expect(route).toContain("TEMPLATES_ADMIN_PATH");
    expect(read("src/lib/documents/editor-helpers.ts")).toContain(
      'TEMPLATES_ADMIN_PATH = "/admin/documents"',
    );
  });
  it("the Modules tab offers every tile and the saved modules", () => {
    expect(route).toContain("MODULE_TILES.map(");
    expect(route).toContain("listSavedModules");
    expect(route).toContain("deleteSavedModule");
    expect(route).toContain("MODULE_DRAG_TYPE");
  });
  it("the Variables tab lists the kind's variables grouped, with Refresh data", () => {
    expect(route).toContain("groupVariables(filterVariables(filter, defs))");
    expect(route).toContain("Refresh data");
    expect(route).toContain("refreshDocumentVariables");
    expect(route).toContain("insertVariable(activeEditorRef.current, key)");
  });
});

describe("the canvas", () => {
  it("has Insert PDF and Add Page under each page, and the Page N tab", () => {
    expect(canvas).toContain("Insert PDF");
    expect(canvas).toContain("Add Page");
    // The tab reads "Page N" on a page's first sheet and "Page N · continued" on the sheets its
    // modules overflow onto (owner, Oct 26: the page break starts a new sheet on screen).
    expect(canvas).toContain("continuedTabLabel(props.index, part)");
    expect(canvas).toContain("packIntoSheets(");
    expect(canvas).toContain("sheetContentLimit(env.options)");
    expect(canvas).toContain("addPage(pages, i + 1)");
  });
  it("is a white US-Letter sheet (allowlisted in dark-mode.test.ts) with the page-break guide", () => {
    expect(canvas).toContain("document-sheet relative bg-white text-black");
    expect(read("src/lib/dark-mode.test.ts")).toContain(
      'file: "src/components/documents/editor/page-canvas.tsx"',
    );
    expect(canvas).toContain("pageBreakPx(props.options)");
    expect(canvas).toContain("border-dotted");
  });
  it("inserts a PDF from the library and uploads one", () => {
    expect(canvas).toContain("listDocumentAssets");
    expect(canvas).toContain("uploadDocumentAsset");
    expect(canvas).toContain("newPdfModule(");
    expect(canvas).toContain("Upload PDF");
  });
});

describe("the rich text", () => {
  it("is TipTap with the variable chip and the slash command", () => {
    expect(richText).toContain("name: VARIABLE_NODE");
    expect(richText).toContain("atom: true");
    expect(richText).toContain('char: "/"');
    expect(richText).toContain("filterVariables(query, opts.defs())");
    expect(richText).toContain("immediatelyRender: false");
  });
  it("prints only what we print", () => {
    expect(richText).toContain("blockquote: false");
    expect(richText).toContain("codeBlock: false");
    expect(richText).toContain("heading: { levels: [1, 2, 3] }");
    expect(richText).toContain('TextAlign.configure({ types: ["heading", "paragraph"] })');
  });
});

describe("the modules", () => {
  it("renders every module type", () => {
    for (const t of [
      "letterhead",
      "body",
      "twoColumns",
      "fullPhoto",
      "photoLeft",
      "photoRight",
      "twoPhotos",
      "table",
      "pricingTable",
      "signature",
      "hr",
      "pdf",
    ])
      expect(moduleView).toContain(`case "${t}":`);
  });
  it("has the hover toolbar: move, duplicate, save as module, delete", () => {
    for (const title of ["Move up", "Move down", "Duplicate", "Save as module…", "Delete"])
      expect(moduleView).toContain(`title="${title}"`);
  });
  it("the pricing table has Show sections, Edit rows and Reset", () => {
    expect(moduleView).toContain("Show sections");
    expect(moduleView).toContain("Edit rows");
    expect(moduleView).toContain("Reset");
    expect(moduleView).toContain("pricingRows(");
  });
});

describe("the panel, the dialog and the actions", () => {
  it("exports DocumentsPanel and DocumentsList", () => {
    expect(panel).toContain("export function DocumentsPanel(");
    expect(panel).toContain("export function DocumentsList(");
    expect(panel).toContain("Documents — {props.recordLabel}");
    expect(panel).toContain("New document");
    for (const item of ["Open PDF", "Share link", "Copy link", "Turn off link", "Email…", "Delete"])
      expect(panel).toContain(item);
  });
  it("exports NewDocumentDialog with Enter creating", () => {
    expect(newDialog).toContain("export function NewDocumentDialog(");
    expect(newDialog).toContain("createDocument");
    expect(newDialog).toContain('if (e.key === "Enter")');
    for (const label of ["With prices", "Include photos", "Marks on photos", "Footer", "Blank"])
      expect(newDialog).toContain(label);
  });
  it("the shared actions open a PDF from base64 and email with defaults", () => {
    expect(actions).toContain("export function useDocumentActions(");
    expect(read("src/components/documents/document-files.ts")).toContain(
      "export function openPdfBase64(",
    );
    expect(actions).toContain("openPdfBase64(r.base64, r.fileName)");
    expect(read("src/components/documents/document-files.ts")).toContain(
      "URL.createObjectURL(blob)",
    );
    expect(actions).toContain("emailDefaults(props.title, props.contacts)");
    expect(actions).toContain("emailDocument");
  });
});

describe("the server contract is called the useServerFn way", () => {
  it("every server call passes { data }", () => {
    const sources = [
      route,
      canvas,
      panel,
      newDialog,
      actions,
      read("src/components/documents/editor/photo-picker.tsx"),
    ];
    for (const src of sources) {
      // fooFn({ data: … }) or fooFn() for the no-input lists; never fooFn(plainArg).
      const calls =
        src.match(/\b(?!useServerFn)[a-zA-Z]+Fn\((?!\)|\{ data|\s*\{\s*data)[^)]/g) ?? [];
      expect(calls).toEqual([]);
    }
  });
});

describe("phase 2: the Photo Grid, the Repair List and marked-up pictures in the editor", () => {
  const picker = read("src/components/documents/editor/photo-picker.tsx");
  it("renders the two new modules with their tiles labelled like the others", () => {
    expect(moduleView).toContain('case "photoGrid":');
    expect(moduleView).toContain('case "repairList":');
    expect(moduleView).not.toContain("Phase 2 (built next)");
    expect(route).toContain("photoGrid: LayoutGrid,");
    expect(route).toContain("repairList: ListChecks,");
    expect(route).toContain("title={`${MODULE_LABELS[type]} — drag onto a page`}");
    expect(route).toContain("title={`Add ${MODULE_LABELS[type]} to the selected page`}");
  });
  it("the Photo Grid: 2 or 3 columns, a picker per cell with a caption, remove, Add picture and Add all ticket photos (captions from the checklist item)", () => {
    const grid = moduleView.slice(
      moduleView.indexOf("function PhotoGrid("),
      moduleView.indexOf("function RepairList("),
    );
    expect(grid).toContain("([2, 3] as const).map(");
    expect(grid).toContain("Add all ticket photos");
    expect(grid).toContain("Add picture");
    expect(grid).toContain('title="Remove this cell"');
    expect(grid).toContain("caption: photoGridCaption(p, insp)");
    expect(grid).toContain("marks: env.options.marks && p.hasMarks");
    expect(grid).toContain("gridTemplateColumns: `repeat(${m.columns}, minmax(0, 1fr))`");
    expect(grid).toContain("<ImageSlot");
    expect(grid).toContain("<Caption value={cell.caption}");
    expect(grid).toContain("<PhotoPicker");
  });
  it("the Repair List: rows from the inspection snapshot, Every item / Pictures switches, Edit rows / Reset to the inspection, the thumbnails under a row, the empty state", () => {
    const list = moduleView.slice(moduleView.indexOf("function RepairList("));
    expect(list).toContain("storedInspection(env.variables)");
    expect(list).toContain("repairListData(m, insp)");
    expect(list).toContain("Every item");
    expect(list).toContain("Pictures");
    expect(list).toContain("Reset to the inspection");
    expect(list).toContain("Edit rows");
    expect(list).toContain(": NO_INSPECTION_TEXT}");
    expect(read("src/lib/documents/pdf-layout.ts")).toContain(
      'NO_INSPECTION_TEXT = "No inspection on this ticket"',
    );
    expect(list).toContain("data-repair-photos={r}");
    expect(list).toContain('image={{ kind: "ticketPhoto", photoId, marks: env.options.marks }}');
    // Edited cells are inputs; otherwise the text prints with its variables resolved.
    expect(list).toMatch(/\{editing \? \(\s*<input/);
    // On the white paper in both themes (dark-mode.test.ts): the grey box says so explicitly.
    expect(list).toContain("dark:bg-neutral-100 dark:text-neutral-700");
  });
  it("every picture draws its marks and offers Mark up: an upload keeps them on its ref, a ticket photo saves on its row through the same drawing surface", () => {
    expect(picker).toContain(
      '<MarksOverlay marks={marks} w={natural.w} h={natural.h} fit="contain" />',
    );
    expect(picker).toContain("const marks = imageMarks(image, env.photos);");
    expect(picker).toContain('title="Mark up"');
    expect(picker).toContain("{canMarkUp(props.image) ? (");
    expect(picker).toContain("export function MarkupDialog(");
    expect(picker).toContain("<PhotoMarkupSurface");
    expect(picker).toContain("props.onChange(marks.length ? { ...rest, marks } : rest);");
    expect(picker).toContain("useServerFn(savePhotoAnnotations)");
    expect(picker).toContain("annotations: serializePhotoMarks(marks),");
    expect(picker).toContain(
      'import { MarksOverlay, PhotoMarkupSurface } from "@/components/service/photo-markup";',
    );
    // The surface is the ticket editor's own tools, split out so both use one drawer.
    const markup = read("src/components/service/photo-markup.tsx");
    expect(markup).toContain("export function PhotoMarkupSurface(");
    const editor = markup.slice(
      markup.indexOf("export function PhotoMarkupEditor"),
      markup.indexOf("export function PhotoMarkupSurface"),
    );
    expect(editor).toContain("<PhotoMarkupSurface");
    expect(editor).toContain("useServerFn(savePhotoAnnotations)");
    const surface = markup.slice(markup.indexOf("export function PhotoMarkupSurface"));
    expect(surface).not.toContain("savePhotoAnnotations");
    expect(surface).toContain("onDone(history.marks)");
    // The editor's photo rows carry the ticket's marks so the canvas can draw them.
    const fns = read("src/lib/documents.functions.ts");
    expect(fns).toContain("const marks = parsePhotoMarks(r.annotations);");
    expect(fns).toMatch(/marks,\s*itemKey: r\.item_key,/);
  });
  it("the server fills __inspection for an inspection ticket, on create and on Refresh data", () => {
    const fns = read("src/lib/documents.functions.ts");
    expect(fns).toContain(
      'if (row.service_type === "inspection") inspection = await loadInspection(sb, row);',
    );
    expect(fns).toContain("inspectionSnapshotFrom(");
    expect(fns).toContain('.eq("role", "other")');
    expect(fns).toContain('.is("repair_id", null)');
    expect(fns).toContain('.not("item_key", "is", null)');
    expect(fns).toMatch(/const snapshot = \(src: DocumentSource\) =>\s*withStoredInspection\(/);
    expect(fns).toContain("missingDefaultTemplates(all ?? [])");
    // Refresh data goes through the same snapshot.
    const refresh = fns.slice(fns.indexOf("export const refreshDocumentVariables"));
    expect(refresh).toContain("const variables = snapshot(loaded.source);");
  });
});
