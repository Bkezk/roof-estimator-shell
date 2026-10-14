/**
 * A note box that understands "@" (owner, Oct 14: "Is the note the only place to tag @'s?" — it
 * was). Typing "@" opens the list of people who can be mentioned (mention_options: admins,
 * managers, Service / Customers users); picking one writes "@Full Name " into the text. Enter or
 * Tab takes the first name while the list is open, Escape closes it. The server reads the names
 * back out of the saved text (lib/mention-notify.ts), so a pasted "@Brandon Keck" counts too.
 *
 * Used by the ticket Timeline note, the contact log's note, an opportunity's Notes and a
 * customer's Notes. `grow` makes it the auto-growing kind (AutoTextarea) a form uses.
 */
import { forwardRef, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/lib/auth-store";
import { listMentionPeople } from "@/lib/auth.functions";
import { insertMention, mentionQuery, suggestPeople } from "@/lib/mentions";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { Textarea } from "@/components/ui/textarea";

type Props = Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
  value: string;
  onValueChange: (text: string) => void;
  /** Grow with the text (a form field) instead of a fixed-height scrolling box. */
  grow?: boolean | undefined;
};

export const MENTION_HINT = "type @ to tell someone";

export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea(
  { value, onValueChange, grow, onKeyDown, onBlur, ...rest },
  forwardedRef,
) {
  const { session } = useAuth();
  const peopleFn = useServerFn(listMentionPeople);
  const peopleQ = useQuery({
    queryKey: ["mention-options"],
    queryFn: () => peopleFn(),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof forwardedRef === "function") forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null);
  const suggestions = mention ? suggestPeople(peopleQ.data ?? [], mention.query) : [];
  const typed = (text: string, caret: number) => {
    onValueChange(text);
    setMention(mentionQuery(text, caret));
  };
  const pick = (name: string) => {
    const box = innerRef.current;
    if (!mention || !box) return;
    const next = insertMention(value, mention.at, box.selectionStart ?? value.length, name);
    onValueChange(next.text);
    setMention(null);
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(next.caret, next.caret);
    });
  };
  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && mention) {
      setMention(null);
      return;
    }
    if ((e.key === "Enter" || e.key === "Tab") && suggestions[0]) {
      e.preventDefault();
      pick(suggestions[0].name);
      return;
    }
    onKeyDown?.(e);
  };
  const Box = grow ? AutoTextarea : Textarea;
  return (
    <div className="relative">
      <Box
        ref={setRefs}
        value={value}
        onChange={(e) => typed(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onKeyDown={keyDown}
        onBlur={(e) => {
          setTimeout(() => setMention(null), 150);
          onBlur?.(e);
        }}
        {...rest}
      />
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="People to mention"
          className="absolute left-0 top-full z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-md border bg-popover text-sm shadow-md"
        >
          {suggestions.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p.name);
                }}
              >
                @{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
