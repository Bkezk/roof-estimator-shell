/**
 * Trade Bids, setting up a trade (owner, Nov 16: "a bid setup where we can set labor and cost
 * and time similar to the project bid calculator but simpler and we can save it per job type
 * like fill it in for painting save it, fill it in for siding save it, then when we click that
 * menu item it pulls up those calculations").
 *
 * A trade is a job type (Painting, Siding) set up once: what a bid of that kind measures, the
 * materials, the labor, the flat costs and the markup. This screen sets up a new one
 * (/trade-bids?trade=new) or changes one (/trade-bids?trade=<trade>). It is an admin's and a
 * manager's: anyone else is told so and nothing is read (the server refuses them as well).
 *
 * Top to bottom: the trade's name, the editor (trade-lines-editor.tsx, the same one a bid opens
 * on its own copy), and "Try it": sample measurements and the price they give, so a setup can
 * be checked against a job whose price is already known before anyone bids with it. The sample
 * numbers are never saved.
 *
 * A trade is a starting point and nothing more (owner: "a saved bid should keep its own
 * numbers"): a bid copies the setup when it is started, so saving here changes NEW bids only,
 * and deleting a trade leaves its bids whole. The screen says both where it matters, beside
 * Save and in the question Delete asks.
 *
 * Leaving with changes not saved asks first (owner: "the pop up reminding to save or giving the
 * option to leave without saving"): Stay, Leave without saving, or Save and leave.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  BackToList,
  FirstRead,
  LeaveDialog,
  Loading,
  TradePrice,
} from "@/components/trade/trade-bid-screen";
import { BOX, MeasureBoxes, TradeLinesEditor } from "@/components/trade/trade-lines-editor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { seesEveryone } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { plainErrText } from "@/lib/plain-error";
import { calcTradeBid, emptySetup, type TradeSetup } from "@/lib/trade-bid";
import { isDirty, setupSaveProblems, subsAsSaved, tidyQuantities } from "@/lib/trade-bid-form";
import {
  deleteTradeType,
  getTradeType,
  saveTradeType,
  type TradeType,
} from "@/lib/trade-bids.functions";

export function TradeSetupScreen(props: { tradeTypeId?: string }) {
  const { profile, loading } = useAuth();
  if (!profile && loading) return <Loading>One moment…</Loading>;
  // Setting up a trade is an admin's and a manager's. Nothing is read for anyone else.
  if (!seesEveryone(profile))
    return (
      <div className="space-y-4" data-trade-setup="not-allowed">
        <BackToList />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Only an admin or a manager sets up a trade.</CardTitle>
            <CardDescription>
              You can still bid any trade that is set up:{" "}
              <Link to="/trade-bids" search={{}} className="font-medium underline">
                go back to Trade Bids
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  if (props.tradeTypeId) return <ExistingTrade tradeTypeId={props.tradeTypeId} />;
  return <SetupForm trade={null} />;
}

function ExistingTrade(props: { tradeTypeId: string }) {
  const { session } = useAuth();
  const getFn = useServerFn(getTradeType);
  const q = useQuery({
    queryKey: ["trade-type", props.tradeTypeId],
    queryFn: () => getFn({ data: { id: props.tradeTypeId } }),
    enabled: !!session,
    // A trade just saved here is already in hand: opening it does not read it a second time.
    staleTime: 10_000,
  });
  return (
    <FirstRead query={q} loading="Opening the trade…" failed="This trade could not be opened">
      {(trade) => <SetupForm trade={trade} />}
    </FirstRead>
  );
}

/** What Save sends, and what is compared with the copy last saved. */
interface Draft {
  name: string;
  setup: TradeSetup;
}

const sentences = (parts: readonly string[]) =>
  parts.map((p) => (p.endsWith(".") ? p : `${p}.`)).join(" ");

function SetupForm(props: { trade: TradeType | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const saveFn = useServerFn(saveTradeType);
  const deleteFn = useServerFn(deleteTradeType);

  // The saved trade this form is on; null until a new trade's first save.
  const [trade, setTrade] = useState<TradeType | null>(props.trade);
  const [draft, setDraft] = useState<Draft>(() =>
    props.trade
      ? { name: props.trade.name, setup: props.trade.setup }
      : { name: "", setup: emptySetup() },
  );
  const [saved, setSaved] = useState<Draft>(draft);
  // Number boxes in the editor holding something that is not a number.
  const [badBoxes, setBadBoxes] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Deleted a moment ago: nothing here is worth asking about on the way out.
  const [gone, setGone] = useState(false);
  // "Try it": sample measurements, kept on this screen only.
  const [sample, setSample] = useState<Record<string, number>>({});

  const isNew = !trade;
  const problems = setupSaveProblems({ name: draft.name, invalidBoxes: badBoxes });
  const sampleResult = useMemo(() => calcTradeBid(draft.setup, sample), [draft.setup, sample]);

  const dirty = !gone && isDirty(saved, draft);
  // Leaving with changes not saved asks first (owner, Nov 16): the back link, the menu and the
  // browser's back button all go through the router; closing or reloading the tab keeps the
  // browser's own warning. The ref is what the blocker reads, and it is cleared by hand before
  // the screen moves itself (a new trade, once saved, goes to its own address; a deleted one
  // goes back to the list).
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current,
    withResolver: true,
    enableBeforeUnload: () => dirtyRef.current,
  });
  // True from "Save and leave" until the save answers: the question is hidden meanwhile.
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  leavingRef.current = leaving;
  const stayHere = () => {
    setLeaving(false);
    if (blocker.status === "blocked") blocker.reset();
  };

  const setSetup = (changed: TradeSetup) => {
    // The last sub line taken out leaves "no sub lines" written the way the saved copy writes
    // it, so adding a line and taking it out again is not a change to save.
    const setup = subsAsSaved(changed, saved.setup);
    setDraft((d) => ({ ...d, setup }));
    // A measure taken out takes its sample number with it.
    setSample((s) => tidyQuantities(s, setup));
  };

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ...(trade ? { id: trade.id, expectUpdatedAt: trade.updated_at } : {}),
          name: draft.name.trim(),
          setup: draft.setup,
        },
      }),
    onSuccess: (row) => {
      const wasNew = !trade;
      toast.success("Saved");
      // The trade's own copy is replaced by the server's answer; the lists of trades re-read.
      qc.setQueryData(["trade-type", row.id], row);
      void qc.invalidateQueries({ queryKey: ["trade-types"] });
      // The trade as the server now holds it is both what is on screen and what is saved.
      const next = { name: row.name, setup: row.setup };
      setTrade(row);
      setDraft(next);
      setSaved(next);
      // Saved: nothing is pending any more, whichever way the screen goes next.
      dirtyRef.current = false;
      if (blocker.status === "blocked") {
        // "Save and leave", or the person went to leave while this save was on its way: with
        // everything saved there is nothing left to ask, so on to where they were going.
        setLeaving(false);
        blocker.proceed();
      } else if (wasNew) {
        // A new trade now has an address of its own; going there is not "leaving".
        void navigate({
          to: "/trade-bids",
          search: { trade: row.id },
          replace: true,
          ignoreBlocker: true,
        });
      }
    },
    onError: (e) => {
      // The server's refusals are already plain sentences ("There is already a trade called …").
      toast.error(plainErrText(e), { duration: 12_000 });
      if (leavingRef.current) stayHere();
    },
  });

  /** Save, unless something is missing: then say what, and send nothing. */
  const trySave = (andLeave: boolean) => {
    if (save.isPending) return;
    if (problems.length > 0) {
      toast.error(`Not saved yet. ${sentences(problems)}`);
      if (andLeave) stayHere();
      return;
    }
    if (andLeave) setLeaving(true);
    save.mutate();
  };

  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: trade!.id } }),
    onSuccess: () => {
      toast.success(`${trade?.name ?? "The trade"} was deleted`);
      void qc.invalidateQueries({ queryKey: ["trade-types"] });
      // What is in hand of the trade is out of date; it is read again if anyone asks for it.
      if (trade)
        void qc.invalidateQueries({ queryKey: ["trade-type", trade.id], refetchType: "none" });
      // Gone: changes not saved are moot, and the way to the list is not blocked by them.
      setGone(true);
      dirtyRef.current = false;
      void navigate({ to: "/trade-bids", search: {}, ignoreBlocker: true });
    },
    onError: (e) => toast.error(`The trade was not deleted. ${plainErrText(e)}`),
  });

  // Nothing is typed while a save is on its way: its answer replaces what is on screen.
  const locked = save.isPending || remove.isPending || gone;
  const shownName = draft.name.trim() || trade?.name || "this trade";

  return (
    <div className="space-y-4" data-trade-setup={trade?.id ?? "new"}>
      <BackToList />
      <h1 className="break-words text-2xl font-bold tracking-tight">
        {isNew ? "Set up a trade" : draft.name.trim() || trade.name}
      </h1>
      {/* Owner, Nov 17: "when you're making a trade bid I didn't see a place to associate a
          customer". This screen is the kind of job, set up once; the customer goes on each bid.
          Said here, with the way to a bid in the bar below once the trade is saved. */}
      <p className="max-w-prose text-sm text-muted-foreground" data-setup-what>
        This sets up a kind of job once: what it measures, what it costs and what is added on top.
        The customer, the due date and the measurements go on each bid.
      </p>

      <Card data-card="trade-name">
        <CardContent className="space-y-1.5 pt-6">
          <Label htmlFor="trade-name">Trade name</Label>
          <Input
            id="trade-name"
            className={`${BOX} sm:max-w-sm`}
            value={draft.name}
            maxLength={80}
            placeholder="Painting"
            disabled={locked}
            data-trade-name
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">
            The kind of job this is for. People pick it by this name when they start a bid.
          </p>
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TradeLinesEditor
          value={draft.setup}
          onChange={setSetup}
          disabled={locked}
          onInvalidChange={setBadBoxes}
        />

        <Card data-card="trade-try" className="xl:sticky xl:top-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Try it</CardTitle>
            <CardDescription>
              Sample numbers to check your setup. They are not saved.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MeasureBoxes
              measures={draft.setup.measures}
              quantities={sample}
              onChange={(measureId, value) =>
                setSample((s) => tidyQuantities({ ...s, [measureId]: value }, draft.setup))
              }
            />
            <TradePrice setup={draft.setup} result={sampleResult} />
          </CardContent>
        </Card>
      </div>

      <div
        className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/95 px-3 py-3 backdrop-blur"
        data-save-bar
      >
        <div className="min-w-0 flex-1 space-y-0.5 text-sm" data-save-note>
          {problems.length > 0 ? (
            // Why Save is off. (A box holding a mistake is outlined in red where it is.)
            <p className="font-medium">{`Before you can save: ${sentences(problems)}`}</p>
          ) : dirty ? (
            <p>You have changes that are not saved.</p>
          ) : (
            !isNew && <p className="text-muted-foreground">All changes are saved.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Bids already started keep their own numbers. This changes new bids only.
          </p>
        </div>
        {/* A saved trade with nothing changed: the next step is a bid, where the customer is
            picked. Not offered with unsaved changes, so the bid starts from what is on screen. */}
        {trade && !dirty && !gone && (
          <Button asChild variant="outline" className="h-10">
            <Link to="/trade-bids" search={{ new: trade.id }} data-start-bid-here>
              Start a bid of this trade <ArrowRight />
            </Link>
          </Button>
        )}
        <Button
          type="button"
          className="h-10 min-w-24"
          data-save
          disabled={save.isPending || remove.isPending || gone || problems.length > 0}
          onClick={() => trySave(false)}
        >
          {save.isPending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>

      {trade && (
        <div className="border-t pt-4">
          <Button
            type="button"
            variant="outline"
            className="h-10 text-destructive hover:text-destructive"
            data-delete-trade
            disabled={locked}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 /> Delete this trade
          </Button>
        </div>
      )}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => !remove.isPending && setConfirmDelete(open)}
      >
        <AlertDialogContent data-dialog="delete-trade">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {trade?.name ?? shownName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Bids already made from it keep their numbers. New bids of this trade can no longer be
              started.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                // Not the dialog's own close: it goes away once the trade is gone.
                e.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending && <Loader2 className="animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LeaveDialog
        open={blocker.status === "blocked" && !leaving}
        what={isNew ? "this trade" : shownName}
        onStay={stayHere}
        onLeave={() => {
          if (blocker.status === "blocked") blocker.proceed();
        }}
        onSaveAndLeave={() => trySave(true)}
      />
    </div>
  );
}
