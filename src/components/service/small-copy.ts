/**
 * The small copy of one picture, made in the browser from the full picture (field-utils
 * makeThumb), uploaded beside it and recorded on its row (setPhotoThumb). Null when this browser
 * cannot decode the file; throws when the download, the upload or the record fails. Shared by
 * the viewer's backfill (field-shared.tsx backfillThumb) and Setup's "Small copies for older
 * pictures" card (picture-copies-card.tsx; the Nov 4 check, finding 3). A copy that already sits
 * in the bucket (an earlier run that stopped before the row was written) is simply recorded.
 */
import { makeThumb, thumbPathFor, uploadToServiceBucket } from "@/components/service/field-utils";
import { setPhotoThumb } from "@/lib/service-field.functions";

export async function makeSmallCopy(
  photo: { id: string; service_job_id: string; storage_path: string },
  fullUrl: string,
): Promise<string | null> {
  const res = await fetch(fullUrl);
  if (!res.ok) throw new Error(`could not download the picture (${res.status})`);
  const small = await makeThumb(await res.blob());
  if (!small) return null;
  const path = thumbPathFor(photo.storage_path);
  try {
    await uploadToServiceBucket(path, small.blob, small.type);
  } catch (e) {
    if (!/already exists|duplicate/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
  const row = await setPhotoThumb({
    data: { id: photo.id, service_job_id: photo.service_job_id, thumb_path: path },
  });
  return row.thumb_path ?? path;
}
