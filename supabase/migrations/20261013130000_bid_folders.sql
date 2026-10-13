-- Bid folders (owner, Oct 13: "Bid Advantage, when a bid was saved, was able to save it in a
-- file, so Bell County Schools could be saved under a folder separately from the other bids.
-- Can we offer something like that?" → "ok lets just do a by folder view that you assign").
-- Idempotent: every statement can run again.
--
-- bids.folder is a label the user puts on a bid — NOT derived from the customer (the customer's
-- name is only the default the picker suggests). Null = unfiled, shown as "Unfiled" last in the
-- Bids page's "By folder" view. The app normalizes it (bids-folders.ts normalizeFolder: trimmed,
-- inner whitespace collapsed, at most 80 characters, blank → null) and treats spellings that
-- differ only in case as one folder (folderKey), so the index is on lower(folder). Set from the
-- estimator's Setup › Bid Info "Folder" box (saveBid), the Bids page's "Move to folder…"
-- (setBidFolder, one or several bids) and a folder's "Rename" (renameBidFolder). The bids_audit
-- trigger (audit_row) records the change like any other column.
--
-- No backfill from imported Bid-Advantage bids: a legacy .bax carries no folder or path (the
-- folder was only where the file sat on disk; the importer sees the file name alone).
alter table public.bids
  add column if not exists folder text;
comment on column public.bids.folder is
  'Folder the user filed the bid under (owner, Oct 13; a label, not the customer); null = unfiled. Normalized by the app; case-insensitive (lower(folder)).';

create index if not exists bids_folder_idx on public.bids (lower(folder))
  where folder is not null and deleted_at is null;
