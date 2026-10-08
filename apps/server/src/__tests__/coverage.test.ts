import { distanceMeters, encodeGeohash, geohashBounds, geohashCenter, TILE_PRECISION } from '@novel-route/shared';
import { circleAreas, discGrid, tileGrid, uncoveredPoints } from '../coverage';

const ADELAIDE = { latitude: -34.9285, longitude: 138.6007 };
const TILE = encodeGeohash(ADELAIDE.latitude, ADELAIDE.longitude, TILE_PRECISION);
const centre = geohashCenter(TILE);
const KM = 1000;
const circle = (latitude: number, longitude: number, radius: number) => ({ latitude, longitude, radius, fetchedAt: 0 });

describe('tile sample grid', () => {
  it('covers the tile with points under a kilometre apart', () => {
    const grid = tileGrid(TILE);
    // A precision-4 tile at Adelaide's latitude is ~32 x 20 km.
    expect(grid.points.length).toBeGreaterThan(800);
    expect(grid.points.length).toBeLessThan(1500);
    expect(grid.margin).toBeGreaterThan(500);
    expect(grid.margin).toBeLessThan(600);
  });

  it('every point of the tile lies within the margin of a sample point', () => {
    const grid = tileGrid(TILE);
    const b = geohashBounds(TILE);
    for (const [lat, lng] of [[b.south, b.west], [b.north, b.east], [b.south, b.east], [(b.south + b.north) / 2, b.west]]) {
      const nearest = Math.min(...grid.points.map((p) => distanceMeters(lat, lng, p.latitude, p.longitude)));
      expect(nearest).toBeLessThanOrEqual(grid.margin);
    }
  });
});

describe('uncoveredPoints', () => {
  it('a circle reaching past every corner covers the tile', () => {
    expect(uncoveredPoints(tileGrid(TILE), [circle(centre.latitude, centre.longitude, 30 * KM)])).toEqual([]);
  });

  it('a circle that only just reaches the corners does not (circles are shrunk by the margin)', () => {
    const b = geohashBounds(TILE);
    const corner = distanceMeters(centre.latitude, centre.longitude, b.north, b.east);
    const grid = tileGrid(TILE);
    expect(uncoveredPoints(grid, [circle(centre.latitude, centre.longitude, corner)]).length).toBeGreaterThan(0);
    expect(uncoveredPoints(grid, [circle(centre.latitude, centre.longitude, corner + grid.margin * 1.01 + 50)])).toEqual([]);
  });

  it('finds the gap between two circles that each cover half', () => {
    const b = geohashBounds(TILE);
    const west = { latitude: centre.latitude, longitude: (b.west + centre.longitude) / 2 };
    const east = { latitude: centre.latitude, longitude: (centre.longitude + b.east) / 2 };
    const grid = tileGrid(TILE);
    // Each reaches just past the centre line; with the margin they leave a band uncovered.
    const halfWidth = distanceMeters(centre.latitude, west.longitude, centre.latitude, centre.longitude);
    const r = Math.hypot(halfWidth, distanceMeters(b.south, 0, b.north, 0) / 2) + 100;
    const gaps = uncoveredPoints(grid, [circle(west.latitude, west.longitude, r), circle(east.latitude, east.longitude, r)]);
    expect(gaps.length).toBeGreaterThan(0);
    // Generous circles close it.
    const big = r + 2 * grid.margin;
    expect(uncoveredPoints(grid, [circle(west.latitude, west.longitude, big), circle(east.latitude, east.longitude, big)])).toEqual([]);
  });
});

describe('circleAreas', () => {
  it('files even a 99 km circle under a handful of areas', () => {
    const areas = circleAreas({ ...ADELAIDE, radius: 99 * KM });
    expect(areas.length).toBeGreaterThan(1);
    expect(areas.length).toBeLessThanOrEqual(9);
    expect(areas).toContain(TILE.slice(0, 3));
  });
});

describe('discGrid', () => {
  it('only samples inside the disc', () => {
    const grid = discGrid(ADELAIDE, 10 * KM);
    for (const p of grid.points) {
      expect(distanceMeters(p.latitude, p.longitude, ADELAIDE.latitude, ADELAIDE.longitude)).toBeLessThanOrEqual(10 * KM + 1);
    }
    // ~314 km² at 0.64 km² per point.
    expect(grid.points.length).toBeGreaterThan(400);
    expect(grid.points.length).toBeLessThan(560);
  });
});
