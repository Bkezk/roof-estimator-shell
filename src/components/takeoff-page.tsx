/**
 * Takeoff — PlanSwift's drawing half (docs/planswift-research.md §4). Without an id the page
 * lists takeoffs; `/takeoff?id=<uuid>` opens one in the editor (./takeoff/editor.tsx). A new
 * takeoff is a plan-set PDF or an aerial screenshot: the row is created first, then the browser
 * uploads the file straight into the private "takeoffs" bucket at the row's file_path.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { FileImage, FileText, Loader2, Plus, Ruler, Trash2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-store";
import {
  createTakeoff,
  deleteTakeoff,
  listTakeoffs,
  TAKEOFF_BUCKET,
  type TakeoffRow,
} from "@/lib/takeoff.functions";
import type { TakeoffPage as TakeoffSheet } from "@/lib/takeoff/model";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { TakeoffEditor } from "@/components/takeoff/editor";
import { pdfPageCount } from "@/components/takeoff/underlay";

const MAX_BYTES = 100 * 1024 * 1024;
const ACCEPT = ["application/pdf", "image/png", "image/jpeg"];

export function TakeoffPage({ id }: { id?: string | undefined }) {
  return id ? <TakeoffEditor id={id} /> : <TakeoffList />;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const fileSize = (n: number | null) =>
  n === null ? "" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;

function TakeoffList() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listTakeoffs);
  const deleteFn = useServerFn(deleteTakeoff);
  const list = useQuery({
    queryKey: ["takeoffs"],
    queryFn: () => listFn(),
    enabled: !!session,
  });
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<TakeoffRow | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Takeoff deleted");
      setToDelete(null);
      void qc.invalidateQueries({ queryKey: ["takeoffs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Ruler className="h-6 w-6" /> Takeoffs
          </h1>
          <p className="text-sm text-muted-foreground">
            Open a plan-sheet PDF or an aerial screenshot, set the scale from a known dimension,
            then draw the roof areas, walls and counts.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-4 w-4" /> New takeoff
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last updated</TableHead>
                <TableHead className="w-[1%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {list.error && (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-destructive">
                    Could not load takeoffs:{" "}
                    {list.error instanceof Error ? list.error.message : String(list.error)}
                  </TableCell>
                </TableRow>
              )}
              {list.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No takeoffs yet. Start one with “New takeoff”.
                  </TableCell>
                </TableRow>
              )}
              {list.data?.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    <Link
                      to="/takeoff"
                      search={{ id: t.id }}
                      className="hover:underline underline-offset-2"
                    >
                      {t.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1 text-sm">
                      {t.underlay_kind === "pdf" ? (
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <FileImage className="h-4 w-4 text-muted-foreground" />
                      )}
                      {t.underlay_kind === "pdf" ? "PDF" : "Image"}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground">
                    {t.file_name ?? ""}
                    {t.file_size !== null && (
                      <span className="ml-1 text-xs">({fileSize(t.file_size)})</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.status === "done" ? "default" : "secondary"}>
                      {t.status === "done" ? "Done" : "Draft"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {when(t.updated_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/takeoff" search={{ id: t.id }}>
                          Open
                        </Link>
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        aria-label={`Delete ${t.name}`}
                        onClick={() => setToDelete(t)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <NewTakeoffDialog open={creating} onOpenChange={setCreating} />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The takeoff and its drawing disappear from this list. An admin can still recover it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (toDelete) remove.mutate(toDelete.id);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NewTakeoffDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const createFn = useServerFn(createTakeoff);
  const deleteFn = useServerFn(deleteTakeoff);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setFile(null);
    setBusy(null);
  };

  const pickFile = (f: File | null) => {
    if (!f) return setFile(null);
    if (!ACCEPT.includes(f.type)) {
      toast.error("Choose a PDF, PNG or JPEG file.");
      return setFile(null);
    }
    if (f.size > MAX_BYTES) {
      toast.error("That file is over 100 MB.");
      return setFile(null);
    }
    setFile(f);
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async () => {
    if (!file || !name.trim() || busy) return;
    const isPdf = file.type === "application/pdf";
    let pages: TakeoffSheet[];
    try {
      setBusy("Reading the file…");
      if (isPdf) {
        const n = await pdfPageCount(file);
        pages = Array.from({ length: n }, (_, i) => ({
          index: i,
          name: `Page ${i + 1}`,
          rotation: 0,
          scale: null,
        }));
      } else {
        pages = [{ index: 0, name: file.name.slice(0, 120), rotation: 0, scale: null }];
      }
    } catch (e) {
      setBusy(null);
      toast.error(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    let row: TakeoffRow;
    try {
      setBusy("Creating the takeoff…");
      row = await createFn({
        data: {
          name: name.trim(),
          underlay_kind: isPdf ? "pdf" : "image",
          file_name: file.name,
          file_size: file.size,
          pages,
        },
      });
    } catch (e) {
      setBusy(null);
      toast.error(`Could not create the takeoff: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    setBusy("Uploading the file…");
    const path = row.file_path;
    const { error } = path
      ? await supabase.storage
          .from(TAKEOFF_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: true })
      : { error: new Error("the takeoff has no file path") };
    if (error) {
      await deleteFn({ data: { id: row.id } }).catch(() => {});
      setBusy(null);
      toast.error(`Upload failed: ${error.message}`);
      return;
    }

    void qc.invalidateQueries({ queryKey: ["takeoffs"] });
    reset();
    props.onOpenChange(false);
    void navigate({ to: "/takeoff", search: { id: row.id } });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) reset();
        props.onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New takeoff</DialogTitle>
          <DialogDescription>
            A plan-set PDF (every sheet becomes a page) or an aerial screenshot (PNG or JPEG), up to
            100 MB.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="takeoff-file">Plan file</Label>
            <Input
              id="takeoff-file"
              type="file"
              accept={ACCEPT.join(",")}
              disabled={!!busy}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {fileSize(file.size)}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="takeoff-name">Name</Label>
            <Input
              id="takeoff-name"
              value={name}
              disabled={!!busy}
              placeholder="e.g. Smith Warehouse roof"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={!!busy}
              onClick={() => {
                reset();
                props.onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!file || !name.trim() || !!busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> {busy}
                </>
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
