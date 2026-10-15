import { createFileRoute, Navigate } from "@tanstack/react-router";

import { MyWorkPage } from "@/components/my-work-page";
import { homeFor, isFieldOnly } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import {
  parseBucketPreset,
  parseMonthParam,
  parseViewParam,
  resolveWho,
  whoParam,
  type BucketPreset,
  type WorkViewParam,
} from "@/lib/my-work";

export const Route = createFileRoute("/my-work")({
  head: () => ({ meta: [{ title: "Work Overview — JBK Portal" }] }),
  // Every signed-in user (pageForPath: /my-work → null) and everyone's landing page (homeFor).
  // ?view=calendar opens the month calendar (the list otherwise); ?view=owner the Owner view,
  // admins only — the page falls back to the list for anyone else (effectiveView) and the
  // server refuses them. ?who=mine | all | <profile id> is the "Show" picker of admins and
  // managers — the server ignores it for anyone else. Without ?who the page shows the caller's
  // default (defaultWho: Everyone for admins and managers, owner Oct 1; Mine for anyone else), so
  // ?who=mine is kept in the URL when an admin or manager picks Mine. ?bucket=today|overdue
  // presets the List to one group (the Owner view's links). ?month=YYYY-MM is the Calendar's
  // month (owner, Oct 15), kept while switching views so it survives List ↔ Calendar and Back.
  // Owner, Oct 15: without ?view / ?who the page opens on the view and the person the user last
  // picked (remembered on their profile with the layout; lib/work-layout.ts landingSearch), so
  // the page gets the URL's values as they are — absent when absent — and resolves them itself.
  // An explicit ?view=list is kept too (Oct 15): the Owner view's number links say so, and the
  // remembered "owner" must not win over it (landingSearch treats any URL view as final).
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
  view?: WorkViewParam;
  who?: string;
  bucket?: BucketPreset;
  month?: string;
};

function MyWorkRoute() {
  const { view, who, bucket, month } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { profile } = useAuth();
  // A technician-only user's page is My tickets (owner, Oct 15; homeFor): the sidebar has no
  // Work Overview for them, and an old link or the sign-in redirect lands there instead.
  if (isFieldOnly(profile)) return <Navigate to={homeFor(profile)} replace />;
  // The URL's own values, for the next URL: no ?view reads as the list and no ?who as the
  // caller's default here (the page applies the remembered ones when the URL is silent, and a
  // search without them keeps letting it).
  const curView = view ?? "list";
  // No ?who: Everyone for admins and managers, Mine for anyone else (defaultWho).
  const curWho = resolveWho(who, profile);
  /**
   * The search without default keys (the list, the caller's default `who`, no preset) — the
   * page's own navigations may drop "list"; only an incoming link needs it explicit.
   */
  const searchOf = (
    v: WorkViewParam,
    w: string,
    b?: BucketPreset | null,
    m?: string | null,
  ): MyWorkSearch => {
    const wp = whoParam(w, profile);
    return {
      ...(v !== "list" ? { view: v } : {}),
      ...(wp ? { who: wp } : {}),
      ...(b && v === "list" ? { bucket: b } : {}),
      ...(m ? { month: m } : {}),
    };
  };
  return (
    <MyWorkPage
      view={view ?? null}
      who={who ?? null}
      month={month ?? null}
      bucket={bucket ?? null}
      onView={(v) => void navigate({ search: searchOf(v, curWho, null, month), replace: true })}
      onWho={(w) => void navigate({ search: searchOf(curView, w, bucket, month), replace: true })}
      onMonth={(m) =>
        void navigate({ search: searchOf(curView, curWho, bucket, m), replace: true })
      }
      onBucket={(b) =>
        void navigate({ search: searchOf(curView, curWho, b, month), replace: true })
      }
    />
  );
}
