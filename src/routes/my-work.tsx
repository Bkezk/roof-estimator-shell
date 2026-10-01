import { createFileRoute } from "@tanstack/react-router";

import { MyWorkPage } from "@/components/my-work-page";
import { parseBucketPreset, type BucketPreset } from "@/lib/my-work";

export const Route = createFileRoute("/my-work")({
  head: () => ({ meta: [{ title: "My Work — JBK Portal" }] }),
  // Every signed-in user (pageForPath: /my-work → null) and everyone's landing page (homeFor).
  // ?view=calendar opens the month calendar (the list otherwise); ?view=owner the Owner view,
  // admins only — the page falls back to the list for anyone else (effectiveView) and the
  // server refuses them. ?who=all | <profile id> is the "Show" picker of admins and managers —
  // the server ignores it for anyone else. ?bucket=today|overdue presets the List to one group
  // (the Owner view's links).
  validateSearch: (s: Record<string, unknown>): MyWorkSearch => {
    const view = s["view"];
    const who = s["who"];
    const bucket = parseBucketPreset(s["bucket"]);
    return {
      ...(view === "calendar" || view === "owner" ? { view } : {}),
      ...(typeof who === "string" && who && who !== "mine" ? { who: who.slice(0, 64) } : {}),
      ...(bucket ? { bucket } : {}),
    };
  },
  component: MyWorkRoute,
});

type MyWorkSearch = { view?: "calendar" | "owner"; who?: string; bucket?: BucketPreset };

/** The search without empty keys (the list, "Mine" and no preset are the defaults). */
const searchOf = (
  view: "list" | "calendar" | "owner",
  who: string,
  bucket?: BucketPreset | null,
): MyWorkSearch => ({
  ...(view !== "list" ? { view } : {}),
  ...(who && who !== "mine" ? { who } : {}),
  ...(bucket && view === "list" ? { bucket } : {}),
});

function MyWorkRoute() {
  const { view, who, bucket } = Route.useSearch();
  const navigate = Route.useNavigate();
  const curView = view ?? "list";
  const curWho = who ?? "mine";
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
