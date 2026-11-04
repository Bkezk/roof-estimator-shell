/**
 * Setup › "Small copies for older pictures" (the Nov 4 check, finding 3). Every picture taken
 * since Nov 3 goes up with a small copy for the thumbnails; the ones from before had none until
 * someone who may edit that ticket opened its page, so History at a property still pulled every
 * full-size picture (30 × 2 MB on one fold). This card makes the missing copies in one go, here
 * in the browser the way the phone does (field-shared.tsx makeSmallCopy): a batch of rows with
 * their links signed in one call (listPhotosWithoutThumb), each picture downloaded once, shrunk
 * to 320 px, uploaded beside the original and recorded on its row. The full pictures are never
 * changed. Managers and admins; the card says how many are left and what could not be made.
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Images, Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { plainErrText } from "@/lib/plain-error";
import { listPhotosWithoutThumb } from "@/lib/service-field.functions";
import { makeSmallCopy } from "@/components/service/small-copy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const PHOTOS_WITHOUT_THUMB_KEY = ["photos-without-thumb"] as const;

type Progress = { done: number; failed: number; lastError: string | null };

export function PictureCopiesCard() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listPhotosWithoutThumb);
  const q = useQuery({
    queryKey: PHOTOS_WITHOUT_THUMB_KEY,
    queryFn: () => listFn(),
    enabled: !!session,
    staleTime: 60_000,
  });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  // Rows that failed this run are skipped on the next round, so a bad picture never loops.
  const tried = useRef(new Set<string>());

  const run = async () => {
    setRunning(true);
    const p: Progress = { done: 0, failed: 0, lastError: null };
    setProgress({ ...p });
    try {
      for (let round = 0; round < 200; round++) {
        const batch = await listFn();
        const todo = batch.photos.filter((ph) => !tried.current.has(ph.id));
        if (!todo.length) break;
        for (const ph of todo) {
          tried.current.add(ph.id);
          try {
            if (!ph.url) throw new Error("no link for the picture");
            const path = await makeSmallCopy(ph, ph.url);
            if (path) p.done++;
            else {
              p.failed++;
              p.lastError = "this browser cannot read the picture";
            }
          } catch (e) {
            p.failed++;
            p.lastError = plainErrText(e);
          }
          setProgress({ ...p });
        }
      }
    } finally {
      setRunning(false);
      void qc.invalidateQueries({ queryKey: PHOTOS_WITHOUT_THUMB_KEY });
    }
  };

  const left = q.data?.total ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Images className="h-5 w-5" aria-hidden /> Small copies for older pictures
        </CardTitle>
        <CardDescription>
          Pictures taken since Nov 3 carry a small copy for the thumbnails; older ones are shown
          full-size until a copy is made. This makes the missing copies here, one picture at a time.
          The full pictures are not changed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.error ? (
          <p className="text-sm text-destructive">Could not count them: {plainErrText(q.error)}</p>
        ) : left === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Counting…
          </p>
        ) : left === 0 ? (
          <p className="text-sm text-muted-foreground" data-line="copies-none">
            Every picture has its small copy.
          </p>
        ) : (
          <p className="text-sm" data-line="copies-left">
            {left} {left === 1 ? "picture has" : "pictures have"} no small copy yet.
          </p>
        )}
        {progress && (
          <p className="text-sm text-muted-foreground" data-line="copies-progress">
            {progress.done} made{progress.failed ? `, ${progress.failed} could not be made` : ""}
            {progress.lastError ? ` (${progress.lastError})` : ""}
            {running ? "…" : "."}
          </p>
        )}
        <Button
          type="button"
          disabled={running || !left}
          onClick={() => void run()}
          data-action="make-copies"
        >
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {running ? "Making the copies…" : "Make the small copies"}
        </Button>
      </CardContent>
    </Card>
  );
}
