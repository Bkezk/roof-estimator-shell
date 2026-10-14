-- Reconcile note wording (owner, Oct 14: "on the note on reconcile it's still showing app
-- instead of inventory"). addMovement writes "Short: inventory had …" since Oct 9; one entry
-- (#34, Oct 9 12:12 PM) was written by the earlier code and still read "the app had". The
-- stored note is rewritten; no code path writes the old wording. Applied live Oct 14.
update public.inventory_movements
set note = replace(note, 'Short: the app had ', 'Short: inventory had ')
where note like '%Short: the app had %';
