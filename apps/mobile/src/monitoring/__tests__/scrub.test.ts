import { scrubDeep, scrubLocation } from '../scrub';

describe('scrubLocation', () => {
  it('removes coordinates and API cell lists', () => {
    expect(scrubLocation('GET https://api.novelroute.app/v1/libraries?cells=r1f93,r1f96 failed')).toBe(
      'GET https://api.novelroute.app/v1/libraries?cells=[removed] failed'
    );
    expect(scrubLocation('near -34.92723,138.6031511')).toBe('near [coord],[coord]');
  });

  it('leaves ordinary numbers alone', () => {
    expect(scrubLocation('HTTP 503 after 1.5 s, version 1.0.0')).toBe('HTTP 503 after 1.5 s, version 1.0.0');
  });
});

describe('scrubDeep', () => {
  it('scrubs nested strings and coordinate fields', () => {
    expect(
      scrubDeep({
        message: 'at -34.92723',
        data: { latitude: -34.9, longitude: 138.6, count: 3 },
        list: ['cells=r1f93'],
      })
    ).toEqual({
      message: 'at [coord]',
      data: { latitude: '[coord]', longitude: '[coord]', count: 3 },
      list: ['cells=[removed]'],
    });
  });
});
