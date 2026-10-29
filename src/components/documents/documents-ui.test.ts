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
    // Oct 28: the Modules hint says a snippet drags too, and where a drop and a + each land.
    expect(route.replace(/\s+/g, " ")).toContain(
      "Drag a module or a snippet onto a page where you want it, or use + to add it to the bottom of the selected page.",
    );
    expect(route).not.toContain(
      "Drag a module onto a page, or use + to add it to the selected page.",
    );
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
  it("the saved snippet rows drag onto a page like the tiles (Oct 28), and + still adds to the selected page", () => {
    const rows = route.slice(
      route.indexOf("{props.savedModules.map((s) => ("),
      route.indexOf("</ul>", route.indexOf("{props.savedModules.map((s) => (")),
    );
    expect(rows).toContain("draggable");
    expect(rows).toContain("e.dataTransfer.setData(SNIPPET_DRAG_TYPE, s.id);");
    expect(rows).toContain('e.dataTransfer.effectAllowed = "copy";');
    expect(rows).toContain("cursor-grab");
    expect(rows).toContain("<GripVertical");
    expect(rows).toContain("title={`${s.name} — drag onto a page`}");
    expect(rows).toContain("onClick={() => props.onAddSaved(s.module)}");
    // The + paths are unchanged: a fresh copy appended to the selected page.
    expect(route).toContain("onAdd={(type) => addToSelected(newModule(type))}");
    expect(route).toContain("onAddSaved={(m) => addToSelected(cloneModule(m))}");
    expect(route).toMatch(/op: \(pages\) => addModule\(pages, i, m\) \}/);
    // The canvas looks a dragged snippet up by its id through the editor env.
    expect(route).toContain("snippets: savedModules.data ?? EMPTY_SNIPPETS,");
    expect(read("src/components/documents/editor/editor-context.tsx")).toContain(
      "snippets: ReadonlyArray<{ id: string; name: string; module: DocModule }>;",
    );
    expect(read("src/lib/documents/editor-helpers.ts")).toContain(
      'export const SNIPPET_DRAG_TYPE = "application/x-jbk-document-snippet";',
    );
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
    // Oct 29: picture modules are cut between their rows (sheet-segments.test.ts).
    expect(canvas).toContain("packIntoSegments(");
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
  it("drops a tile or a snippet where the pointer is (Oct 28): both drag types, the insertion line, addModule with `at`, then scrolls to it", () => {
    const sheet = canvas.slice(
      canvas.indexOf("function Sheet("),
      canvas.indexOf("function carriesModule("),
    );
    // Both kinds are accepted, through one check the dragover and the drop share.
    expect(canvas).toMatch(
      /return types\.includes\(MODULE_DRAG_TYPE\) \|\| types\.includes\(SNIPPET_DRAG_TYPE\);/,
    );
    expect(sheet).toContain("if (!carriesModule(e.dataTransfer)) return;");
    expect(sheet).toContain('e.dataTransfer.dropEffect = "copy";');
    // The gap under the pointer, by the midpoint rule (drop-index.ts), from the wrappers' boxes.
    expect(sheet).toContain("const k = dropIndexFromY(");
    expect(sheet).toContain('column.querySelectorAll<HTMLElement>(":scope > [data-module-id]")');
    expect(sheet).toContain("w.getBoundingClientRect()");
    // The drop passes the position; the + buttons keep appending (no `at`).
    expect(sheet).toContain("const { at } = dropTarget(e.clientY);");
    expect(sheet).toContain("op: (pages) => addModule(pages, props.index, dropped, at),");
    expect(sheet).not.toContain("addModule(pages, props.index, newModule(type as ModuleType))");
    expect(sheet).toContain('env.dispatch({ type: "selectPage", pageId: props.page.id });');
    expect(sheet).toContain("window.setTimeout(() => scrollToModule(dropped.id), 50);");
    expect(read("src/components/documents/editor/editor-dom.ts")).toContain(
      "export function scrollToModule(moduleId: string)",
    );
    // The insertion line: thin, sky with a dark: tone, over the page's existing "over" ring.
    expect(sheet).toContain("data-drop-line");
    expect(sheet).toMatch(/data-drop-line[\s\S]{0,200}bg-sky-500 dark:bg-sky-400/);
    expect(sheet).toContain('drop !== null && "ring-2 ring-primary ring-offset-2"');
    // A snippet drop is a fresh copy, looked up by id; a missing one is said out loud.
    const dropped = canvas.slice(canvas.indexOf("function droppedModule("));
    expect(dropped).toContain("const snippetId = dt.getData(SNIPPET_DRAG_TYPE);");
    expect(dropped).toContain("return cloneModule(snippet.module);");
    expect(dropped).toContain("That saved snippet is no longer in the list");
    expect(sheet).toContain("toast.error(errText(err));");
    // The + buttons are the touch path (HTML5 drag does not fire on most phones).
    expect(canvas).toContain("HTML5 drag does not fire on most phones");
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
  it("has the hover toolbar: move, duplicate, save as snippet, delete", () => {
    for (const title of ["Move up", "Move down", "Duplicate", "Save as snippet…", "Delete"])
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
    // Oct 28: the pick carries the photo's marks whatever the Marks checkbox says (it only hides them).
    expect(grid).toContain(
      'image: { kind: "ticketPhoto" as const, photoId: p.id, marks: p.hasMarks }',
    );
    expect(grid).not.toContain("marks: env.options.marks && p.hasMarks");
    expect(grid).toContain("gridTemplateColumns: `repeat(${m.columns}, minmax(0, 1fr))`");
    expect(grid).toContain("<ImageSlot");
    expect(grid).toContain("<Caption value={cell.caption}");
    expect(grid).toContain("<PhotoPicker");
  });
  it("the Repair List: rows from the inspection snapshot, Edit rows / Undo edits, the thumbnails under a row, the empty state", () => {
    const list = moduleView.slice(moduleView.indexOf("function RepairList("));
    expect(list).toContain("storedInspection(env.variables)");
    // Oct 28: the pictures follow the document's Photos checkbox (repair-list-ui.test.ts).
    expect(list).toContain("repairListData(m, insp, env.options.photos)");
    // Oct 28 (repair-list-ui.test.ts): the switches are gone; the row editing is relabelled.
    expect(list).not.toContain("All checklist items");
    expect(list).not.toContain("Show pictures");
    expect(list).toContain("Undo edits");
    expect(list).toContain("Edit rows");
    // No snapshot on a document: a plain line pointing at Refresh data (the PDF prints nothing).
    expect(list).toContain("{NO_INSPECTION_HINT}");
    expect(read("src/lib/documents/editor-helpers.ts")).toContain(
      'NO_INSPECTION_HINT =\n  "No inspection findings were on the ticket when this document was made. Click Refresh data on the Variables tab to pull them in."',
    );
    expect(read("src/lib/documents/pdf-layout.ts")).not.toContain("NO_INSPECTION_TEXT");
    expect(list).toContain("data-repair-photos={r}");
    expect(list).toContain('image={{ kind: "ticketPhoto", photoId, marks: env.options.marks }}');
    // Edited cells are inputs; otherwise the text prints with its variables resolved.
    expect(list).toMatch(/\{editing \? \(\s*<input/);
    // On the white paper in both themes (dark-mode.test.ts): the grey box says so explicitly.
    expect(list).toContain("dark:bg-neutral-100 dark:text-neutral-700");
  });
  it("every picture draws its marks and offers Mark up: an upload keeps them on its ref, a ticket photo saves on its row through the same drawing surface", () => {
    // The canvas picture is RotatedPhoto: the marks over it, turned as the ticket keeps it.
    expect(picker).toMatch(
      /<RotatedPhoto\s+url=\{src\}\s+alt=\{label\}\s+title=\{label\}\s+marks=\{marks\}\s+rotation=\{rotation\}\s+fit="contain"/,
    );
    // Oct 28: the document's Marks checkbox decides whether they draw; the ref keeps them.
    expect(picker).toContain("const marks = imageMarks(image, env.photos, env.options.marks);");
    expect(picker).toContain("const rotation = imageRotation(image, env.photos);");
    // Oct 28: the pencil's title says why it is disabled while the Marks checkbox is off.
    expect(picker).toContain('title={marksOff ? MARKS_OFF_HINT : "Mark up"}');
    // Oct 28: the launcher is one shared wrapper (MarkUpAffordance) the slot and the Repair
    // List's thumbnails both use (repair-list-ui.test.ts).
    expect(picker).toContain("const can = canMarkUp(props.image);");
    expect(picker).toContain("export function MarkUpAffordance(");
    expect(picker).toContain("export function MarkupDialog(");
    expect(picker).toContain("<PhotoMarkupSurface");
    expect(picker).toContain("props.onChange(marks.length ? { ...rest, marks } : rest);");
    expect(picker).toContain("useServerFn(savePhotoAnnotations)");
    expect(picker).toContain("annotations: serializePhotoMarks(m.marks, m.rotation),");
    expect(picker).toContain(
      'import { PhotoMarkupSurface, RotatedPhoto } from "@/components/service/photo-markup";',
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
    expect(surface).toContain("onDone(history.marks, history.rotation)");
    // The editor's photo rows carry the ticket's marks and rotation so the canvas can draw them.
    const fns = read("src/lib/documents.functions.ts");
    expect(fns).toContain("const { marks, rotation } = parsePhotoMarkup(r.annotations);");
    expect(fns).toMatch(/marks,\s*rotation,\s*itemKey: r\.item_key,/);
  });
  it("the server fills __inspection for an inspection ticket, on create and on Refresh data", () => {
    const fns = read("src/lib/documents.functions.ts");
    expect(fns).toContain(
      'if (row.service_type === "inspection") inspection = await loadInspection(sb, row);',
    );
    expect(fns).toContain("inspectionSnapshotFrom(");
    expect(fns).toContain('.eq("role", "other")');
    expect(fns).toContain('.is("repair_id", null)');
    // Oct 28: every loose picture is read and its links (every item it is on) folded in, so a
    // photo on two items is listed under both.
    expect(fns).not.toContain('.not("item_key", "is", null)');
    expect(fns).toContain("await withPhotoLinks(sb, photos.data ?? []),");
    expect(fns).toContain('.from("service_job_photo_items")');
    expect(fns).toContain("return withItemKeys(photos, links ?? []);");
    expect(fns).toMatch(/const snapshot = \(src: DocumentSource\) =>\s*withStoredInspection\(/);
    expect(fns).toContain("missingDefaultTemplates(all ?? [])");
    // Refresh data goes through the same snapshot.
    const refresh = fns.slice(fns.indexOf("export const refreshDocumentVariables"));
    expect(refresh).toContain("const variables = snapshot(loaded.source);");
  });
});

describe("Photos and Marks on photos are view switches (owner, Oct 28)", () => {
  const picker = read("src/components/documents/editor/photo-picker.tsx");
  const helpers = read("src/lib/documents/editor-helpers.ts");
  it("the canvas hides every picture while Photos is off: the picture modules show one muted line in their place, Photo on left / right keeps its text full width", () => {
    const body = moduleView.slice(
      moduleView.indexOf("function ModuleBody("),
      moduleView.indexOf("function PicturesHidden("),
    );
    expect(body).toContain("if (!env.options.photos) {");
    expect(body).toMatch(
      /case "fullPhoto":\s*case "twoPhotos":\s*case "photoGrid":\s*return <PicturesHidden \/>;/,
    );
    expect(body).toMatch(
      /case "photoLeft":\s*case "photoRight":\s*return <PhotoText m=\{m\} set=\{set\} hidden \/>;/,
    );
    expect(moduleView).toContain("data-photos-hidden");
    expect(moduleView).toContain("{PHOTOS_OFF_HINT}");
    expect(helpers).toContain(
      'PHOTOS_OFF_HINT = "Pictures are hidden — Photos is off for this document"',
    );
    const photoText = moduleView.slice(
      moduleView.indexOf("function PhotoText("),
      moduleView.indexOf("function TwoPhotos("),
    );
    expect(photoText).toMatch(
      /if \(hidden\)\s*return \(\s*<div className="space-y-2">\s*<PicturesHidden \/>\s*<RichText/,
    );
    // Dark mode on the new surface (the white paper).
    expect(moduleView).toMatch(
      /data-photos-hidden[\s\S]{0,400}dark:text-neutral-500|dark:text-neutral-500[\s\S]{0,400}data-photos-hidden/,
    );
  });
  it("the Mark up pencil is disabled with its tooltip while Marks is off; the picture draws no marks; the With-marks switch is the picture's own choice", () => {
    expect(picker).toContain("const marksOff = !env.options.marks;");
    expect(picker).toContain('title={marksOff ? MARKS_OFF_HINT : "Mark up"}');
    expect(picker).toContain("disabled={marksOff}");
    expect(picker).toMatch(/onDoubleClick=\{\s*can && !marksOff && props\.doubleClick/);
    expect(picker).toContain("if (!marksOff) setOpen(true);");
    expect(helpers).toContain('MARKS_OFF_HINT = "Marks are off for this document"');
    expect(picker).toContain("const marks = imageMarks(image, env.photos, env.options.marks);");
    expect(picker).not.toContain("marksAllowed");
    expect(picker).toContain('props.value?.kind === "ticketPhoto" ? props.value.marks : true,');
    expect(picker).toMatch(
      /props\.onPick\(\{\s*kind: "ticketPhoto",\s*photoId: p\.id,\s*marks: marks && p\.hasMarks,?\s*\}\)/,
    );
  });
  it("the four checkboxes keep their labels and carry a title each, in the editor and the New document dialog", () => {
    expect(helpers).toContain('prices: "With prices: pricing tables show their figures"');
    expect(helpers).toContain('photos: "Show or hide every picture in this document"');
    expect(helpers).toContain(
      'marks: "Show or hide the circles, arrows and text drawn on pictures"',
    );
    expect(helpers).toContain('footer: "Footer: the footer and the dotted page-break line"');
    for (const src of [route, newDialog])
      for (const k of ["prices", "photos", "marks", "footer"])
        expect(src).toContain(`title={OPTION_HINTS.${k}}`);
    expect(route).toContain("\n            With prices\n");
    expect(route).toContain("\n            Photos\n");
    expect(route).toContain("\n            Marks on photos\n");
    expect(route).toContain("\n            Footer\n");
    // The reducer applies only the price mode to the pages; the rest are read where they draw.
    expect(read("src/components/documents/editor/editor-state.ts")).toContain(
      "const flipped = options.prices !== state.options.prices;",
    );
    expect(read("src/lib/documents/model.ts")).not.toContain("stripMarks(");
    expect(read("src/lib/documents/model.ts")).not.toContain("isPhotoModule");
  });
});

describe("Start over from template… follows through (Oct 28)", () => {
  it("the pick dispatches startOver with the template; the label reads the state's template; the save sends templateId", () => {
    expect(route).toContain(
      'onPick={(pages, template) => dispatch({ type: "startOver", pages, template })}',
    );
    expect(route).toContain("templateName={state.template?.name ?? null}");
    expect(route).not.toContain("templateName={bundle.templateName}");
    expect(route).toContain(
      "props.onPick(instantiatePages(t.pages, props.options), { id: t.id, name: t.name });",
    );
    // The first load carries the document's template (the name the bundle looked up).
    expect(route).toContain('? { id: doc.template_id, name: bundle.templateName ?? "Template" }');
    const fns = read("src/lib/documents.functions.ts");
    expect(fns).toContain("templateId: z.string().uuid().nullable().optional(),");
    expect(fns).toContain("...(templateChanged ? { template_id: next.templateId ?? null } : {}),");
    expect(fns).toContain(
      'if (t.kind !== row.kind) throw new Error("That template is for the other kind of record");',
    );
  });
});
