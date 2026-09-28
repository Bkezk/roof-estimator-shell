# Open records request: DHBC commercial plan review log (monthly)

**Why.** Any commercial project over 10,000 sq ft or 100 occupants in a county without its own
building department goes to the state Department of Housing, Buildings and Construction (DHBC)
for plan review before construction starts — most of eastern Kentucky. DHBC's old public
project search is gone and its new portal shows nothing without an account, so the list is
reachable only by an open records request. (Checked Sep 28, 2026.)

**Where to file.** The Public Protection Cabinet takes requests for DHBC through its online
form: https://ppc.ky.gov/NewOpenRecords.aspx (help line 502-564-5525). The Cabinet must answer
in writing within five business days (KRS 61.872(5)). Each month is its own request; the Act
does not bind an agency to a standing order, so re-file the same text with the new month.

**Form choices.**

| Field                                     | Pick                                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This request is                           | FOR a commercial purpose (using the list to find roofing work counts — KRS 61.870(4); saying so up front is required if they ask, and it is not a reason to deny) |
| Requestor is                              | A representative of a domestic business entity with a location in the Commonwealth of Kentucky                                                                    |
| Select Agency                             | DEPARTMENT OF HOUSING, BUILDINGS & CONSTRUCTION                                                                                                                   |
| Name / business / address / email / phone | JBK's, with the person signing named                                                                                                                              |

**Records requested** (paste into the description box; change the month):

> Please provide an electronic export (Excel or CSV preferred; PDF acceptable) from the
> Department of Housing, Buildings and Construction's plan review / permitting system of every
> commercial building plan review application received or approved by the Division of Building
> Codes Enforcement during **[MONTH YEAR]**, statewide, with these fields for each: project
> name; project street address, city and county; owner or applicant name; design professional
> (architect or engineer) and their contact; occupancy or use group; type of work (new building,
> addition, alteration); gross square footage; number of stories; construction cost or estimated
> value if recorded; date received; date approved or current status; plan review or permit
> number. If some of these fields are not kept, please provide the ones that are. If the system
> can produce a standard report with these fields, that report is fine.
>
> This request is for a commercial purpose: the records will be used to identify buildings on
> which our company may solicit roofing work. We understand the Cabinet may charge for staff
> time under KRS 61.874(4) and ask that you tell us the estimated fee before producing the
> records. Please also let us know whether a standing monthly copy of the same export can be
> arranged, or whether we should re-file each month.
>
> Please send the records by email to **[email]**.

**After the first reply.** Note which fields they actually export and the fee; put both in
TODO.md. Once the first file arrives, the loader for it (a `dhbc_plan_review` lead source next
to the planroom and Louisville feeds in `src/lib/leads.server.ts`) is a small job: one row per
project, county from the address, `is_roof` true for every new building and addition.
