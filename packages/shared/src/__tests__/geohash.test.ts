import { encodeGeohash, geohashBounds, geohashCenter, geohashesForBounds, geohashesNearCenter } from '../geohash';

describe('geohash', () => {
  it('encodes a known reference point', () => {
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
  });

  it('decodes bounds that contain the encoded point', () => {
    const lat = -34.9285;
    const lng = 138.6007;
    const b = geohashBounds(encodeGeohash(lat, lng, 5));
    expect(lat).toBeGreaterThanOrEqual(b.south);
    expect(lat).toBeLessThan(b.north);
    expect(lng).toBeGreaterThanOrEqual(b.west);
    expect(lng).toBeLessThan(b.east);
  });

  it('round-trips through the cell centre', () => {
    const hash = encodeGeohash(-34.9285, 138.6007, 5);
    const c = geohashCenter(hash);
    expect(encodeGeohash(c.latitude, c.longitude, 5)).toBe(hash);
  });

  it('covers every corner of a bounding box', () => {
    const bounds = { south: -34.95, west: 138.55, north: -34.88, east: 138.65 };
    const cells = new Set(geohashesForBounds(bounds, 5));
    for (const [lat, lng] of [
      [bounds.south, bounds.west],
      [bounds.south, bounds.east],
      [bounds.north, bounds.west],
      [bounds.north, bounds.east],
      [-34.9285, 138.6007],
    ]) {
      expect(cells.has(encodeGeohash(lat, lng, 5))).toBe(true);
    }
  });

  it('returns no cells when the area is too large', () => {
    const allOfSa = { south: -38, west: 129, north: -26, east: 141 };
    expect(geohashesForBounds(allOfSa, 5, 64)).toEqual([]);
  });

  it('picks the cells nearest the centre when the area is large', () => {
    // Roughly Adelaide at zoom ~10: far more than 20 precision-5 cells.
    const bounds = { south: -35.15, west: 138.35, north: -34.7, east: 138.85 };
    const cells = geohashesNearCenter(bounds, 5, 20);
    expect(cells).toHaveLength(20);
    expect(cells[0]).toBe(encodeGeohash(-34.925, 138.6, 5));
    expect(new Set(cells).size).toBe(20);
  });

  it('returns every cell when the area is small, and the centre cell when it is huge', () => {
    const small = { south: -34.95, west: 138.55, north: -34.9, east: 138.65 };
    expect(geohashesNearCenter(small, 5, 20).sort()).toEqual(geohashesForBounds(small, 5).sort());
    const allOfAustralia = { south: -44, west: 112, north: -10, east: 154 };
    expect(geohashesNearCenter(allOfAustralia, 5, 20)).toEqual([encodeGeohash(-27, 133, 5)]);
  });
});
