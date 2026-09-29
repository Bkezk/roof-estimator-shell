# SAM.gov federal roof jobs — a third feed, once you hold a key

**Why.** Fort Knox, Fort Campbell, the VA hospitals in Louisville and Lexington and the Corps of
Engineers' Louisville District post their roof replacements on SAM.gov, the federal contract
opportunities site. There is a free API, but every pull needs a key tied to a SAM.gov account,
so this feed waits on you. (Checked Sep 29, 2026.)

**What you do once (about 20 minutes).**

1. Create a login at https://sam.gov (it uses Login.gov; a personal account is fine — the key
   does not require the company to be registered as a vendor, though registering JBK as an
   entity raises the daily limit from about 10 pulls to about 1,000; ten is enough for nightly).
2. Sign in, open **Account Details**, and under **Public API Key** request a key. It is shown
   once; copy it.
3. Put it in Lovable Cloud › Secrets as `SAM_GOV_API_KEY`. Never paste it into chat or the
   repo.

**What the app will do with it.** A `sam_gov` lead source next to the others in
`src/lib/leads.server.ts`: one nightly call to the Get Opportunities v2 search endpoint filtered
to NAICS 238160 (Roofing Contractors) with Kentucky as the place of performance and a posted
window of the last 30 days; each opportunity becomes a lead with its title, agency, city,
response deadline (as the bid date), set-aside and the SAM.gov link. Tell me when the secret is
in place and I'll add it.

**Sep 29: Tennessee too.** The daily pull now makes two calls, place of performance KY and TN
(Fort Campbell straddles the line; Arnold AFB, the Nashville and Memphis VA hospitals, the
Corps' Nashville and Memphis Districts), still once a day. Each lead's `state` is the
opportunity's place-of-performance state.
