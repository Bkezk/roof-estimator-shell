/**
 * @mentions in ticket notes (service study M3, owner Oct 5).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { insertMention, mentionedIds, mentionQuery, suggestPeople } from "@/lib/mentions";

const people = [
  { id: "bk", name: "Brandon Keck" },
  { id: "gp", name: "Garry Peters" },
  { id: "rs", name: "RoAnna Sims" },
  { id: "mb", name: "Mark Barger" },
  { id: "m", name: "Mark" },
  { id: "tf", name: "Trace Floyd" },
];

describe("typing", () => {
  it("an @ at the start or after a space opens the list; an email address does not", () => {
    expect(mentionQuery("@", 1)).toEqual({ at: 0, query: "" });
    expect(mentionQuery("Still leaking @Bra", 18)).toEqual({ at: 14, query: "Bra" });
    expect(mentionQuery("mail jbk@flatroofonline.com", 27)).toBeNull();
    expect(mentionQuery("no mention here", 15)).toBeNull();
  });
  it("closes on a new line or a long run", () => {
    expect(mentionQuery("@Bra\nnext", 9)).toBeNull();
    expect(mentionQuery("@one two three four", 19)).toBeNull();
  });
  it("suggests by first or last name, A–Z, at most 6", () => {
    expect(suggestPeople(people, "ke").map((p) => p.id)).toEqual(["bk"]);
    expect(suggestPeople(people, "mar").map((p) => p.id)).toEqual(["m", "mb"]);
    expect(suggestPeople(people, "")).toHaveLength(6);
  });
  it("picking writes '@Full Name ' and moves the caret past it", () => {
    expect(insertMention("Still leaking @Bra", 14, 18, "Brandon Keck")).toEqual({
      text: "Still leaking @Brandon Keck ",
      caret: 28,
    });
  });
});

describe("who a saved note mentions", () => {
  it("everyone named after an @, once each, in order, any case", () => {
    expect(
      mentionedIds(
        "Notes just say HVAC issues maybe we should have Mark go look @brandon keck @Garry Peters @Brandon Keck",
        people,
      ),
    ).toEqual(["bk", "gp"]);
  });
  it("the longer name wins: '@Mark Barger' is not '@Mark'; '@Mark' alone is Mark", () => {
    expect(mentionedIds("ask @Mark Barger", people)).toEqual(["mb"]);
    expect(mentionedIds("ask @Mark, then @Trace Floyd.", people)).toEqual(["m", "tf"]);
  });
  it("a name must stand alone: '@Marks' and 'x@Mark' are no one", () => {
    expect(mentionedIds("@Marks truck", people)).toEqual([]);
    expect(mentionedIds("x@Mark", people)).toEqual([]);
  });
});

describe("saving the note", () => {
  const fns = readFileSync("src/lib/service-field.functions.ts", "utf8");
  const body = fns.slice(
    fns.indexOf("export const addJobNote"),
    fns.indexOf("export const recentRepairsForJob"),
  );
  it("notifies the people named, never the writer, with a link to the ticket", () => {
    expect(body).toContain("mentionedIds(data.note, people).filter((id) => id !== context.userId)");
    expect(body).toContain('kind: "mention"');
    expect(body).toContain("mentioned you on Ticket #${job.number}");
    expect(body).toContain("url: `/service?id=${job.id}`");
  });
  it("a delivery problem is loud and says the note itself was added", () => {
    expect(body).toContain("Note added, but the mentions were not sent:");
  });
});

describe("the note box", () => {
  const src = readFileSync("src/components/service/ticket-field-sections.tsx", "utf8");
  it("suggests people on @ and says who was told", () => {
    expect(src).toContain('aria-label="People to mention"');
    expect(src).toContain("type @ to tell someone");
    expect(src).toContain("Note added — told");
  });
});
