import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "Admin / Settings — Duro-Last Estimator" },
      {
        name: "description",
        content: "Configure estimator defaults and settings.",
      },
      {
        property: "og:title",
        content: "Admin / Settings — Duro-Last Estimator",
      },
      {
        property: "og:description",
        content: "Configure estimator defaults and settings.",
      },
    ],
  }),
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Admin / Settings</h1>
      <p className="text-muted-foreground">
        Estimator defaults and configuration will go here.
      </p>
    </div>
  );
}
