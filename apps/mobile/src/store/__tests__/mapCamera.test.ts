import { createTestDb } from '../../test/testDb';
import { cameraToRestore, parseCameraToRestore, RESTORE_CAMERA_WITHIN_MS, saveMapCamera } from '../mapCamera';

const center = { latitude: -35.31, longitude: 149.13 };
const now = 1_800_000_000_000;

describe('map camera', () => {
  it('restores a view left recently while not following', async () => {
    const db = await createTestDb();
    await saveMapCamera(db, { center, zoom: 14.5, following: false, savedAt: now - 5 * 60 * 1000 });
    expect(await cameraToRestore(db, now)).toEqual({ center, zoom: 14.5 });
  });

  it('starts on the user when the view is old, was following, or nothing was saved', async () => {
    const db = await createTestDb();
    expect(await cameraToRestore(db, now)).toBeNull();
    await saveMapCamera(db, { center, zoom: 14, following: false, savedAt: now - RESTORE_CAMERA_WITHIN_MS - 1 });
    expect(await cameraToRestore(db, now)).toBeNull();
    await saveMapCamera(db, { center, zoom: 14, following: true, savedAt: now });
    expect(await cameraToRestore(db, now)).toBeNull();
  });

  it('ignores anything that is not a saved camera', () => {
    expect(parseCameraToRestore('not json', now)).toBeNull();
    expect(parseCameraToRestore('{"zoom":3}', now)).toBeNull();
  });
});
