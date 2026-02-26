# Street Library App

A mobile app for viewing and tracking visits to [Street Libraries](https://streetlibrary.org.au/) across Australia. Explore the map, find nearby libraries, and keep track of the ones you've visited.

> **Early WIP / Testing** — This project is under active development and is not yet available on any app store.

> **Disclaimer** — This project is not associated with, endorsed by, or affiliated with Street Library Australia. It uses publicly available data from [streetlibrary.org.au](https://streetlibrary.org.au/).

## Features

- Map view showing street libraries as coloured markers (green = visited, red = not visited)
- Tap a marker to see details, mark it visited, or get navigation directions
- Automatic nearby detection — get prompted when you're within 100m of a library
- Offline-friendly caching (fetches new data at most once per area per day)
- No API keys required — uses Leaflet + OpenStreetMap tiles

## Tech Stack

- [Expo](https://expo.dev/) (SDK 54) with React Native
- [Leaflet](https://leafletjs.com/) rendered inside a WebView for keyless, free mapping (temporary, looking at replacing with MapLibre + OpenFreeMap)
- [OpenStreetMap](https://www.openstreetmap.org/) tile layer
- AsyncStorage for persistent caching and visit tracking
- TypeScript

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (`npm install -g expo-cli` or use `npx expo`)
- For Android: Android Studio with an emulator, or a physical device
- For iOS: Xcode (macOS only) with a simulator, or a physical device (UNTESTED)
- An [Expo dev client](https://docs.expo.dev/develop/development-builds/introduction/) build (this project does **not** run in Expo Go)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/nicholasnelson/streetlibrary-app.git
cd streetlibrary-app

# Install dependencies
npm install

# Create a development build (first time only)
npx expo run:android   # or: npx expo run:ios

```

## Project Structure

```
src/
├── api/               # Street Library API client + nonce handling
├── cache/             # Per-area caching with 24h refresh policy
├── location/          # Location permissions, GPS watch, Haversine distance
├── map/
│   ├── MapScreen.tsx  # Main map screen component
│   └── mapHtml.ts     # Leaflet HTML template for the WebView
├── store/             # Visited-library persistence
└── types.ts           # Shared TypeScript types
```

## Contributing

Contributions are welcome! Here's how to get involved:

1. **Fork** the repo and create a feature branch (`git checkout -b my-feature`)
2. **Make your changes** — try to keep commits focused and well-described
3. **Test on a device or emulator** — make sure the app builds and runs
4. **Open a Pull Request** with a clear description of what you changed and why

### Ideas for Contributions

- UI/UX improvements (better modals, animations, dark mode)
- Migrating from WebView+Leaflet to a native map library (e.g. MapLibre)
- Search / filter functionality
- Stats screen (total visited, progress by area, etc.)
- iOS testing and polish
- Accessibility improvements
- Tests

### Code Style

- TypeScript with strict mode enabled
- Functional components with hooks
- Keep modules focused — see the project structure above

## Licence

[MIT](./LICENSE.md)
