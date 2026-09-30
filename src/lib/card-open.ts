/**
 * A list card that opens on a click anywhere on it (owner, Sep 30: "similar to other menus" —
 * the bids list, the customers list): `role="link"`, focusable, Enter or Space opens it, Ctrl /
 * Cmd + click opens it in a new tab. A click or key press that starts on a control inside the card
 * (its Open / Delete buttons, the bid and customer links, a checkbox…) belongs to that control and
 * never also opens the card; neither does one from content React portals out of the card (a
 * dialog or menu opened from it is inside the card's React tree but outside its DOM).
 */
import type { KeyboardEvent, MouseEvent } from "react";

/** What counts as a control of its own inside a card. `data-card-ignore` opts anything else out. */
export const CARD_CONTROL_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  "[data-card-ignore]",
].join(", ");

/** The DOM surface this needs (lets the tests use plain objects). */
export interface CardNode {
  contains(other: CardNode | null): boolean;
  closest?(selector: string): CardNode | null;
}
export interface CardEvent {
  target: unknown;
  currentTarget: unknown;
}

/**
 * True when the event did NOT start on the card's own surface: on a control inside the card, or
 * outside the card's DOM (portalled content), or with no target at all.
 */
export function startedOnControl(e: CardEvent): boolean {
  const card = e.currentTarget as CardNode | null;
  const target = e.target as CardNode | null;
  if (!card || !target) return true;
  if (target === card) return false;
  if (!card.contains(target)) return true;
  const hit = target.closest?.(CARD_CONTROL_SELECTOR) ?? null;
  return hit !== null && hit !== card && card.contains(hit);
}

/** Props that make an element an openable card. `open(newTab)` does the navigation. */
export function cardOpenProps(open: (newTab: boolean) => void) {
  return {
    role: "link" as const,
    tabIndex: 0,
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (e.defaultPrevented || startedOnControl(e)) return;
      open(!!(e.ctrlKey || e.metaKey));
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      // Enter on a button or link inside the card is that control's own.
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      open(!!(e.ctrlKey || e.metaKey));
    },
  };
}
