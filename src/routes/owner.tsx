import { createFileRoute, Navigate } from "@tanstack/react-router";

import { OwnerPage } from "@/components/owner-page";
import { isAdmin } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { parseOwnerTab, type OwnerTab } from "@/lib/owner-page";

/**
 * The Owner section (owner, Oct 21: "owner should be its own tab"). Admins only — both admins
 * are the owners, no new setting: the central gate blocks anyone else (lib/access.ts
 * pageForPath: /owner → "admin", as Admin › Users), and this route sends a signed-in non-admin
 * to Work Overview the way routes/my-work.tsx sends a technician-only user to My tickets. ?tab=
 * is the tab — people (the Owner view that lived on Work Overview until today) or business (the
 * money tiles with the margin report under them; owner, Oct 21: "merge them into business") —
 * kept in the URL so a tab can be linked and Back works; People is the default and is not
 * written; the old names team / margin still land (lib/owner-page.ts parseOwnerTab). An old
 * /my-work?view=owner link lands here (routes/my-work.tsx).
 */
export const Route = createFileRoute("/owner")({
  head: () => ({ meta: [{ title: "Owner — JBK Portal" }] }),
  validateSearch: (s: Record<string, unknown>): OwnerSearch => {
    const tab = parseOwnerTab(s["tab"]);
    return tab === "people" ? {} : { tab };
  },
  component: OwnerRoute,
});

type OwnerSearch = {
  tab?: OwnerTab;
};

function OwnerRoute() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { profile } = useAuth();
  // The gate already blocks a non-admin; this is the page's own rule, for a profile in hand.
  if (profile && !isAdmin(profile)) return <Navigate to="/my-work" replace />;
  return (
    <OwnerPage
      tab={tab ?? "people"}
      onTab={(t) => void navigate({ search: t === "people" ? {} : { tab: t }, replace: true })}
    />
  );
}
