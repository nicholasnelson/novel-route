import * as Location from 'expo-location';

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

const POSITION_TIMEOUT_MS = 10000;
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * A quick starting position: a recent last-known fix if there is one, otherwise a fresh fix,
 * giving up after POSITION_TIMEOUT_MS (a fresh fix can take minutes indoors).
 * Returns null if neither is available; watchPosition will deliver a fix later.
 */
export async function getCurrentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    const location =
      lastKnown ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), POSITION_TIMEOUT_MS)),
      ]));
    if (!location) return null;
    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
  } catch {
    return null;
  }
}

export async function watchPosition(
  callback: (coords: { latitude: number; longitude: number }) => void
): Promise<Location.LocationSubscription> {
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, distanceInterval: 5 },
    (location) => {
      callback({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
    }
  );
}
