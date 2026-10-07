import { bearingDegrees, compassPoint, formatDistance, normalizeDegrees, smoothAngle } from '../bearing';

const HERE = { latitude: -34.9285, longitude: 138.6007 };

describe('bearingDegrees', () => {
  it('points at the cardinal directions', () => {
    expect(bearingDegrees(HERE, { ...HERE, latitude: HERE.latitude + 0.01 })).toBeCloseTo(0, 0);
    expect(bearingDegrees(HERE, { ...HERE, longitude: HERE.longitude + 0.01 })).toBeCloseTo(90, 0);
    expect(bearingDegrees(HERE, { ...HERE, latitude: HERE.latitude - 0.01 })).toBeCloseTo(180, 0);
    expect(bearingDegrees(HERE, { ...HERE, longitude: HERE.longitude - 0.01 })).toBeCloseTo(270, 0);
  });
});

describe('smoothAngle', () => {
  it('starts at the first reading', () => {
    expect(smoothAngle(null, 370)).toBe(10);
  });

  it('takes the short way round north', () => {
    expect(smoothAngle(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(smoothAngle(10, 350, 0.5)).toBeCloseTo(0, 5);
  });

  it('normalises negative angles', () => {
    expect(normalizeDegrees(-90)).toBe(270);
  });
});

describe('formatDistance', () => {
  it('formats metres and kilometres', () => {
    expect(formatDistance(4)).toBe('10 m');
    expect(formatDistance(263)).toBe('260 m');
    expect(formatDistance(1440)).toBe('1.4 km');
    expect(formatDistance(12400)).toBe('12 km');
  });
});

describe('compassPoint', () => {
  it('names the nearest point', () => {
    expect(compassPoint(0)).toBe('north');
    expect(compassPoint(50)).toBe('north-east');
    expect(compassPoint(350)).toBe('north');
    expect(compassPoint(200)).toBe('south');
  });
});
