import { createFileRoute } from "@tanstack/react-router";

import { MyWorkPage } from "@/components/my-work-page";

export const Route = createFileRoute("/my-work")({
  head: () => ({ meta: [{ title: "My Work — JBK Portal" }] }),
  // Every signed-in user (pageForPath: /my-work → null) and everyone's landing page (homeFor).
  // ?view=calendar opens the month calendar (the list otherwise); ?who=all | <profile id> is the
  // "Show" picker of admins and managers — the server ignores it for anyone else.
  validateSearch: (s: Record<string, unknown>): MyWorkSearch => {
    const view = s["view"];
    const who = s["who"];
    return {
      ...(view === "calendar" ? { view: "calendar" as const } : {}),
      ...(typeof who === "string" && who && who !== "mine" ? { who: who.slice(0, 64) } : {}),
    };
  },
  component: MyWorkRoute,
});

type MyWorkSearch = { view?: "calendar"; who?: string };

/** The search without empty keys (the list and "Mine" are the defaults). */
const searchOf = (view: "list" | "calendar", who: string): MyWorkSearch => ({
  ...(view === "calendar" ? { view: "calendar" as const } : {}),
  ...(who && who !== "mine" ? { who } : {}),
});

function MyWorkRoute() {
  const { view, who } = Route.useSearch();
  const navigate = Route.useNavigate();
  const curView = view ?? "list";
  const curWho = who ?? "mine";
  return (
    <MyWorkPage
      view={curView}
      who={curWho}
      onView={(v) => void navigate({ search: searchOf(v, curWho), replace: true })}
      onWho={(w) => void navigate({ search: searchOf(curView, w), replace: true })}
    />
  );
}
