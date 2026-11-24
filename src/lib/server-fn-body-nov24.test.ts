// Nov 24 (public pages audit, B5): a call to one of the site's server functions with JSON that
// no page sends is answered with a plain HTTP 400 "Bad request", before the framework reads it.
// Proven on a local server the same day: such a body got 400 "Bad request" as plain text, a
// page's own packed body went on to the function, and a call from another site was still 403.
import { readFileSync } from "node:fs";
import { createClientRpc } from "@tanstack/react-start/client-rpc";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { describe, expect, it } from "vitest";

import {
  BAD_REQUEST_BODY,
  badRequest,
  isServerFnPayload,
  refuseBadServerFnBody,
} from "@/lib/server-fn-body";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const URL_ = "https://site.example/_serverFn/abc";
const post = (body: string | null, type: string | null = "application/json") =>
  new Request(URL_, {
    method: "POST",
    ...(body === null ? {} : { body }),
    headers: type ? { "content-type": type } : {},
  });

/** A page's own packed call, as the framework writes it: `{ data: null }`. */
const PACKED = '{"t":{"t":10,"i":0,"p":{"k":["data"],"v":[{"t":2,"s":0}]},"o":0},"f":127,"m":[]}';

/** What one answer looks like from outside. */
const seen = async (r: Response | null) =>
  r && { status: r.status, type: r.headers.get("content-type"), body: await r.text() };
const REFUSED = { status: 400, type: "text/plain; charset=utf-8", body: "Bad request" };

describe("which JSON is a page's own packed call", () => {
  it("one object whose `t` is an object with a number `t`", () => {
    expect(isServerFnPayload(PACKED)).toBe(true);
    expect(isServerFnPayload('{"t":{"t":10}}')).toBe(true);
  });
  it("nothing else", () => {
    for (const s of [
      "",
      "this is not json",
      "{",
      "null",
      "123",
      '"text"',
      "[]",
      "[1,2]",
      "{}",
      '{"a":1}',
      '{"t":5,"f":0,"m":[]}',
      '{"t":null}',
      '{"t":[]}',
      '{"t":{}}',
      '{"t":{"t":"10"}}',
      '{"data":{"name":"x"}}',
    ])
      expect(isServerFnPayload(s), s).toBe(false);
  });
});

describe("a server function call with JSON no page sends", () => {
  it("is answered 400 'Bad request' as plain text, with nothing of the framework in it", async () => {
    for (const body of ["this is not json", '{"a":1}', "[1,2]", '{"t":5,"f":0,"m":[]}', ""]) {
      const r = await seen(await refuseBadServerFnBody(post(body), "serverFn"));
      expect(r, JSON.stringify(body)).toEqual(REFUSED);
    }
    expect(BAD_REQUEST_BODY).toBe("Bad request");
    expect(await seen(badRequest())).toEqual(REFUSED);
  });

  it("the content type with a charset is JSON all the same", async () => {
    const r = await refuseBadServerFnBody(
      post("nope", "application/json; charset=utf-8"),
      "serverFn",
    );
    expect(await seen(r)).toEqual(REFUSED);
  });

  it("a GET with a `payload` no page sends is answered the same", async () => {
    const get = (qs: string) => new Request(`${URL_}${qs}`, { method: "GET" });
    expect(await seen(await refuseBadServerFnBody(get("?payload=garbage"), "serverFn"))).toEqual(
      REFUSED,
    );
    expect(
      await seen(
        await refuseBadServerFnBody(get(`?payload=${encodeURIComponent('{"a":1}')}`), "serverFn"),
      ),
    ).toEqual(REFUSED);
    // No payload, an empty one, and a page's own: all go on.
    expect(await refuseBadServerFnBody(get(""), "serverFn")).toBeNull();
    expect(await refuseBadServerFnBody(get("?payload="), "serverFn")).toBeNull();
    expect(
      await refuseBadServerFnBody(get(`?payload=${encodeURIComponent(PACKED)}`), "serverFn"),
    ).toBeNull();
  });
});

describe("what goes on to the function untouched", () => {
  it("a page's own packed body, and the body is still there for the framework to read", async () => {
    const req = post(PACKED);
    expect(await refuseBadServerFnBody(req, "serverFn")).toBeNull();
    expect(req.bodyUsed).toBe(false);
    expect(await req.text()).toBe(PACKED);
  });

  it("a call that sends nothing, a form upload, and anything that is not said to be JSON", async () => {
    expect(await refuseBadServerFnBody(post(null, null), "serverFn")).toBeNull();
    const form = new FormData();
    form.set("file", "x");
    expect(
      await refuseBadServerFnBody(new Request(URL_, { method: "POST", body: form }), "serverFn"),
    ).toBeNull();
    expect(
      await refuseBadServerFnBody(post("a=1", "application/x-www-form-urlencoded"), "serverFn"),
    ).toBeNull();
    expect(await refuseBadServerFnBody(post("garbage", "text/plain"), "serverFn")).toBeNull();
  });

  it("a request that is not a server function call is never looked at", async () => {
    const req = post("this is not json");
    expect(await refuseBadServerFnBody(req, "router")).toBeNull();
    expect(req.bodyUsed).toBe(false);
  });
});

describe("the shape is the installed framework's own", () => {
  // Real calls, made by the framework's own client, caught before they leave. If a newer
  // version of the framework ever packs a call differently, this fails here and not on the
  // live site.
  process.env["TSS_SERVER_FN_BASE"] = "https://site.example/_serverFn/";
  const sent = async (method: "GET" | "POST", data: unknown): Promise<Request> => {
    let caught: Request | null = null;
    const fetcher = (async (url: string, init: RequestInit) => {
      caught = new Request(url, init);
      throw new Error("caught before it left");
    }) as unknown as typeof fetch;
    const rpc = createClientRpc("abc") as unknown as (a: unknown) => Promise<unknown>;
    // Outside a browser the client looks its options up in the framework's request store.
    await runWithStartContext({ startOptions: {} } as never, () =>
      rpc({ method, data, headers: {}, context: {}, fetch: fetcher }).catch(() => {}),
    );
    if (!caught) throw new Error("the framework's client made no call");
    return caught;
  };
  const DATA: unknown[] = [
    { address: "1 Main St", size: 12000, when: new Date(0), list: [1, "a", null], deep: { a: 1 } },
    "just text",
    42,
    null,
    [],
    {},
    { plan_id: "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11" },
  ];

  it("every POST the framework's client sends goes on", async () => {
    for (const data of DATA) {
      const req = await sent("POST", data);
      expect(req.headers.get("content-type"), JSON.stringify(data)).toContain("application/json");
      expect(await refuseBadServerFnBody(req, "serverFn"), JSON.stringify(data)).toBeNull();
    }
    // A function that takes nothing: no body at all.
    const none = await sent("POST", undefined);
    expect(await refuseBadServerFnBody(none, "serverFn")).toBeNull();
  });

  it("every GET the framework's client sends goes on", async () => {
    for (const data of DATA) {
      const req = await sent("GET", data);
      expect(new URL(req.url).searchParams.get("payload"), JSON.stringify(data)).toBeTruthy();
      expect(await refuseBadServerFnBody(req, "serverFn"), JSON.stringify(data)).toBeNull();
    }
    expect(await refuseBadServerFnBody(await sent("GET", undefined), "serverFn")).toBeNull();
  });
});

describe("where it runs", () => {
  it("for every request, after the cross-site check, and nowhere in the framework itself", () => {
    const start = flat("src/start.ts");
    expect(start).toContain('import { refuseBadServerFnBody } from "./lib/server-fn-body";');
    expect(start).toContain(
      "return (await refuseBadServerFnBody(request, handlerType)) ?? next();",
    );
    expect(start).toContain(
      "requestMiddleware: [errorMiddleware, csrfMiddleware, serverFnBodyMiddleware],",
    );
  });
});
