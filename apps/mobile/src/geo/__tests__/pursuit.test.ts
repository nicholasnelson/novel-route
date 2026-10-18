import { distanceMeters } from '@novel-route/shared';
import { bearingDegrees } from '../bearing';
import { ARRIVE_M, MIN_LOOKAHEAD_M, Path, pathLength, pointAlong, progressOnPath, pursuitTarget, splitAtStops } from '../pursuit';

// An L-shaped path in Adelaide: 500 m east, then 500 m south (about 0.0045° per 500 m).
const LAT = -34.93;
const LNG = 138.6;
const E = 500 / (111320 * Math.cos((LAT * Math.PI) / 180));
const S = 500 / 110540;
const path: Path = [[LNG, LAT], [LNG + E, LAT], [LNG + E, LAT - S]];
const dist = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) =>
  distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);

describe('path geometry', () => {
  it('measures and walks along the path', () => {
    expect(pathLength(path)).toBeCloseTo(1000, -1);
    const corner = pointAlong(path, 500);
    expect(dist(corner, { latitude: LAT, longitude: LNG + E })).toBeLessThan(2);
    expect(pointAlong(path, 5000)).toEqual({ latitude: LAT - S, longitude: LNG + E });
  });

  it('finds your place on the path and how far off it you are', () => {
    const you = { latitude: LAT + 30 / 110540, longitude: LNG + E / 2 }; // 30 m north of the first street
    const p = progressOnPath(path, you);
    expect(p.along).toBeCloseTo(250, -1);
    expect(p.offPath).toBeCloseTo(30, 0);
    expect(p.remaining).toBeCloseTo(750, -1);
  });
});

describe('pursuitTarget', () => {
  it('leads along the path when you are on it', () => {
    const you = { latitude: LAT, longitude: LNG + E / 2 };
    const t = pursuitTarget(path, you);
    expect(bearingDegrees(you, t.target)).toBeCloseTo(90, -1); // east, along the street
    expect(dist(you, t.target)).toBeCloseTo(MIN_LOOKAHEAD_M, -1);
  });

  it('turns you back towards the path when you have strayed, and more so the further off', () => {
    const near = { latitude: LAT + 20 / 110540, longitude: LNG + E / 2 };
    const far = { latitude: LAT + 150 / 110540, longitude: LNG + E / 2 };
    const nearBearing = bearingDegrees(near, pursuitTarget(path, near).target);
    const farBearing = bearingDegrees(far, pursuitTarget(path, far).target);
    // Both head east-ish and south (back to the street); further off points more directly at it.
    expect(nearBearing).toBeGreaterThan(90);
    expect(farBearing).toBeGreaterThan(nearBearing);
    expect(farBearing).toBeLessThan(180);
  });

  it('follows the path round a corner', () => {
    const you = { latitude: LAT, longitude: LNG + E - 10 / (111320 * Math.cos((LAT * Math.PI) / 180)) };
    const t = pursuitTarget(path, you);
    expect(t.target.latitude).toBeLessThan(LAT); // the target is already round the corner, heading south
  });

  it('points at the library itself when close', () => {
    const end = { latitude: LAT - S, longitude: LNG + E };
    const you = { latitude: LAT - S + (ARRIVE_M - 5) / 110540, longitude: LNG + E };
    expect(pursuitTarget(path, you).target).toEqual(end);
  });

  it('looks further ahead when GPS is vague', () => {
    const you = { latitude: LAT, longitude: LNG + E / 4 };
    expect(dist(you, pursuitTarget(path, you, { accuracyM: 40 }).target)).toBeCloseTo(60, -1);
  });

  it('keeps your place when the path passes near itself, unless you are far off', () => {
    // Out 300 m east and back along a parallel street 20 m north.
    const N = 20 / 110540;
    const back: Path = [[LNG, LAT], [LNG + 0.6 * E, LAT], [LNG + 0.6 * E, LAT + N], [LNG, LAT + N]];
    const you = { latitude: LAT + N / 2 - 2 / 110540, longitude: LNG + 0.3 * E }; // nearer the outward street
    expect(progressOnPath(back, you, 140).along).toBeLessThan(300); // still on the way out
    expect(progressOnPath(back, you, 470).along).toBeGreaterThan(300); // already on the way back
  });
});

describe('splitAtStops', () => {
  it('cuts the whole route into legs ending at each stop', () => {
    const stop = { latitude: LAT, longitude: LNG + E };
    const legs = splitAtStops(path, [stop]);
    expect(legs).toHaveLength(2);
    expect(legs[0][legs[0].length - 1]).toEqual(path[1]);
    expect(legs[1][0]).toEqual(path[1]);
    expect(legs[1][legs[1].length - 1]).toEqual(path[2]);
  });
});
