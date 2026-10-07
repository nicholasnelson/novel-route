import { isInServiceArea } from '../librarySync';

describe('isInServiceArea', () => {
  it('accepts Australia and New Zealand', () => {
    expect(isInServiceArea(-34.9285, 138.6007)).toBe(true); // Adelaide
    expect(isInServiceArea(-12.46, 130.84)).toBe(true); // Darwin
    expect(isInServiceArea(-42.88, 147.33)).toBe(true); // Hobart
    expect(isInServiceArea(-36.85, 174.76)).toBe(true); // Auckland
  });

  it('rejects elsewhere, including the 0,0 the map starts at before the style loads', () => {
    expect(isInServiceArea(0, 0)).toBe(false);
    expect(isInServiceArea(51.5, -0.12)).toBe(false); // London
  });
});
