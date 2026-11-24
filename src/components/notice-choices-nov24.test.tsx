/**
 * "Choose which" on My account (owner, Nov 24: "Option A on notifications plz"): under each of
 * the three switches with several notices, a list of ticks, closed until asked for.
 *
 * The list is rendered to a string (react-dom/server: it only shows and asks) and the page's
 * source is pinned: where the lists sit, how a tick saves, and what happens when it cannot.
 */
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NOTICE_TYPE_KEYS, typesOfCategory } from "@/lib/notice-types";

import { NoticeChoices } from "./notice-choices";

const noop = () => {};
const flat = (s: string) => s.replace(/\s+/g, " ");
const text = (html: string) =>
  html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((s) => s.replace(/&#x27;/g, "'").trim())
    .filter(Boolean);
const tags = (html: string, tag: string) => html.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? [];
const boxes = (html: string) => tags(html, "button").filter((b) => b.includes('role="checkbox"'));
/** The attribute of a tick that cannot be pressed (its classes always name "disabled:"). */
const LOCKED = ' disabled=""';

const render = (over: Partial<Parameters<typeof NoticeChoices>[0]> = {}) =>
  renderToString(
    <NoticeChoices category="service" switchOn off={[]} ready onChange={noop} {...over} />,
  );

describe("NoticeChoices", () => {
  it("is closed until asked for: the button, how many are off, and the list hidden", () => {
    const html = render();
    const [button] = tags(html, "button");
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('type="button"');
    // A thumb-sized button on a phone.
    expect(button).toContain("min-h-[44px]");
    expect(text(html).slice(0, 2)).toEqual(["Choose which", "All 15 on"]);
    const list = tags(html, "div").find((d) => d.includes("data-choices-list"))!;
    expect(list).toContain("hidden");
    expect(list).toContain('role="group"');
    expect(list).toContain('aria-label="Service notices: choose which"');
    // The button names the list it opens.
    const id = /aria-controls="([^"]+)"/.exec(button!)![1];
    expect(list).toContain(`id="${id}"`);
  });

  it("the line says how many are off, for this switch only", () => {
    expect(text(render({ off: ["service_scheduled", "service_deleted"] }))[1]).toBe("2 of 15 off");
    expect(text(render({ off: ["bids_steps", "junk"] }))[1]).toBe("All 15 on");
    expect(text(render({ category: "bids", off: ["bids_steps", "junk"] }))[1]).toBe("1 of 4 off");
    expect(text(render({ category: "opportunities" }))[1]).toBe("All 5 on");
  });

  it("opened: one tick per notice type, each a whole row at least 44 px tall, all on by default", () => {
    const html = render({ defaultOpen: true });
    expect(tags(html, "button")[0]).toContain('aria-expanded="true"');
    expect(tags(html, "div").find((d) => d.includes("data-choices-list"))).not.toContain("hidden");
    const rows = tags(html, "label");
    expect(rows).toHaveLength(15);
    for (const row of rows) {
      // In px, never rem: this site's rem is 13 px (styles.css), so min-h-11 measured 36 px
      // in the browser, and a row with two lines of words came to 42.
      expect(row).toContain("min-h-[44px]");
      expect(row).not.toContain("min-h-11");
      expect(row).toContain("cursor-pointer");
    }
    expect(rows.map((r) => /data-choice="([^"]+)"/.exec(r)![1])).toEqual(
      typesOfCategory("service").map((t) => t.key),
    );
    const ticks = boxes(html);
    expect(ticks).toHaveLength(15);
    for (const b of ticks) {
      expect(b).toContain('aria-checked="true"');
      expect(b).not.toContain(LOCKED);
    }
    // Each row's label is tied to its own tick.
    for (const [i, row] of rows.entries())
      expect(ticks[i]).toContain(`id="${/for="([^"]+)"/.exec(row)![1]}"`);
    // The words: the name of each tick and its one line.
    const words = text(html).slice(2);
    expect(words).toEqual(typesOfCategory("service").flatMap((t) => [t.label, t.help]));
  });

  it("what is off shows unticked; the rest stay ticked", () => {
    const html = render({ defaultOpen: true, off: ["service_scheduled", "service_closed"] });
    const state = Object.fromEntries(
      tags(html, "label").map((row, i) => [
        /data-choice="([^"]+)"/.exec(row)![1]!,
        /aria-checked="(\w+)"/.exec(boxes(html)[i]!)![1],
      ]),
    );
    expect(state["service_scheduled"]).toBe("false");
    expect(state["service_closed"]).toBe("false");
    expect(Object.values(state).filter((v) => v === "true")).toHaveLength(13);
  });

  it("while the switch itself is off: grey, locked, and the ticks kept as they were", () => {
    const html = render({ defaultOpen: true, switchOn: false, off: ["service_scheduled"] });
    expect(text(html)).toContain(
      "Service notices are off, so none of these are sent. Your ticks are kept for when you turn them back on.",
    );
    expect(tags(html, "ul")[0]).toContain("opacity-60");
    const ticks = boxes(html);
    for (const b of ticks) expect(b).toContain(LOCKED);
    for (const row of tags(html, "label")) expect(row).toContain("cursor-not-allowed");
    // Kept: still one unticked, fourteen ticked, and the line still counts it.
    expect(ticks.filter((b) => b.includes('aria-checked="false"'))).toHaveLength(1);
    expect(text(html)[1]).toBe("1 of 15 off");
    // With the switch on there is no such line and nothing is grey.
    const on = render({ defaultOpen: true });
    expect(on).not.toContain("data-choices-paused");
    expect(on).not.toContain("opacity-60");
  });

  it("locked until the list has been read, so a press can never save over what is kept", () => {
    const html = render({ defaultOpen: true, ready: false });
    for (const b of boxes(html)) expect(b).toContain(LOCKED);
    expect(html).not.toContain("data-choices-paused");
  });

  it("a switch with one notice has no list: leads and storms", () => {
    expect(render({ category: "leads" })).toBe("");
    expect(render({ category: "storms" })).toBe("");
  });

  it("the three lists together are every tick there is", () => {
    const keys = (["opportunities", "service", "bids"] as const).flatMap((category) =>
      tags(render({ category, defaultOpen: true }), "label").map(
        (r) => /data-choice="([^"]+)"/.exec(r)![1]!,
      ),
    );
    expect([...keys].sort()).toEqual([...NOTICE_TYPE_KEYS].sort());
  });
});

describe("the Account page", () => {
  const src = readFileSync("src/routes/account.tsx", "utf8");
  const page = flat(src);

  it("puts a list under every switch, fed by the switch's own state and the person's off list", () => {
    expect(page).toContain(
      "<NoticeChoices category={category} switchOn={p?.[column] ?? false} off={offList.data?.notify_off ?? []} ready={!!p && !!offList.data} onChange={pressChoice} />",
    );
    // Inside the loop over the five switches, after the switch row.
    const loop = page.slice(page.indexOf("{NOTICE_CATEGORIES.map((category) => {"));
    expect(loop.indexOf("<Switch")).toBeLessThan(loop.indexOf("<NoticeChoices"));
    expect(loop.indexOf("<NoticeChoices")).toBeLessThan(loop.indexOf('data-row="notify-own"'));
    // The five switches are as they were.
    expect(page).toContain("onCheckedChange={(v) => save.mutate({ [column]: v })}");
  });

  it("reads and saves the list by itself, so the switches do not wait on it", () => {
    expect(page).toContain('const OFF_KEY = ["notify-off"] as const;');
    expect(page).toContain(
      "const offList = useQuery({ queryKey: OFF_KEY, queryFn: () => getOffFn(), enabled: !!session });",
    );
    // The switches' own read is untouched, and an error of the list's read hides nothing.
    expect(page).toContain(
      "const prefs = useQuery({ queryKey: PREFS_KEY, queryFn: () => getFn(), enabled: !!session });",
    );
    expect(page).not.toContain("offList.isError");
  });

  it("a tick saves at once, like a switch; one that cannot be saved goes back and says why", () => {
    expect(page).toContain("mutationFn: (off: string[]) => setOffFn({ data: { off } }),");
    expect(page).toContain(
      "withNoticeChoice(qc.getQueryData<OffList>(OFF_KEY)?.notify_off ?? [], key, on)",
    );
    const save = page.slice(
      page.indexOf("const saveOff = useMutation({"),
      page.indexOf("const pressChoice"),
    );
    expect(save).toContain("qc.setQueryData<OffList>(OFF_KEY, { notify_off: off });");
    expect(save).toContain("if (ctx?.before) qc.setQueryData(OFF_KEY, ctx.before);");
    // One of two plain lines, never the browser's own words (a dropped connection read
    // "Failed to fetch" in the browser check).
    expect(save).toContain("toast.error(noticeChoiceFailure(e));");
    expect(save).not.toContain("errText(e)");
    // The bell follows the ticks at once.
    expect(save).toContain("void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });");
  });

  it("there is no screen to set somebody else's ticks", () => {
    const admin = readFileSync("src/lib/followups.functions.ts", "utf8");
    const fn = admin.slice(admin.indexOf("export const setNotifyOff"));
    expect(fn.slice(0, fn.indexOf("/** The public VAPID key"))).not.toMatch(
      /user_id|userId|p_user/,
    );
  });
});
