/**
 * The takeoff list's cards open on a click anywhere on them (owner: "similar to other menus"),
 * not only on Open — but the card's own buttons and links keep doing only their own thing.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CARD_CONTROL_SELECTOR, cardOpenProps, startedOnControl, type CardNode } from "./card-open";

/** A minimal DOM node: a parent chain; `control` marks what CARD_CONTROL_SELECTOR matches. */
class Node implements CardNode {
  constructor(
    readonly name: string,
    readonly parent: Node | null = null,
    readonly control = false,
  ) {}
  contains(other: CardNode | null): boolean {
    for (let n = other as Node | null; n; n = n.parent) if (n === this) return true;
    return false;
  }
  closest(selector: string): Node | null {
    expect(selector).toBe(CARD_CONTROL_SELECTOR);
    if (this.control) return this;
    return this.parent ? this.parent.closest(selector) : null;
  }
}

// The card is itself role="link", so `closest` from its plain content finds the card.
const body = new Node("body");
const card = new Node("card", body, true);
const text = new Node("file name", new Node("row", card));
const badge = new Node("Locked badge", card);
const openBtn = new Node("Open", card, true);
const openIcon = new Node("svg", openBtn);
const delBtn = new Node("Delete", card, true);
const bidLink = new Node("bid link", new Node("p", card), true);
const portal = new Node("dialog button", body, true);

const click = (target: Node, extra: Partial<MouseEvent> = {}) =>
  ({ target, currentTarget: card, defaultPrevented: false, ...extra }) as never;
const key = (target: Node, k: string) => ({
  target,
  currentTarget: card,
  key: k,
  preventDefault: vi.fn(),
});

describe("a takeoff card opens on a click anywhere on it", () => {
  it("the card's own surface opens it: its text, a badge, the padding", () => {
    for (const t of [card, text, badge]) expect(startedOnControl(click(t))).toBe(false);
    const open = vi.fn();
    const p = cardOpenProps(open);
    p.onClick(click(text));
    p.onClick(click(badge));
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith(false);
  });

  it("Open, Delete, the bid / customer links, and portalled dialogs do not also open it", () => {
    for (const t of [openBtn, openIcon, delBtn, bidLink, portal])
      expect(startedOnControl(click(t))).toBe(true);
    const open = vi.fn();
    const p = cardOpenProps(open);
    for (const t of [openBtn, openIcon, delBtn, bidLink, portal]) p.onClick(click(t));
    expect(open).not.toHaveBeenCalled();
  });

  it("Ctrl / Cmd + click asks for a new tab", () => {
    const open = vi.fn();
    cardOpenProps(open).onClick(click(text, { ctrlKey: true }));
    cardOpenProps(open).onClick(click(text, { metaKey: true }));
    expect(open.mock.calls).toEqual([[true], [true]]);
  });

  it("keyboard: focusable, Enter / Space on the card open it; on a button inside, they do not", () => {
    const open = vi.fn();
    const p = cardOpenProps(open);
    const enter = key(card, "Enter");
    p.onKeyDown(enter as never);
    expect(enter.preventDefault).toHaveBeenCalled();
    p.onKeyDown(key(card, " ") as never);
    expect(open).toHaveBeenCalledTimes(2);
    p.onKeyDown(key(delBtn, "Enter") as never);
    p.onKeyDown(key(card, "a") as never);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("renders as a focusable link", () => {
    const html = renderToStaticMarkup(
      createElement("div", { ...cardOpenProps(() => {}), className: "cursor-pointer" }, "x"),
    );
    expect(html).toBe('<div role="link" tabindex="0" class="cursor-pointer">x</div>');
  });
});
