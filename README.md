# Novel Route

A mobile app for finding and keeping track of the street libraries (little free book boxes) near you across Australia. Explore the map, log your visits, and see at a glance which boxes you haven't checked in a while.

> **Early WIP / Testing** — This project is under active development and is not yet available on any app store.

> **Disclaimer** — This project is not associated with, endorsed by, or affiliated with Street Library Australia. It uses publicly available data from [streetlibrary.org.au](https://streetlibrary.org.au/).

## Features

- Map of street libraries, coloured by how recently you visited (red = never, greens fading with time since your last visit)
- Tap a library to see details, log a visit, browse or edit your visit history, or get directions
- Nearby detection — when you're within 100m of a library you haven't visited (or haven't visited in 30 days) you're offered to log a visit
- Offline-friendly local cache; library data is refreshed at most once a day per area

## Tech Stack

- [Expo](https://expo.dev/) (SDK 57) with React Native
- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) for the library cache and visit log
- [Mapbox](https://github.com/rnmapbox/maps) maps with native clustering (see [docs/maps.md](docs/maps.md))
- TypeScript, ESLint, Jest

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

# Install dependencies
npm install

# Add your Mapbox public token (https://account.mapbox.com/access-tokens/)
echo "EXPO_PUBLIC_MAPBOX_TOKEN=pk.your-token" > .env.local

# Create a development build (first time only)
npx expo run:android   # or: npx expo run:ios

# Afterwards, start the dev server
npm start
```

Checks:

```bash
npm run typecheck
npm run lint
npm test
```

## Project Structure

```
src/
├── api/               # Street Library API client, HTML clean-up
├── data/              # Cache refresh (one geohash cell at a time)
├── db/                # SQLite open and schema migrations
├── geo/               # Geohash cells, Haversine distance
├── location/          # Location permissions and GPS watch
├── map/
│   ├── MapScreen.tsx  # Main map screen
│   ├── LibrarySheet.tsx # Library details + visit log
│   └── LibraryMap.tsx # Mapbox map: freshness-coloured libraries, clusters, user location
├── store/             # Libraries, visit log, freshness, nearby prompts, key-value settings
├── ui/                # Shared UI (error boundary)
└── types.ts           # Shared TypeScript types
docs/                  # Release plan and design docs
```

## Docs

- [Release plan](docs/release-plan.md)
- [Maps](docs/maps.md)
- [Server](docs/server.md)
- [Visit log](docs/visit-log.md)

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
