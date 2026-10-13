# Testing log

What testers said and what changed because of it, kept as it happens so the Google Play
production-access questionnaire (after the 14-day closed test) is easy to answer: how testers
were recruited, how they engaged, what feedback came in and what was changed. See
`docs/release-plan.md` (D10) for the closed-test plan.

This repo is public: **no names, emails or other personal details here.** The source is just
the track the feedback came through: Internal Test, Closed Test, Open Test or Production.

## Timeline

| Date | Event |
|---|---|
| 2026-10-09 | Internal testing starts (build 2) with a small email list of testers. |
| 2026-10-09 | Closed test (Alpha) submitted with build 5; approved and published the same day. Testers join through the Google Group; Australia only. |
| 2026-10-12 | Discussed with Street Library sharing the test with its members (newsletter and socials). |
|  | 12th tester opted in (14-day clock starts): _to fill in_ |
|  | Day-7 survey sent: _to fill in_ |
|  | Production access applied for: _to fill in_ |

## Feedback and changes

Newest last. "Build" is the first build with the change.

| Date | Source | Feedback | Change | Build |
|---|---|---|---|---|
| 2026-10-09 | Internal Test | The start-up screen showed a placeholder ("a Metro/Expo loading screen"), and the home-screen icon was the template grid. | Real launcher icon and start-up screen from the app icon. | 3 |
| 2026-10-09 | Internal Test | The map is empty on first launch until nearby areas load; could the app have every library from the start? | The app downloads the whole map (~6,000 libraries) on first launch and checks for updates daily; areas still refresh as they're viewed. | 4 |
| 2026-10-09 | Internal Test | With the whole map loaded, there was no sign the app was checking a new area. | "Updating libraries…" shows again while an area is checked for the first time. | 5 |
| 2026-10-12 | Closed Test | Google Play said "Item not found" right after joining the group. | Testers page explains the delay and to try again in an hour. | (site) |
| 2026-10-12 | Closed Test | Not obvious how to open a library's full details. | A visible "Details ›" link on the library card; a "Visited today" pill replaces the old Details button. | 8 |
| 2026-10-12 | Internal Test | Keeper descriptions were mostly stock filler and never needed (confirmed by a review of 60 random listings). | Descriptions removed from the app (still on the linked Street Library page); the whole-map download halves to ~210 KB. | 8 |
| 2026-10-12 | Closed Test | "Looks awesome"; asked about iPhone. | None yet: iPhone noted for after the Android release. | – |
| 2026-10-14 | Closed Test | Joining was hard: links opened in Facebook's built-in browser (not signed in to Google), people didn't realise joining the group was essential, and Play's delay before install was confusing. | Testers page rebuilt as a two-step checklist that explains why each step matters, asks people to confirm they joined, remembers progress, and in Facebook/Instagram/Messenger offers to reopen in Chrome. | (site) |

## Other changes during testing

Not from tester feedback, but worth mentioning as work done during the test.

| Date | Change | Why | Build |
|---|---|---|---|
| 2026-10-12 | Code shrinking (R8) for release builds; mapping files uploaded to Sentry. | Play Console warning; smaller app, readable crash reports. | 8 |
| 2026-10-12 | Landscape and large-screen support; compact details header on short screens. | Play Console warning about orientation locks on large screens (Android 16). | 8 |
| 2026-10-12 | Server health check, error reporting and uptime monitoring (`docs/monitoring.md`). | Catch problems before testers report them. | (server) |
