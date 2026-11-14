# Framework update, Nov 14 2026

From the Nov 14 security audit. Owner: "Go with 3 (is this a large and difficult undertaking?)".

## What was wrong

The site ran TanStack Start 1.168.32, from July. On Sep 30 its maker published
CVE-2026-102989, rated critical: in every version below 1.168.60 a crafted link to a server
function can make the site answer with the attacker's page. The data format underneath it,
seroval, had several advisories of its own up to 1.6.7.

The audit could not prove an attack. The site already refuses server-function requests that do
not come from the site itself. The maker says that is not a complete fix, so the update was due.

## What changed

| Package | Was | Now |
| --- | --- | --- |
| `@tanstack/react-start` | 1.168.32 | 1.168.60, the first fixed release |
| `@tanstack/react-router` | 1.170.18 | 1.170.41, the one that release is built with |
| `@tanstack/router-plugin` | 1.168.23 | 1.168.42, the same |
| `@tanstack/start-server-core` | 1.169.17 | 1.169.39 |
| `seroval` | 1.5.6 | 1.8.1 |

One line of the site's own code changed: the error screen now accepts whatever was thrown,
which is how the updated router hands it over.

It was a small job: three version numbers, one line, and the tests below.

## Proof

- The advisory list no longer names the framework or seroval. 44 advisories before, 36 after.
  Critical ones: 6 before, 3 after. The 3 left are in tools used only while building and
  testing (`tinypool`, `shell-quote`). They never run on the site.
- Lint 0 errors, types clean, 7,394 tests pass, the build succeeds.
- Every page before and after, on the local server against the live database as an admin:
  32 pages, 274 server calls before and 273 after, 0 errors, 0 console errors, 0 crashes both
  times. Text and headings match on all 32. The one call of difference is on the first page
  after signing in.
- A save through a server function still works: a switch on Account flipped and flipped back.
- Outside requests to a server function are still refused on the new version: no headers, a
  cross-site request and a foreign origin all answer 403.
- The frame rule is still on every page.

Not live until the next publish.

## Still open, by choice

`xlsx`, the spreadsheet reader, has two advisories with no fixed release on the package
registry. Only signed-in staff can hand it a file. `zod` has one that needs a major version jump.
Neither was touched.
