# Novel Route API

Cloudflare Worker (Hono + D1) that caches Street Library Australia's data and serves it to the app. Design: [docs/server.md](../../docs/server.md).

## Local development

From the repo root, `npm install` once. Then in `apps/server`:

```bash
npm run db:migrate:local   # create the local D1 database
npm run dev                # http://localhost:8787
npm test                   # vitest (D1 stand-in on node:sqlite, fake upstream)
npm run typecheck
```

Try it: `curl "http://localhost:8787/v1/tiles/r1f9"` (central Adelaide). The first request fills from the real Street Library endpoint (`pending` until the tile is fully covered, a few seconds); repeats come from the cache. `npm run dev` also enables `/__scheduled` to trigger a seed run: `curl "http://localhost:8787/__scheduled"`.

To point the app at a local server: `adb reverse tcp:8787 tcp:8787`, then start Metro with `EXPO_PUBLIC_API_URL=http://127.0.0.1:8787` (from `apps/mobile`).

## Production

Deployed at `https://api.novelroute.app` only (D1 database `novel-route`, Oceania). The `workers.dev` address is off since 2026-10-17: the edge cache doesn't work there. Redeploy with `npm run deploy`; schema changes: add a migration file, then `npm run db:migrate:remote` before deploying. Live logs: `npx wrangler tail`. Error reports and the seed cron monitor go to Sentry when the `SENTRY_DSN` secret is set (`npx wrangler secret put SENTRY_DSN`); alerts and the uptime check: [docs/monitoring.md](../../docs/monitoring.md).

## Deploying (first time)

1. `npx wrangler login`
2. `npx wrangler d1 create novel-route`, then copy the printed `database_id` into `wrangler.jsonc`.
3. `npm run db:migrate:remote`
4. `npm run deploy`. With `workers_dev` off, a new account needs either the custom domain (step 8) first, or `"workers_dev": true` for this check: then note the URL (`https://novel-route-api.<your-subdomain>.workers.dev`).
5. **Check Street Library accepts requests from Cloudflare** (some sites block datacenter IPs):
   `curl "https://novel-route-api.<subdomain>.workers.dev/v1/tiles/r1f9"` should return libraries and, after a few seconds of retries, status `fresh`; `/v1/health` should show a recent `lastUpstreamSuccess`. If tiles stay `pending`, check `npx wrangler tail` for the upstream error.
6. Point the app at it: add `EXPO_PUBLIC_API_URL` (string, plaintext) to the EAS `preview` and `production` environments, then rebuild.
7. Update the privacy policy (`apps/site/privacy.html`) now that the server is the data source.

8. Serve it as `api.novelroute.app` (a Workers custom domain in `routes`; needs the domain's DNS on Cloudflare), set `"workers_dev": false` and redeploy.

## Config

`vars` in `wrangler.jsonc` are returned by `GET /v1/config`: `MAP_STYLE_URL`, `MIN_APP_VERSION`, `MESSAGE`. Change and redeploy, no app release needed.
