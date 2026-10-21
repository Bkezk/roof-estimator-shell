/**
 * The Owner page (owner, Oct 21: "owner should be its own tab"): the owners' own section, out of
 * Work Overview, with two tabs. People is the Owner view as it was — who is doing what they
 * should be doing, when they should be doing it (components/owner-view.tsx; the "Everyone: …"
 * line that introduced it on Work Overview moved here with it). Business is the money: the tiles
 * (components/owner-business.tsx — what is in flight now) with the margin report under them
 * (components/margin-report.tsx — what the finished work made, over time); owner, Oct 21:
 * "wouldn't margin and business be roughly the same thing? … merge them into business". The tab
 * is the route's (?tab=; routes/owner.tsx), so the strip here only asks for the change. Admins
 * only: the route and the gate keep anyone else out, and every server function behind the tabs
 * refuses them too.
 */
import { Crown } from "lucide-react";

import type { OwnerTab } from "@/lib/owner-page";
import { MarginReport } from "@/components/margin-report";
import { OwnerBusiness } from "@/components/owner-business";
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
          The whole team at a glance, and the money: what is in flight, and the margin on the work.
        </p>
      </div>

      <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Owner tabs">
        <Button
          size="sm"
          variant={tab === "people" ? "default" : "ghost"}
          aria-pressed={tab === "people"}
          onClick={() => props.onTab("people")}
        >
          People
        </Button>
        <Button
          size="sm"
          variant={tab === "business" ? "default" : "ghost"}
          aria-pressed={tab === "business"}
          onClick={() => props.onTab("business")}
        >
          Business
        </Button>
      </div>

      {tab === "people" ? (
        <>
          <p className="text-sm text-muted-foreground">
            Everyone: what is due today, what is overdue, what got done this week.
          </p>
          <OwnerView />
        </>
      ) : (
        // Now above, over time below (owner, Oct 21). Each half reads on its own; the report has
        // its own heading, range and export.
        <div className="space-y-8">
          <OwnerBusiness />
          <div className="border-t pt-6">
            <MarginReport />
          </div>
        </div>
      )}
    </div>
  );
}
