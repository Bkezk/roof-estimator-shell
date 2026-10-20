/**
 * The pathname of what the router's Outlet is RENDERING (owner, Oct 20, the third audit).
 *
 * The AuthGate decides from a pathname — the sign-in screen renders bare, every other page inside
 * the shell, a page the person may not open redirects home — and the Outlet beside it renders the
 * committed matches. The two must come from the same router commit: `location` moves the moment a
 * navigation starts (the Outlet still holds the page being left), and `resolvedLocation` moves in
 * a layout effect AFTER the commit that renders the new matches (react-router's Transitioner), so
 * either one leaves a committed render where the gate's decision is for one page and the Outlet
 * shows another — the destination of a sign-in rendered once bare (no shell, no TooltipProvider),
 * or the page being left rendered once outside the shell on the way to /login.
 *
 * The committed matches move in the same store batch the Outlet reads (router-core `setMatches`),
 * so the leaf match's pathname is the Outlet's page in every commit. Before the first commit (an
 * empty match list) the location is right.
 */
export function committedPathname(state: {
  matches: ReadonlyArray<{ pathname: string }>;
  location: { pathname: string };
}): string {
  const leaf = state.matches[state.matches.length - 1];
  return leaf?.pathname ?? state.location.pathname;
}
