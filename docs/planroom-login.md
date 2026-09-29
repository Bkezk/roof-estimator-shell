# Planroom sign-in for lead contacts (owner action)

The State of KY online planroom and Lynn Imaging's planroom show a job's owner contact, the
architect or engineer, the bid date and the plan-holder list (the general contractors taking
plans — who a roofing subcontractor bids to) only after a free sign-in. With a login on the
server the nightly leads check reads each open roof job's page and puts that on the card.

1. Register once on each site with the dedicated logins mailbox, the same e-mail and password
   on both: https://www.stateofkyplanroom.com/View/Login.aspx (Register Here) and
   https://www.lynnimaging.com/distribution/View/Login.aspx (Register Here).
2. Lovable Cloud › Secrets: add `PLANROOM_EMAIL` and `PLANROOM_PASSWORD`. Never paste them
   into chat or the repo.
3. Open Leads and press Refresh. The "Checked" note ends with "N job pages read"; a refused
   login shows as a red line with the site's own message.

Limits: 40 job pages per run, each re-read after a week; only open roof leads. The pages'
layout has never been seen from here (it is behind the login), so the first run may read
fewer fields than expected — the raw text of each page is kept on the lead for the next fix.
