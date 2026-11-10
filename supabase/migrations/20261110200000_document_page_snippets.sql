-- Saved snippets: a snippet can hold a whole page (owner, Nov 10: "can a snippet be a whole page
-- of different modules … saved to where I could click to insert it on a new page").
-- `page_modules` is the page's modules in order (an array of DocModule); null = the snippet is
-- the single module in `module`, as before. A page snippet keeps its first module in `module`
-- too, so a page that only knows single-module snippets still lists it.
alter table public.document_modules add column if not exists page_modules jsonb;
comment on column public.document_modules.page_modules is
  'A page snippet: the page''s modules in order. Null = a one-module snippet (module).';
