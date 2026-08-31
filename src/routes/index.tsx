import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Duro-Last Estimator" },
      {
        name: "description",
        content:
          "Internal roofing estimating tool for Duro-Last commercial roofing systems.",
      },
      { property: "og:title", content: "Duro-Last Estimator" },
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
