import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { createBid } from "@/lib/bids.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/new-bid")({
  head: () => ({
    meta: [
      { title: "New Bid — Duro-Last Estimator" },
      {
        name: "description",
        content: "Start a new Duro-Last roofing estimate.",
      },
      { property: "og:title", content: "New Bid — Duro-Last Estimator" },
      {
        property: "og:description",
        content: "Start a new Duro-Last roofing estimate.",
      },
    ],
  }),
  component: NewBidPage,
});

function NewBidPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createBidFn = useServerFn(createBid);

  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setIsSubmitting(true);
    try {
      await createBidFn({ name: trimmed });
      queryClient.invalidateQueries({ queryKey: ["bids"] });
      toast.success("Bid created");
      navigate({ to: "/bids" });
    } catch {
      toast.error("Failed to create bid");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">New Bid</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="bid-name">Bid name</Label>
          <Input
            id="bid-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Smith Elementary"
            disabled={isSubmitting}
          />
        </div>
        <Button type="submit" disabled={isSubmitting || !name.trim()}>
          Create Bid
        </Button>
      </form>
    </div>
  );
}
