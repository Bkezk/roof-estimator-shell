import { createFileRoute, redirect } from "@tanstack/react-router";

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
    // Everyone lands on My Work (owner, Sep 30; homeFor in src/lib/access.ts).
    throw redirect({ to: "/my-work" });
  },
  component: Index,
});

function Index() {
  return null;
}
