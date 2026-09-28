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
    throw redirect({ to: "/bids" });
  },
  component: Index,
});

function Index() {
  return null;
}
