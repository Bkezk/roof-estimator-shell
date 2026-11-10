import { createFileRoute, redirect } from "@tanstack/react-router";

import { HOME_REDIRECT } from "@/lib/home-redirect";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JBK Portal" },
      {
        name: "description",
        content: "Internal roofing estimating tool for Duro-Last commercial roofing systems.",
      },
      { property: "og:title", content: "JBK Portal" },
      {
        property: "og:description",
        content: "Internal roofing estimating tool for Duro-Last commercial roofing systems.",
      },
    ],
  }),
  beforeLoad: async () => {
    // Everyone lands on Work Overview (owner, Sep 30; homeFor in src/lib/access.ts) — a
    // technician-only user is sent on to My tickets by the gate, as from any Work Overview link.
    // Nov 10 (the speed pass, finding 13): the bare address cost one extra round trip on every
    // open, because the answer was a redirect nobody could remember (307, no cache header). It
    // is the same redirect for every person, so the browser is now told to remember it
    // (HOME_REDIRECT): the next opens of "/" go straight to Work Overview without asking. The
    // home-screen icon skips it altogether (manifest start_url is /my-work).
    throw redirect({ to: "/my-work", ...HOME_REDIRECT });
  },
  component: Index,
});

function Index() {
  return null;
}
