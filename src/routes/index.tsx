import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bid-O-Matic" },
      {
        name: "description",
        content:
          "Internal roofing estimating tool for Duro-Last commercial roofing systems.",
      },
      { property: "og:title", content: "Bid-O-Matic" },
      {
        property: "og:description",
        content:
          "Internal roofing estimating tool for Duro-Last commercial roofing systems.",
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
