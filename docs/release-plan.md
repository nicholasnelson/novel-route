# Release plan (Android v1)

Status: **planning** — written 2026-10-07, before build work starts.
Target: Google Play (Android). iOS is not in scope for v1, but no decision here should rule it out.

Related docs:
- [maps.md](./maps.md) — map provider decision (Mapbox) and implementation plan
- [server.md](./server.md) — MVP data server
- [visit-log.md](./visit-log.md) — visit log replacing the visited flag

---

## Decisions

| # | Topic | Decision | Status |
|---|-------|----------|--------|
| D1 | Local storage | Move from AsyncStorage to `expo-sqlite` (libraries cache + visit log) | Decided |
| D2 | Data source | App talks to our own server; the server is the only thing that calls the Street Library API | Decided |
| D3 | Rate limiting | Server caches the upstream API and never spams it; app caches server responses and never spams the server. The old "one API call per area per day, on device" rule is retired | Decided |
| D4 | Submissions | **Not in v1.** Server MVP is read-only. ID scheme reserves room for community submissions later | Decided |
| D5 | Visited state | Replace boolean visited set with a visit log (see visit-log.md) | Decided |
| D6 | App name | **Novel Route** | Decided (store and trade mark checks clear) |
| D7 | Package / bundle ID | `app.novelroute` (reverse of the novelroute.app domain). Permanent once uploaded to Play | Decided |
| D8 | Map provider | Mapbox via `@rnmapbox/maps` (free up to 25k MAU; data-driven marker layers; native clustering). See maps.md | Decided |
| D9 | Privacy policy hosting | Cloudflare (Workers static assets) at https://novelroute.app/privacy | Done |
| D10 | Closed testing | Ask Street Library Australia for a tester group (see below) | In progress |

---

## D6 — App name

**Novel Route** — "novel" as in a book *and* something new, "route" as in doing your rounds of local book boxes (and the planned walk-route feature). Suits the target audience: regular street library visitors checking their boxes for fresh stock.

Store title (30 char max), e.g. `Novel Route: Book Box Finder` (28). Keep "Street Library" out of the title; ask Street Library Australia before using their name in the description.

Constraints it meets:
- No "Street Library" (Street Library Australia's name; Play impersonation policy).
- No "Little Free Library" (US registered trade mark) or "Nook" (Barnes & Noble's e-reading brand).
- Nothing that echoes Pokémon.

Availability checks (2026-10-07):
| Check | Result |
|-------|--------|
| Web search for apps named "Novel Route" | None found. Nearest: "LiteraryTrip: Book Routes" (iOS, literary walking tours — different concept) |
| Web search for "Novel Route" trade marks | None found |
| GitHub `novelroute` | Available |
| `novelroute.com` | Taken (registered 2020) |
| `novelroute.app` | Being registered by the owner |
| `novelroute.com.au` | Appears unregistered (needs an ABN / Australian presence to register) |
| Google Play / App Store exact search | No clashes (checked by owner) |
| IP Australia trade mark search, classes 9 and 42 | No clashes (checked by owner) |

`novelroute.app` hosts the landing page and privacy policy (Cloudflare).

## D7 — Package / bundle ID

A domain is **not** required. Android only needs the application ID to be unique on Play and syntactically valid (letters, digits, underscores, dot-separated, each segment starting with a letter — **no hyphens**). Reverse-domain is a convention, not ownership proof.

Options:
- `io.github.nicholasnelson.<appname>` — the original plan before a domain was registered. Backed by the GitHub account; survives domain lapses.
- `com.<personal-domain>.<appname>` — fine, but ties the app's permanent ID to your personal domain.
- Registering a project domain is optional. Worth it only if you want a nice home for the privacy policy / landing page; it doesn't affect the package ID.

Rules:
- Use the **same ID** for `android.package` and `ios.bundleIdentifier` in `app.json`.
- **Chosen: `app.novelroute`**, the reverse of the `novelroute.app` domain (registered by the owner). The app keeps working even if the domain lapses, but keep it renewed so the ID stays unambiguously ours.
- It's visible in the Play URL but not prominent; it doesn't need to match the display name forever. Pick something neutral enough to survive a rename.

## D9 — Privacy policy

Play requires a privacy policy URL because the app uses location. Requirements: publicly accessible, active, not geo-blocked, not a PDF, and it must name the app/developer.

Hosted at **https://novelroute.app/privacy** (`apps/site`, Cloudflare Workers static assets; moved from GitHub Pages so domain, DNS, API and site live in one Cloudflare account). Linked from the app's map key; add it to the Play listing.

Content to cover (must match the Data safety form):
- Precise location is used **on device** to centre the map and detect nearby libraries. It is not stored on our server.
- The app sends the visible map area (approximate location) to our server to load libraries. State what the server logs (IP, request) and for how long.
- Visit history is stored only on the device.
- Mapbox receives map tile requests (IP, approximate viewed area) and, unless telemetry is disabled in-app, SDK telemetry. Name Mapbox and link its privacy policy.
- No accounts, no ads, no analytics. Crash reports go to Sentry (EU): error, stack trace, app version, device model, OS version; no IP (Sentry setting), location scrubbed on device (`apps/mobile/src/monitoring/scrub.ts`).

Data safety form (Play Console) answers to give:
- **Location — approximate**: collected, shared with service providers (library data service, Mapbox) for app functionality; not stored by us; not optional for the core feature.
- **Location — precise**: used on device only, not collected (never leaves the device).
- **App activity — visit history**: stays on device; not collected.
- **App info and performance — crash logs and diagnostics**: collected (Sentry) for app functionality/analytics of crashes; not shared for advertising.
- **Device or other IDs**: not collected (Sentry has `sendDefaultPii` off and IP storage disabled).
- Data encrypted in transit: yes (HTTPS). Users can request deletion: crash reports via the contact address.

## D10 — Closed testing (the long pole)

New personal Play developer accounts must run a closed test with **at least 12 testers, opted in continuously for 14 days**, before production access. If the count drops below 12, the clock resets. Google also checks testers actually use the app. Organisation accounts are exempt, but need a D-U-N-S number — not worth it here.

Plan:
- Re-contact Street Library Australia. Ask for:
  1. A small group of volunteer testers (library stewards would be ideal real-world testers).
  2. Their blessing for the app using their public library data, and whether they'd prefer a supported data feed over the website endpoint.
  3. Whether they're happy with how the app is described/branded.
- Aim for 15–20 testers so drop-outs don't reset the clock.
- Start the closed test as soon as Phase 1 is stable; build the server while the 14 days run.
- Fallbacks: friends/family, local community groups; paid "tester" services are a last resort and risky given Google's engagement checks.

### Testers and feedback (decided 2026-10-09)

- **Opt-in: a Google Group**, `novel-route-testers@googlegroups.com`, added as the closed track's tester list. Testers join and leave themselves and we never hold a list of addresses. Settings: anyone can join (no approval wait; the group can't be misused since only managers post and members are hidden), members hidden from each other, only managers can post (so the group can carry the odd update and the survey, nothing else).
- **Joining:** https://novelroute.app/testing explains the three steps (join the group, opt in at `https://play.google.com/apps/testing/app.novelroute`, install), what to try, and how to leave. The site's "Help us test" button points there.
- **Feedback channels:** Sentry for crashes (automatic); in-app *Send feedback* in the map key (email to hello@novelroute.app with app version, build and phone model, never location: `apps/mobile/src/feedback.ts`); the Play testing feedback channel, set to hello@novelroute.app; one five-question Google Form about a week in, sent through the group.
- **Privacy:** tester reports can mention where people live, so they're triaged privately; GitHub issues are written up in our own words.

---

## Work phases

### Phase 1 — Foundations
- [x] Finish D6 store and trade mark checks (no clashes found)
- [x] Update `app.json`: `name` "Novel Route", `slug` `novel-route`, `android.package` / `ios.bundleIdentifier` `app.novelroute`; remove duplicate permissions
- [x] `package.json` name and README renamed
- [x] Old EAS project ID removed from `app.json`
- [x] `eas init`: new `novel-route` EAS project (owner `ausshb`)
- [x] Rename the GitHub repo (`nicholasnelson/novel-route`)
- [x] Upgrade to the current stable Expo SDK (57)
- [x] Fix `start` script (`expo start`); add `typecheck`, lint (`eslint-config-expo`), tests (`jest-expo`)
- [x] `expo-sqlite` storage layer (no import of pre-SQLite data: the app ID changed, so old installs are a separate app)
- [x] Visit log (visit-log.md), including migration of existing visited IDs and `sl:` ID prefix
- [x] Mapbox account and dedicated public token (in `.env.local`, not in git)
- [x] Token as an EAS env var (all environments, plaintext)
- [ ] Mapbox usage alerts (maps.md)
- [x] Map spike on the emulator: 3,000 points, freshness colours, clustering, taps
- [ ] Repeat the map check on a real mid-range Android phone
- [x] Replace WebView/Leaflet with `LibraryMap` on `@rnmapbox/maps`; remove `react-native-webview`
- [x] Strip/decode HTML in excerpts (`<br />`, entities)
- [x] Fetch hardening: `res.ok`, timeouts, user-visible offline/error state
- [x] Error boundary
- [x] Crash reporting: Sentry (EU region, errors only, no IPs/PII, location scrubbed on device, disabled in dev builds)
- [x] `SENTRY_AUTH_TOKEN` in EAS (preview + production) so builds upload source maps
- [x] "About" screen: privacy policy link, data source disclaimer (in the map key; Mapbox attribution stays on the map itself)

### Phase 2 — Closed testing (≥14 days)
- [ ] Play Console app created; Play App Signing with EAS-managed keystore
- [x] Landing page and privacy policy live at https://novelroute.app (`apps/site`, Cloudflare)
- [x] API at https://api.novelroute.app; EAS `EXPO_PUBLIC_API_URL` points there
- [x] Set up `hello@novelroute.app` (Cloudflare Email Routing → Gmail; used on the site and in the policy)
- [ ] Privacy policy URL in Play Console (already linked from the app's map key)
- [x] Update the privacy policy when the server replaces the direct Street Library calls
- [ ] Data safety form, content rating questionnaire, store listing (icon, screenshots, feature graphic)
- [ ] Confirm target API level and 16 KB page size compliance with the upgraded SDK
- [x] Google Group `novel-route-testers` created (settings above)
- [ ] Google Group set as the closed track's testers
- [x] Testers page (https://novelroute.app/testing) and in-app *Send feedback*
- [ ] Play testing feedback channel set to hello@novelroute.app
- [ ] Week-one survey (Google Form, five questions)
- [ ] Closed test track live with ≥12 opted-in testers

### Phase 3 — Server (in parallel with Phase 2)
- [x] Monorepo: `apps/mobile`, `apps/server`, `apps/site`, `packages/shared`
- [x] Build MVP server (server.md): Hono on Workers + D1, tested locally against the real Street Library endpoint
- [x] App uses the server when `EXPO_PUBLIC_API_URL` is set; direct Street Library client otherwise (dev)
- [x] CI: typecheck, lint, tests and Worker bundle on every push (`.github/workflows/ci.yml`)
- [x] Deployed to `https://novel-route-api.novel-route-server.workers.dev`; Street Library accepts requests from Cloudflare
- [x] Privacy policy updated for the server as data source
- [x] `EXPO_PUBLIC_API_URL` set in EAS preview/production
- [ ] Ship server-backed build to the closed test track

### Phase 4 — Production
- [ ] Check Mapbox usage against the free tier before launch
- [ ] `eas submit` service account configured (`eas.json` → `submit.production`)
- [ ] Production release

---

## Reference: facts established so far

From a live call to the Street Library endpoint (2026-10-07, Adelaide CBD):
- Returns at most **200** libraries, nearest first. In Adelaide CBD the 200th was 12.2 km away. There is no radius parameter.
- IDs are stable WordPress post IDs (`"45760"`).
- `latitude`/`longitude` are strings; `distance` is km.
- `excerpt` contains HTML (`<br />`) and typographic characters.
- Nonce endpoint returns `{"success":true,"data":{"nonce":"…"}}`.
