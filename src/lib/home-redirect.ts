/**
 * How the bare address "/" answers (Nov 10, the speed pass, finding 13: "/ answers with a
 * redirect to Work Overview, one extra round trip").
 *
 * The hop itself cannot go without changing what the address shows: "/" has no page of its own,
 * and drawing Work Overview there would leave two addresses for one page (the menu, the Back
 * button and every ?view / ?who link are written for /my-work). What can go is the ASKING: the
 * redirect is the same for every person — a technician-only user is sent on to My tickets by
 * the gate in the browser, not by the server — so the browser may remember it.
 *
 *  - 301 with `Cache-Control: private, max-age` for a week: after the first open, "/" goes to
 *    Work Overview without a request. `private`: the person's browser only, no shared cache.
 *    A week, not for ever: should "/" ever mean something else, browsers catch up in days.
 *  - the home-screen icon opens /my-work directly (public/manifest.webmanifest start_url), so a
 *    newly added icon never asks at all. An icon added before Nov 10 keeps opening "/" and
 *    gets the remembered redirect.
 */
export const HOME_REDIRECT_MAX_AGE_S = 7 * 24 * 60 * 60;

export const HOME_REDIRECT = {
  statusCode: 301,
  headers: { "Cache-Control": `private, max-age=${HOME_REDIRECT_MAX_AGE_S}` },
} as const;
