/**
 * "Choose which" under a notice switch on My account (owner, Nov 24: "can you also add an
 * ability to select which notifications they want on more granularly like under ticket
 * notifications you can choose to be notified at open and closed but not scheduled?", then
 * "Option A on notifications plz").
 *
 * One tick per notice type of that switch (notice-types.ts). Closed until asked for, so the
 * page stays short; the line beside the button says how many are off. Each row is a whole
 * label at least 44 px tall, for a thumb. While the switch itself is off the list is grey and
 * cannot be changed, and the ticks are kept as they were.
 *
 * It only shows and asks: the page holds the list and saves it (routes/account.tsx).
 */
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { NOTICE_CATEGORY_LABELS, type NoticeCategory } from "@/lib/notice-categories";
import {
  NOTICE_CHOICES_BUTTON,
  cleanNotifyOff,
  noticeChoicesLine,
  noticeChoicesPausedLine,
  typesOfCategory,
} from "@/lib/notice-types";
import { cn } from "@/lib/utils";

export function NoticeChoices(props: {
  category: NoticeCategory;
  /** The switch above it: off greys the list and locks it. */
  switchOn: boolean;
  /** The person's off list as read (anything this site does not know is ignored). */
  off: readonly unknown[];
  /** The list has been read and can be saved. */
  ready: boolean;
  /** One tick pressed: `on` is what it should be now. */
  onChange: (key: string, on: boolean) => void;
  defaultOpen?: boolean;
}) {
  const { category, switchOn, ready } = props;
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const id = useId();
  const types = typesOfCategory(category);
  // One notice under the switch (leads, storms): the switch is the whole choice.
  if (types.length < 2) return null;
  const off = cleanNotifyOff(props.off);
  const editable = switchOn && ready;
  const panel = `${id}-list`;
  return (
    <div data-choices={category} className="mt-1">
      <div className="flex flex-wrap items-center gap-x-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen((o) => !o)}
          className="-ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:min-h-[32px]"
        >
          {NOTICE_CHOICES_BUTTON}
          <ChevronDown
            aria-hidden
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </button>
        <span className="text-xs text-muted-foreground" data-choices-line={category}>
          {noticeChoicesLine(category, off)}
        </span>
      </div>
      {/* Always in the page, hidden while closed, so the button's aria-controls names something. */}
      <div
        id={panel}
        hidden={!open}
        role="group"
        aria-label={`${NOTICE_CATEGORY_LABELS[category]}: choose which`}
        data-choices-list={category}
        data-locked={editable ? undefined : ""}
        className="rounded-md border"
      >
        {!switchOn && (
          <p className="border-b px-3 py-2 text-xs text-muted-foreground" data-choices-paused>
            {noticeChoicesPausedLine(category)}
          </p>
        )}
        <ul className={cn("divide-y", !switchOn && "opacity-60")}>
          {types.map((t) => {
            const box = `${id}-${t.key}`;
            return (
              <li key={t.key}>
                <label
                  htmlFor={box}
                  data-choice={t.key}
                  className={cn(
                    // In px: this site's rem is 13 px, so min-h-11 would be 36, not 44.
                    "flex min-h-[44px] items-center gap-3 px-3 py-2",
                    editable ? "cursor-pointer" : "cursor-not-allowed",
                  )}
                >
                  <Checkbox
                    id={box}
                    checked={!off.includes(t.key)}
                    disabled={!editable}
                    onCheckedChange={(v) => props.onChange(t.key, v === true)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm">{t.label}</span>
                    <span className="block text-xs text-muted-foreground">{t.help}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
