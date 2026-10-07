import * as Location from 'expo-location';
import { smoothAngle } from '../geo/bearing';

export type PositionFix = {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy radius in metres, if known. */
  accuracy: number | null;
  /** Direction of travel in degrees (GPS course), if moving and known. */
  course: number | null;
  /** Speed in m/s, if known. */
  speed: number | null;
};

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function getLocationPermission(): Promise<{ status: PermissionState; canAskAgain: boolean }> {
  const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
  return { status: status as PermissionState, canAskAgain };
}

export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

function toFix(location: Location.LocationObject): PositionFix {
  const { latitude, longitude, accuracy, heading, speed } = location.coords;
  return {
    latitude,
    longitude,
    accuracy: accuracy ?? null,
    course: heading != null && heading >= 0 ? heading : null,
    speed: speed != null && speed >= 0 ? speed : null,
  };
}

const POSITION_TIMEOUT_MS = 10000;
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * A quick starting position: a recent last-known fix if there is one, otherwise a fresh fix,
 * giving up after POSITION_TIMEOUT_MS (a fresh fix can take minutes indoors).
 * Returns null if neither is available; watchPosition will deliver a fix later.
 */
export async function getCurrentPosition(): Promise<PositionFix | null> {
  try {
    const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    const location =
      lastKnown ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), POSITION_TIMEOUT_MS)),
      ]));
    return location ? toFix(location) : null;
  } catch {
    return null;
  }
}

export async function watchPosition(
  callback: (fix: PositionFix) => void
): Promise<Location.LocationSubscription> {
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 3 },
    (location) => callback(toFix(location))
  );
}

export type Heading = {
  /** Degrees clockwise from true north (falls back to magnetic north). */
  degrees: number;
  /** False when the compass reports low or no calibration. */
  reliable: boolean;
};

/**
 * Smoothed compass heading. expo-location reports calibration 0–3 on both platforms;
 * below 2 (more than ~35° uncertainty on iOS) the heading is treated as unreliable.
 */
export async function watchHeading(callback: (heading: Heading) => void): Promise<Location.LocationSubscription> {
  let smoothed: number | null = null;
  return Location.watchHeadingAsync((reading) => {
    const raw = reading.trueHeading >= 0 ? reading.trueHeading : reading.magHeading;
    smoothed = smoothAngle(smoothed, raw);
    callback({ degrees: smoothed, reliable: reading.accuracy >= 2 });
  });
}
