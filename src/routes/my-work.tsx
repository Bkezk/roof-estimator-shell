import { createFileRoute } from "@tanstack/react-router";

import { MyWorkPage } from "@/components/my-work-page";
import { useAuth } from "@/lib/auth-store";
import { parseBucketPreset, resolveWho, whoParam, type BucketPreset } from "@/lib/my-work";

export const Route = createFileRoute("/my-work")({
  head: () => ({ meta: [{ title: "Work Overview — JBK Portal" }] }),
  // Every signed-in user (pageForPath: /my-work → null) and everyone's landing page (homeFor).
  // ?view=calendar opens the month calendar (the list otherwise); ?view=owner the Owner view,
  // admins only — the page falls back to the list for anyone else (effectiveView) and the
  // server refuses them. ?who=mine | all | <profile id> is the "Show" picker of admins and
  // managers — the server ignores it for anyone else. Without ?who the page shows the caller's
  // default (defaultWho: Everyone for admins and managers, owner Oct 1; Mine for anyone else), so
  // ?who=mine is kept in the URL when an admin or manager picks Mine. ?bucket=today|overdue
  // presets the List to one group (the Owner view's links).
  validateSearch: (s: Record<string, unknown>): MyWorkSearch => {
    const view = s["view"];
    const who = s["who"];
    const bucket = parseBucketPreset(s["bucket"]);
    return {
      ...(view === "calendar" || view === "owner" ? { view } : {}),
      ...(typeof who === "string" && who ? { who: who.slice(0, 64) } : {}),
      ...(bucket ? { bucket } : {}),
    };
  },
  component: MyWorkRoute,
});

type MyWorkSearch = { view?: "calendar" | "owner"; who?: string; bucket?: BucketPreset };

function MyWorkRoute() {
  const { view, who, bucket } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { profile } = useAuth();
  const curView = view ?? "list";
  // No ?who: Everyone for admins and managers, Mine for anyone else (defaultWho).
  const curWho = resolveWho(who, profile);
  /** The search without default keys (the list, the caller's default `who`, no preset). */
  const searchOf = (
    v: "list" | "calendar" | "owner",
    w: string,
    b?: BucketPreset | null,
  ): MyWorkSearch => {
    const wp = whoParam(w, profile);
    return {
      ...(v !== "list" ? { view: v } : {}),
      ...(wp ? { who: wp } : {}),
      ...(b && v === "list" ? { bucket: b } : {}),
    };
  };
  return (
    <MyWorkPage
      view={curView}
      who={curWho}
      bucket={bucket ?? null}
      onView={(v) => void navigate({ search: searchOf(v, curWho), replace: true })}
      onWho={(w) => void navigate({ search: searchOf(curView, w, bucket), replace: true })}
      onBucket={(b) => void navigate({ search: searchOf(curView, curWho, b), replace: true })}
    />
  );
}
