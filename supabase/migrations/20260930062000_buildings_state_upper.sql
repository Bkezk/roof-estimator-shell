-- A state typed by hand was stored as typed ("tn"), and the Buildings list reads anything not
-- exactly 'TN' as Kentucky, so a hand-typed Tennessee building was filed under Kentucky.
-- saveBuilding now stores the two-letter code upper-case; this files the rows already saved.
-- Safe to re-run (touches only rows that are not already upper-case and trimmed).
update public.buildings
   set state = upper(trim(state))
 where state is distinct from upper(trim(state));
