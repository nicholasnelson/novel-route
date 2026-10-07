# Novel Route

A mobile app for finding and keeping track of the street libraries (little free book boxes) near you across Australia. Explore the map, log your visits, and see at a glance which boxes you haven't checked in a while.

> **Early WIP / Testing** — This project is under active development and is not yet available on any app store.

> **Disclaimer** — This project is not associated with, endorsed by, or affiliated with Street Library Australia. It uses publicly available data from [streetlibrary.org.au](https://streetlibrary.org.au/).

## Features

- Map of street libraries drawn as little libraries on posts: amber with closed doors if you haven't been, green with open doors after a visit, slowly swinging shut over the months
- Tap a library for a quick preview, or open its details to log a visit, browse or edit your visit history, or get directions
- A card at the bottom points you to the nearest library you're due to visit, and offers one-tap logging when you arrive
- Offline-friendly local cache; library data is refreshed at most once a day per area

## Tech Stack

- [Expo](https://expo.dev/) (SDK 57) with React Native
- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) for the library cache and visit log
- [Mapbox](https://github.com/rnmapbox/maps) maps with native clustering (see [docs/maps.md](docs/maps.md))
- API: [Hono](https://hono.dev/) on Cloudflare Workers with D1 ([apps/server](apps/server))
- TypeScript, ESLint, Jest, Vitest; npm workspaces monorepo

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- For Android: Android Studio with an emulator, or a physical device
- For iOS: Xcode (macOS only) with a simulator, or a physical device (UNTESTED)
- An [Expo dev client](https://docs.expo.dev/develop/development-builds/introduction/) build (this project does **not** run in Expo Go)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/nicholasnelson/novel-route.git
cd novel-route

# Install dependencies for all workspaces (from the repo root)
npm install

# The app lives in apps/mobile
cd apps/mobile

# Add your Mapbox public token (https://account.mapbox.com/access-tokens/)
echo "EXPO_PUBLIC_MAPBOX_TOKEN=pk.your-token" > .env.local

# Create a development build (first time only)
npx expo run:android   # or: npx expo run:ios

# Afterwards, start the dev server
npm start
```

Without `EXPO_PUBLIC_API_URL` the app calls the Street Library site directly (development). To use the API, run it locally ([apps/server/README.md](apps/server/README.md)) or set the deployed URL.

Checks, for every workspace (also run by CI on each push):

```bash
npm run typecheck
npm run lint
npm test
```

## Project Structure

```
apps/
├── mobile/            # Expo app
│   ├── src/data/      # Cache refresh (batched cells from the API, or Street Library directly in dev)
│   ├── src/db/        # SQLite open and schema migrations
│   ├── src/location/  # Location permission, GPS and compass
│   ├── src/map/       # Map screen, Mapbox map, cards and panels
│   ├── src/store/     # Libraries, visit log, freshness, nearby card, hints
│   └── scripts/       # Marker artwork generator
├── server/            # Cloudflare Worker API (Hono + D1)
└── site/              # Landing page and privacy policy (GitHub Pages)
packages/
└── shared/            # Street Library client, geohash/distance, API types
docs/                  # Release plan and design docs
```

## Docs

- [Release plan](docs/release-plan.md)
- [Maps](docs/maps.md)
- [Server](docs/server.md)
- [Visit log](docs/visit-log.md)
- [UX design](docs/ux.md) (with [mockups](docs/ux/mockup.html))

The website (landing page and privacy policy) is in [`apps/site/`](apps/site/) and deploys to GitHub Pages from `main`. Preview it locally with `python -m http.server 8765 --directory apps/site`.

## Contributing

Contributions are welcome! Here's how to get involved:

1. **Fork** the repo and create a feature branch (`git checkout -b my-feature`)
2. **Make your changes** — try to keep commits focused and well-described
3. **Run the checks** above and **test on a device or emulator**
4. **Open a Pull Request** with a clear description of what you changed and why

### Ideas for Contributions

- UI/UX improvements (better modals, animations, dark mode)
- Search / filter functionality
- Stats screen (total visited, progress by area, etc.)
- iOS testing and polish
- Accessibility improvements

### Code Style

- TypeScript with strict mode enabled
- Functional components with hooks
- Keep modules focused — see the project structure above

## Licence

[MIT](./LICENSE.md)
