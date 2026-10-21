import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { MyWorkPage } from "@/components/my-work-page";
import { homeFor, isAdmin, isFieldOnly } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import {
  nextWorkSearch,
  parseBucketPreset,
  parseMonthParam,
  parseViewParam,
  resolveWho,
  type BucketPreset,
  type WorkViewParam,
  type WorkViewUrl,
} from "@/lib/my-work";

export const Route = createFileRoute("/my-work")({
  head: () => ({ meta: [{ title: "Work Overview — JBK Portal" }] }),
  // Every signed-in user (pageForPath: /my-work → null) and everyone's landing page (homeFor).
  // ?view=calendar opens the month calendar (the list otherwise). ?view=owner was the Owner view
  // until Oct 21 ("owner should be its own tab"): it is still read, and an old link or bookmark
  // is sent on to /owner (admins; the People tab) or lands on the List without it (anyone else).
  // ?who=mine | all | <profile id> is the "Show" picker of admins and
  // managers — the server ignores it for anyone else. Without ?who the page shows the caller's
  // default (defaultWho: Everyone for admins and managers, owner Oct 1; Mine for anyone else), so
  // ?who=mine is kept in the URL when an admin or manager picks Mine. ?bucket=today|overdue
  // presets the List to one group (the Owner view's links). ?month=YYYY-MM is the Calendar's
  // month (owner, Oct 15), kept while switching views so it survives List ↔ Calendar and Back.
  // Owner, Oct 15: without ?view / ?who the page opens on the view and the person the user last
  // picked (remembered on their profile with the layout; lib/work-layout.ts landingSearch), so
  // the page gets the URL's values as they are — absent when absent — and resolves them itself.
  // An explicit ?view=list is kept too (Oct 15): the Owner view's number links say so, and the
  // remembered "owner" must not win over it (landingSearch treats any URL view as final) — and
  // the page's own navigations keep it explicit (Oct 20, nextWorkSearch: the first one used to
  // drop it, and the remembered view bounced the admin off the List). The same for an explicit
  // ?who since Oct 21, ?who=all included: the totals row's link named Everyone, the next tap
  // dropped it as the default, and the remembered person took over.
  validateSearch: (s: Record<string, unknown>): MyWorkSearch => {
    const view = parseViewParam(s["view"]);
    const who = s["who"];
    const bucket = parseBucketPreset(s["bucket"]);
    const month = parseMonthParam(s["month"]);
    return {
      ...(view ? { view } : {}),
      ...(typeof who === "string" && who ? { who: who.slice(0, 64) } : {}),
      ...(bucket ? { bucket } : {}),
      ...(month ? { month } : {}),
    };
  },
  component: MyWorkRoute,
});

type MyWorkSearch = {
  // Oct 21: WorkViewUrl, not WorkViewParam — the URL may still say "owner" (redirected below).
  view?: WorkViewUrl;
  who?: string;
  bucket?: BucketPreset;
  month?: string;
};

function MyWorkRoute() {
  const { view, who, bucket, month } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { profile, session, refreshProfile } = useAuth();
  // Oct 20: landed here signed in but without a profile (homeFor(null) after the profile read
  // failed — a technician-only user's page is My tickets, which needs the profile to say so):
  // ask for it once more.
  const refreshed = useRef(false);
  useEffect(() => {
    if (!session || profile || refreshed.current) return;
    refreshed.current = true;
    void refreshProfile();
  }, [profile, refreshProfile, session]);
  // A technician-only user's page is My tickets (owner, Oct 15; homeFor): the sidebar has no
  // Work Overview for them, and an old link or the sign-in redirect lands there instead.
  if (isFieldOnly(profile)) return <Navigate to={homeFor(profile)} replace />;
  // Oct 21: the Owner view is its own page now. An old link (/my-work?view=owner) goes on to
  // its People tab for an admin; anyone else — whom the view never showed — lands on the List with
  // the rest of the search kept and the view dropped. Until the profile is here nothing is
  // decided (the gate does not block Work Overview on a missing profile, and an admin's bookmark
  // must not be dropped before their role is known): the List renders meanwhile (`pageView`).
  if (view === "owner" && profile)
    return isAdmin(profile) ? (
      <Navigate to="/owner" search={{}} replace />
    ) : (
      <Navigate
        to="/my-work"
        search={{
          ...(who ? { who } : {}),
          ...(bucket ? { bucket } : {}),
          ...(month ? { month } : {}),
        }}
        replace
      />
    );
  // The view the page gets: "owner" is no view of Work Overview — nothing, so the List or the
  // remembered Calendar shows while the redirect above waits for the profile.
  const pageView: WorkViewParam | null = view === "owner" ? null : (view ?? null);
  // The URL's own values, for the next URL: no ?view reads as the list and no ?who as the
  // caller's default here (the page applies the remembered ones when the URL is silent, and a
  // search without them keeps letting it).
  const curView: WorkViewParam = pageView ?? "list";
  // No ?who: Everyone for admins and managers, Mine for anyone else (defaultWho).
  const curWho = resolveWho(who, profile);
  // Whether the URL named them (Oct 20 for the view, Oct 21 for the person): a value the URL
  // named stays named on every in-page navigation, the default included — otherwise the URL
  // falls silent and the page applies the remembered one instead (landingSearch).
  const viewExplicit = view !== undefined;
  const whoExplicit = who !== undefined;
  /**
   * The search without default keys (the caller's default `who`, no preset off the List; the
   * rule is lib/my-work.ts nextWorkSearch). "list" is dropped only when the URL was silent on
   * the view; a URL that named it — an Owner-view link, ?view=list included — keeps naming it.
   * The same for `who` (Oct 21: ?who=all from the totals row's link was dropped on the next tap
   * and the remembered person came back); `whoNamed` is true for a pick from the Show menu
   * whatever the URL had, since a pick while peeking is not remembered on the layout.
   */
  const searchOf = (
    v: WorkViewParam,
    w: string,
    b?: BucketPreset | null,
    m?: string | null,
    whoNamed = whoExplicit,
  ): MyWorkSearch =>
    nextWorkSearch({ view: v, who: w, bucket: b, month: m }, profile, viewExplicit, whoNamed);
  return (
    <MyWorkPage
      view={pageView}
      who={who ?? null}
      month={month ?? null}
      bucket={bucket ?? null}
      onView={(v) => void navigate({ search: searchOf(v, curWho, null, month), replace: true })}
      onWho={(w) =>
        void navigate({ search: searchOf(curView, w, bucket, month, true), replace: true })
      }
      onMonth={(m) =>
        void navigate({ search: searchOf(curView, curWho, bucket, m), replace: true })
      }
      onBucket={(b) =>
        void navigate({ search: searchOf(curView, curWho, b, month), replace: true })
      }
    />
  );
}
