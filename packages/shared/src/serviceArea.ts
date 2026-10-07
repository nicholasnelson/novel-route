/** Rough bounding box of Australia and New Zealand, the only area the Street Library API serves. */
const SERVICE_AREA = { south: -48, north: -9, west: 112, east: 179 };

export function isInServiceArea(latitude: number, longitude: number): boolean {
  return (
    latitude >= SERVICE_AREA.south &&
    latitude <= SERVICE_AREA.north &&
    longitude >= SERVICE_AREA.west &&
    longitude <= SERVICE_AREA.east
  );
}
