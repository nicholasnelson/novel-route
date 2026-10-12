# Monitoring

Goal: hear about a problem with the app, the API or the site from an alert, not from a tester. Everything here is on free tiers, and nearly every alert comes from Sentry (email, or the Sentry phone app).

The most likely failure is a quiet one. If Street Library changes its site or nonce, nothing crashes: the app keeps showing cached libraries and they slowly go stale. The health check is built to catch that.

## What catches what

| Problem | Caught by | Within |
| --- | --- | --- |
| API down (Worker, DNS, certificate) | Sentry uptime monitor on `/v1/health` | a few min |
| D1 failing or over its free-tier daily limits | Sentry uptime monitor (`/v1/health` reads D1, so a failure is a 503) and a Sentry `request` error | a few min |
| Street Library calls failing (site changed, nonce, blocking Cloudflare) | `/v1/health` 503 after 3 failures in a row, one Sentry `upstream` event, and the `seed-cron` monitor | ~15 min |
| Seed cron stopped running | Sentry `seed-cron` monitor (missed check-ins); `/v1/health` after 12 h without a successful call | ~10 min |
| Site down | Optional UptimeRobot monitor on `https://novelroute.app/` (static files on Cloudflare, rarely down) | ~5 min |
| App crashes | Sentry app project, Play Console Android vitals | minutes / a day |
| App can't sync (API error status, bad response, SQLite failure) | Sentry app project, tag `area:sync` | minutes |
| Mapbox usage running away (e.g. a leaked token) | Mapbox usage alerts | a day |
| Domain or certificate about to expire | Registrar auto-renew; optional UptimeRobot expiry reminders | weeks ahead |

## In the code

### `GET /v1/health` (`apps/server/src/cache.ts` `getHealth`)

Returns `200 {"ok":true,…}`, or **`503`** with a `problems` list when:
- the last 3 Street Library calls failed (`meta.upstream_failures`; a success clears it), or
- no call has succeeded for 12 h. Seeds make ~100 calls a day, spread out as their circles age, so this means the cron or upstream has stopped. A fresh database counts too, until the first call succeeds.

A database failure is a 503 as well (via `onError`). The response is `Cache-Control: no-store`.

### Server errors to Sentry (`apps/server/src/monitoring.ts`)

The Worker posts events straight to Sentry's envelope endpoint. The Sentry Workers SDK isn't used because it wraps every D1 query and starts a client on every request, and the free plan doesn't have that CPU to spare. This reporter costs nothing until something fails.

- Tag `where`: `request` (any 503 from `onError`), `upstream` (once per outage, on the 3rd failure in a row), `fill` / `seeds` (non-upstream failures while filling, e.g. D1).
- At most one event per message per 10 minutes per isolate. A Sentry key rate limit (below) is the backstop.
- Privacy is the same as the app: no IP or headers, only the method and path, and everything passes through `scrubDeep` (`packages/shared/src/scrub.ts`), which removes coordinates and tile IDs.
- Off when the `SENTRY_DSN` secret isn't set (tests, local dev).

### Seed cron monitor

Each cron run sends one check-in to the Sentry Cron Monitor `seed-cron`: `ok`, or `error` if a Street Library call failed. The monitor creates itself from the first check-in (schedule `*/5 * * * *`, 5 min margin), and opens an issue after 3 failed or missed runs in a row.

### App (`apps/mobile/src/monitoring/sentry.ts`)

- Crashes and render errors (ErrorBoundary), as before.
- `reportOnce` covers sync problems the user only sees as a pill: the API answering a tile or snapshot request with an error status, a malformed body, or a SQLite failure while syncing. Each is reported once per message per app run and tagged `area:sync`. Being offline or timing out (`isConnectionError`) isn't reported. Messages never include the tile.

## One-off setup

### 1. Sentry project for the server
1. In the existing Sentry org (EU), create a project `novel-route-server` (platform: Cloudflare Workers, or plain JavaScript).
2. Copy its DSN, then from `apps/server`: `npx wrangler secret put SENTRY_DSN` (paste the DSN), and `npm run deploy`.
3. In the project's settings: **Security & Privacy → Prevent Storing of IP Addresses** on, matching the app project.
4. **Client Keys (DSN) → Configure → Rate limit**: about 50 events per hour. Do the same on the app project, with a limit to suit the number of testers. This protects the monthly quota if something errors on every request.
5. Check it works: within 5 minutes, **Crons** should list `seed-cron` with `ok` check-ins.

### 2. Uptime monitor (Sentry)
Sentry's free plan includes one uptime monitor, checked from outside Cloudflare. Use it for the API, since `/v1/health` covers the Worker, D1, Street Library and the cron.
1. In the `novel-route-server` project: Alerts → Create Alert → **Uptime Monitor** (or Insights → Uptime, depending on Sentry's current menus).
2. URL `https://api.novelroute.app/v1/health`, method GET, interval 1 minute, environment `production` (type it in if the list is empty: Sentry only lists environments it has seen, and the server tags its reports `production`). Any status other than 2xx counts as down, which includes the 503 the health check returns for a problem.
3. Assign it to yourself so failures email you. Sentry opens an issue after a few failed checks in a row and resolves it when checks pass again.
4. Cost: 1,440 requests a day (1.4 % of the Workers free plan's 100,000) and about 2,900 D1 rows read (of 5M), with no writes. Uptime checks don't use the Sentry error quota. A 5-minute interval cuts that to 288 requests, if you'd rather.

Optional, for the site: a free UptimeRobot monitor on `https://novelroute.app/` (HTTP every 5 min, keyword `Novel Route`), with its SSL certificate and domain expiry reminders turned on. The site is static files on Cloudflare and rarely breaks, so this matters less than the API check. Make sure the domain is set to auto-renew either way.

### 3. Sentry alert rules
As set up on 2026-10-12 (Alerts in the `nelson-9e` org):
- **"Notify on new or regressed issues (app)"** and **"(server)"**: email on *every* new issue and on regressions (a resolved issue coming back). New projects come with a rule for high-priority issues only. Sentry decides priority itself, and handled errors (the server's reports, the app's `area:sync` problems) are often medium, so that default rule would stay silent.
- **"Notify Nicholas"**: attached to the uptime monitor and to `seed-cron`. It emails when either opens an issue (3 failed or missed checks in a row), when the issue is resolved (recovered), and on regressions.
- **Spike Protection**: on.
- **Still to add near public release**: a spike rule for the app ("Number of events in an issue is more than 20 in 1 hour" → email), to catch a crash that's affecting everyone after a release. With only a few testers it isn't worth having yet.
- **Optional**: if issues tagged `area:sync` turn out to be noisy, give them a separate, quieter rule.
- Sentry no longer seems to offer the weekly report email, so there's nothing to set up for it.

### 4. Other services
- **Mapbox usage alerts** (also in `maps.md`): Account → Statistics or Billing → usage notifications for mobile Maps SDK MAUs at about 50 % and 80 % of the 25,000 free tier. Record there whether a hard cap is possible.
- **Play Console → Android vitals**: watch crash rate and ANR rate (Google's bad-behaviour thresholds are 1.09 % and 0.47 %). Turn on vitals emails under Play Console → Settings → Notifications. Vitals catch native crashes that happen before the JS (and Sentry) loads.
- **Cloudflare**: no notifications needed. The free plan offers little here, and Sentry already covers D1 hitting its limits (uptime monitor and `request` errors), Worker errors and the cron. Do make sure `novelroute.app` is set to **auto-renew** (Domain Registration in the dashboard, if it's on Cloudflare Registrar): a lapsed domain takes down the API, the site and the privacy policy link at once.

## When an alert fires

- **`/v1/health` says "Street Library calls failing"**: `npx wrangler tail` (from `apps/server`) shows the upstream error. Check the tiles table's `last_error`. Try the confirmed request from `CLAUDE.md` by hand: has the response shape, the nonce action or the referrer check changed? The app keeps working from the cache in the meantime.
- **"No successful Street Library call in the last 12 hours", with no failures**: the cron isn't running. Check `seed-cron` in Sentry and Workers → Triggers in the Cloudflare dashboard.
- **Sentry `request` errors / 503s**: usually D1. Check the D1 dashboard for rows read and written today. The free-tier limits reset at 00:00 UTC. See `server.md` for the 2026-10-07 incident.
- **Site down**: check the Cloudflare status page, then redeploy with `npm run deploy` from `apps/site`.
- **App crash spike after a release**: halt the staged rollout in Play Console, then fix forward.
