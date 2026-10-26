/**
 * The rich text box a module's text is edited in: TipTap 3 with only what we print (paragraphs,
 * headings 1–3, bold / italic / underline, bullet and numbered lists, line breaks, undo, text
 * alignment) plus the "variable" chip — an inline atom node whose attrs.key names a merge field;
 * on screen it prints the resolved value (or [Label] when the record has none) and deletes as
 * one unit. Typing "/" opens the variable list (the kind's defs filtered by what follows; Enter
 * or a click inserts). A small toolbar shows while the box has focus.
 *
 * The editor is created once per mounted box (the content prop is read on mount only; the
 * module id keys the component), and onChange emits editor.getJSON() as the module's RichDoc.
 */
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type Editor,
  EditorContent,
  Extension,
  type JSONContent,
  mergeAttributes,
  Node,
  NodeViewWrapper,
  type ReactNodeViewProps,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Underline as UnderlineIcon,
} from "lucide-react";

import { chipText, filterVariables, variableNodeJson } from "@/lib/documents/editor-helpers";
import { type RichDoc, VARIABLE_NODE } from "@/lib/documents/model";
import { type VariableDef, variableDefs, variableLabel } from "@/lib/documents/variables";
import { cn } from "@/lib/utils";

import { useEditorEnvOptional } from "./editor-context";

// ------------------------------------------------------------------------- the variable chip

function VariableChip({ node }: ReactNodeViewProps) {
  const env = useEditorEnvOptional();
  const key = String(node.attrs["key"] ?? "");
  const text = chipText(key, env?.variables ?? {});
  const blank = !env?.variables[key];
  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        "doc-chip inline rounded-sm px-0.5 align-baseline",
        blank
          ? "bg-amber-100 text-amber-900 dark:bg-amber-100 dark:text-amber-900"
          : "bg-sky-100 dark:bg-sky-100",
      )}
      title={variableLabel(key)}
      data-variable-key={key}
      contentEditable={false}
    >
      {text}
    </NodeViewWrapper>
  );
}

/** The "variable" inline atom (model.ts VARIABLE_NODE), stored as `{ type: "variable", attrs: { key } }`. */
export const VariableNode = Node.create({
  name: VARIABLE_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      key: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-key") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-key": String(attrs["key"] ?? ""),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-variable]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-variable": "" }, HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(VariableChip);
  },
});

// -------------------------------------------------------------------------- the slash command

export interface SlashState {
  items: VariableDef[];
  index: number;
  rect: DOMRect | null;
  pick: (d: VariableDef) => void;
}

interface SlashOptions {
  defs: () => VariableDef[];
  onState: (s: SlashState | null) => void;
}

/** "/" lists the kind's variables, filtered by what is typed after it; Enter / click inserts the chip. */
const SlashVariables = Extension.create<SlashOptions>({
  name: "slashVariables",
  addOptions() {
    return { defs: () => [], onState: () => undefined };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    let index = 0;
    let current: SuggestionProps<VariableDef, VariableDef> | null = null;
    const emit = () => {
      if (!current) {
        opts.onState(null);
        return;
      }
      const p = current;
      opts.onState({
        items: p.items,
        index,
        rect: p.clientRect?.() ?? null,
        pick: (d) => p.command(d),
      });
    };
    return [
      Suggestion<VariableDef, VariableDef>({
        editor: this.editor,
        char: "/",
        allowSpaces: true,
        items: ({ query }) => filterVariables(query, opts.defs()).slice(0, 12),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(variableNodeJson(props.key))
            .run();
        },
        render: () => ({
          onStart: (p) => {
            index = 0;
            current = p;
            emit();
          },
          onUpdate: (p) => {
            current = p;
            index = Math.min(index, Math.max(0, p.items.length - 1));
            emit();
          },
          onExit: () => {
            current = null;
            emit();
          },
          onKeyDown: ({ event }) => {
            if (!current) return false;
            const n = current.items.length;
            if (event.key === "ArrowDown") {
              index = n ? (index + 1) % n : 0;
              emit();
              return true;
            }
            if (event.key === "ArrowUp") {
              index = n ? (index - 1 + n) % n : 0;
              emit();
              return true;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              const d = current.items[index];
              if (!d) return false;
              current.command(d);
              return true;
            }
            if (event.key === "Escape") {
              current = null;
              emit();
              return true;
            }
            return false;
          },
        }),
      }),
    ];
  },
});

function SlashMenu({ state }: { state: SlashState }) {
  if (typeof document === "undefined") return null;
  const left = state.rect ? state.rect.left : 0;
  const top = state.rect ? state.rect.bottom + 4 : 0;
  return createPortal(
    <div
      className="fixed z-50 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
      style={{ left, top }}
      role="listbox"
    >
      {state.items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">No variable matches</div>
      ) : (
        state.items.map((d, i) => (
          <button
            key={d.key}
            type="button"
            role="option"
            aria-selected={i === state.index}
            className={cn(
              "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent",
              i === state.index && "bg-accent",
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              state.pick(d);
            }}
          >
            <span>{d.label}</span>
            <span className="truncate text-xs text-muted-foreground">{d.group}</span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------------------- the toolbar

function ToolButton(props: {
  title: string;
  active?: boolean | undefined;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active ?? false}
      className={cn(
        "rounded p-1 hover:bg-accent hover:text-accent-foreground",
        props.active && "bg-accent text-accent-foreground",
      )}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      left: e.isActive({ textAlign: "left" }),
      center: e.isActive({ textAlign: "center" }),
      right: e.isActive({ textAlign: "right" }),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div
      className="absolute -top-8 right-0 z-20 flex items-center gap-0.5 rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md"
      role="toolbar"
      aria-label="Text formatting"
    >
      <ToolButton title="Bold (Ctrl+B)" active={s.bold} onClick={() => c().toggleBold().run()}>
        <Bold className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        title="Italic (Ctrl+I)"
        active={s.italic}
        onClick={() => c().toggleItalic().run()}
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        title="Underline (Ctrl+U)"
        active={s.underline}
        onClick={() => c().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolButton>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <ToolButton
        title="Heading 1"
        active={s.h1}
        onClick={() => c().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        title="Heading 2"
        active={s.h2}
        onClick={() => c().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-3.5 w-3.5" />
      </ToolButton>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <ToolButton title="Bullets" active={s.bullet} onClick={() => c().toggleBulletList().run()}>
        <List className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        title="Numbered list"
        active={s.ordered}
        onClick={() => c().toggleOrderedList().run()}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolButton>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <ToolButton title="Align left" active={s.left} onClick={() => c().setTextAlign("left").run()}>
        <AlignLeft className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        title="Align center"
        active={s.center}
        onClick={() => c().setTextAlign("center").run()}
      >
        <AlignCenter className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        title="Align right"
        active={s.right}
        onClick={() => c().setTextAlign("right").run()}
      >
        <AlignRight className="h-3.5 w-3.5" />
      </ToolButton>
    </div>
  );
}

// ------------------------------------------------------------------------------- the editor

export function RichText(props: {
  /** Read on mount only — key the component by the module id. */
  value: RichDoc;
  onChange: (doc: RichDoc) => void;
  placeholder?: string | undefined;
  className?: string | undefined;
}) {
  const env = useEditorEnvOptional();
  const kind = env?.kind ?? "bid";
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const envRef = useRef(env);
  envRef.current = env;
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [focused, setFocused] = useState(false);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        link: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false,
        heading: { levels: [1, 2, 3] },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      VariableNode,
      SlashVariables.configure({ defs: () => variableDefs(kind), onState: setSlash }),
    ],
    [kind],
  );

  const editor = useEditor(
    {
      extensions,
      // RichDoc is ProseMirror JSON; TipTap's Content type is the same shape without `undefined`.
      content: props.value as unknown as JSONContent,
      immediatelyRender: false,
      editorProps: {
        attributes: { class: "doc-prose min-h-[1.5em] outline-none" },
      },
      onUpdate: ({ editor: e }) => onChangeRef.current(e.getJSON() as RichDoc),
      onFocus: ({ editor: e }) => {
        setFocused(true);
        envRef.current?.setActiveEditor(e);
      },
      onBlur: () => setFocused(false),
    },
    // Created once per mounted box: the parent re-renders on every keystroke elsewhere.
    [],
  );

  const empty = editor ? editor.isEmpty : false;
  return (
    <div className={cn("relative", props.className)}>
      {editor && focused ? <Toolbar editor={editor} /> : null}
      {empty && props.placeholder && !focused ? (
        <div className="pointer-events-none absolute left-0 top-0 text-neutral-400 select-none">
          {props.placeholder}
        </div>
      ) : null}
      <EditorContent editor={editor} />
      {slash && focused ? <SlashMenu state={slash} /> : null}
    </div>
  );
}

/** Insert a variable chip at the cursor of an editor (the Variables tab row click). */
export function insertVariable(editor: Editor | null, key: string): boolean {
  if (!editor || editor.isDestroyed) return false;
  editor.chain().focus().insertContent(variableNodeJson(key)).run();
  return true;
}
