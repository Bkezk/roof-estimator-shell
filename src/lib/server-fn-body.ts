/**
 * A call to one of the site's own server functions with a body that is not one gets a plain
 * answer (Nov 24, the public pages audit): HTTP 400, the words "Bad request", and nothing else.
 *
 * The pages call server functions with JSON the framework itself wrote, in the body of a POST
 * or in the `payload` of a GET's address: always one object, whose `t` is an object that has a
 * number `t` of its own (the framework's packed form of the call's data). A page never sends
 * anything else, so JSON of any other shape did not come from a page. It is answered here,
 * before the framework reads it.
 *
 * Only what the framework would read as JSON is looked at. A call that sends nothing (a
 * function that takes nothing) and a form upload are passed on untouched.
 *
 * The shape is the installed framework's own: server-fn-body-nov24.test.ts sends real calls
 * through the framework's client and fails if a newer version ever packs them differently.
 *
 * Pure but for reading the request's body from a copy; src/start.ts runs it for every server
 * function call, after the cross-site check.
 */

export const BAD_REQUEST_BODY = "Bad request";

/** True when `text` is the packed JSON a page sends with a server function call. */
export function isServerFnPayload(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const node = (parsed as Record<string, unknown>)["t"];
  if (node === null || typeof node !== "object" || Array.isArray(node)) return false;
  return typeof (node as Record<string, unknown>)["t"] === "number";
}

export const badRequest = (): Response =>
  new Response(BAD_REQUEST_BODY, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

/**
 * The answer for a server function call whose JSON body is not a page's, or null to let the
 * call go on. `handlerType` is the framework's own word for what the request is for.
 */
export async function refuseBadServerFnBody(
  request: Request,
  handlerType: string,
): Promise<Response | null> {
  if (handlerType !== "serverFn") return null;
  const method = request.method.toUpperCase();
  if (method === "GET") {
    // A GET carries the same packed JSON in `payload`, or no `payload` at all.
    const payload = new URL(request.url).searchParams.get("payload");
    return !payload || isServerFnPayload(payload) ? null : badRequest();
  }
  if (method !== "POST") return null;
  // The framework reads the body as JSON exactly when the content type says so.
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return null;
  let text: string;
  try {
    // A copy: the framework still reads the body itself afterwards.
    text = await request.clone().text();
  } catch {
    return badRequest();
  }
  return isServerFnPayload(text) ? null : badRequest();
}
