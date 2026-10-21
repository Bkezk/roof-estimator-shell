/**
 * The Owner page (owner, Oct 21: "owner should be its own tab"): the owners' own section, out of
 * Work Overview, with two tabs. Team is the Owner view as it was — who is doing what they should
 * be doing, when they should be doing it (components/owner-view.tsx; the "Everyone: …" line that
 * introduced it on Work Overview moved here with it). Margin is the margin report. The tab is the
 * route's (?tab=; routes/owner.tsx), so the strip here only asks for the change. Admins only: the
 * route and the gate keep anyone else out, and the Owner view's own server function refuses them.
 */
import { Crown } from "lucide-react";

import type { OwnerTab } from "@/lib/owner-page";
import { MarginReport } from "@/components/margin-report";
import { OwnerView } from "@/components/owner-view";
import { Button } from "@/components/ui/button";

export function OwnerPage(props: { tab: OwnerTab; onTab: (tab: OwnerTab) => void }) {
  const { tab } = props;
  return (
    // The whole width, like Work Overview (the Owner view's table was laid out for it).
    <div className="mx-auto max-w-none space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Crown className="h-6 w-6" /> Owner
        </h1>
        <p className="text-sm text-muted-foreground">
          The whole team at a glance, and the margin on the work.
        </p>
      </div>

      <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Owner tabs">
        <Button
          size="sm"
          variant={tab === "team" ? "default" : "ghost"}
          aria-pressed={tab === "team"}
          onClick={() => props.onTab("team")}
        >
          Team
        </Button>
        <Button
          size="sm"
          variant={tab === "margin" ? "default" : "ghost"}
          aria-pressed={tab === "margin"}
          onClick={() => props.onTab("margin")}
        >
          Margin
        </Button>
      </div>

      {tab === "team" ? (
        <>
          <p className="text-sm text-muted-foreground">
            Everyone: what is due today, what is overdue, what got done this week.
          </p>
          <OwnerView />
        </>
      ) : (
        // Oct 21: the margin report (owners only; the server refuses anyone but an admin too).
        <MarginReport />
      )}
    </div>
  );
}
