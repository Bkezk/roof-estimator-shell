-- Duro-Tuff (roof_system_id 3) parapet-wall adhesive coverage: the 2026-09-03 seed carried the
-- 350 / 300 rows that are COMMENTED OUT in the shipped installer script (<!--INSERT ... (0,3,1,350)-->,
-- <!--INSERT ... (0,3,2,300)-->, BidAdvantage.DataAccess.SqlScript.xml lines 2213-2214) alongside the
-- live -1 rows from the release-2.1 upgrade block (lines 3710-3711). Only the -1 rows exist in the
-- vendor database. The web engine treats -1 as "no wall coverage" (warns, bills 0); the legacy app
-- divides by -1 and SUBTRACTS units - a vendor defect documented in docs/legacy-money-parity.md §22.
delete from public.adhesive_wall_coverage where roof_system_id = 3 and coverage_sqft > 0;
