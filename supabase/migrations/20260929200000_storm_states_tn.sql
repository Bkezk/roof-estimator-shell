-- Storm watch covers Tennessee too (owner, Sep 29: "we actually cover TN as well").
alter table public.storm_settings alter column states set default '{KY,TN}';
update public.storm_settings set states = '{KY,TN}' where id = 1 and not ('TN' = any(states));
