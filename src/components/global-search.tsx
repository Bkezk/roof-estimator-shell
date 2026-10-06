/**
 * The header search box (owner, Oct 6: "a search bar where you can search anything — job number,
 * name, customers, etc."). Click it or press Ctrl / ⌘ K: one box over tickets, customers,
 * properties, contacts, opportunities, project bids, invoices and vendors (global-search.ts).
 * Results come grouped, best match first; Enter or a click opens the row. Row security decides
 * what each role sees. Any kind that failed is named under the list.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { globalSearch } from "@/lib/global-search.functions";
import {
  groupHits,
  hitHref,
  parseGlobalQuery,
  SEARCH_KIND_LABELS,
  SEARCH_MIN,
} from "@/lib/global-search";

const DEBOUNCE_MS = 250;

export function GlobalSearch() {
  const router = useRouter();
  const searchFn = useServerFn(globalSearch);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  // Ctrl / ⌘ K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = useMemo(() => parseGlobalQuery(debounced), [debounced]);
  const results = useQuery({
    queryKey: ["global-search", q.text],
    queryFn: () => searchFn({ data: { q: q.text } }),
    enabled: open && !q.tooShort,
    staleTime: 15_000,
  });
  const groups = useMemo(() => groupHits(results.data?.hits ?? []), [results.data]);
  const typing = text !== debounced;

  const go = (href: string) => {
    setOpen(false);
    setText("");
    void router.navigate({ href });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search (Ctrl K)"
        className="hidden h-9 w-full max-w-md items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground shadow-sm hover:bg-accent hover:text-accent-foreground sm:flex"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">Search tickets, customers, bids…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline">
          Ctrl K
        </kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent sm:hidden"
      >
        <Search className="h-5 w-5" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-xl">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command
            shouldFilter={false}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-input]]:h-12"
          >
            <CommandInput
              value={text}
              onValueChange={setText}
              placeholder="Ticket #, job #, PO #, customer, property, contact, bid, invoice…"
            />
            <CommandList className="max-h-[60vh]">
              {q.tooShort ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Type at least {SEARCH_MIN} characters.
                </p>
              ) : results.isPending || typing ? (
                <p className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching…
                </p>
              ) : results.isError ? (
                <p className="px-3 py-6 text-center text-sm text-destructive">
                  Search failed:{" "}
                  {results.error instanceof Error ? results.error.message : String(results.error)}
                </p>
              ) : (
                <>
                  {groups.length === 0 && <CommandEmpty>No matches for “{q.text}”.</CommandEmpty>}
                  {groups.map((g) => (
                    <CommandGroup key={g.kind} heading={SEARCH_KIND_LABELS[g.kind]}>
                      {g.hits.map((h) => (
                        <CommandItem
                          key={`${h.kind}:${h.id}`}
                          value={`${h.kind}:${h.id}`}
                          onSelect={() => go(hitHref(h))}
                          className="flex flex-col items-start gap-0.5 py-2"
                        >
                          <span className="font-medium">{h.title}</span>
                          {h.subtitle && (
                            <span className="truncate text-xs text-muted-foreground">
                              {h.subtitle}
                            </span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                  {(results.data?.errors.length ?? 0) > 0 && (
                    <p className="px-3 py-2 text-xs text-destructive">
                      Could not search{" "}
                      {results.data!.errors.map((e) => SEARCH_KIND_LABELS[e.kind]).join(", ")}:{" "}
                      {results.data!.errors[0]!.message}
                    </p>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
