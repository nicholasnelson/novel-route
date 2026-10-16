import { scrubDeep, scrubLocation } from '../scrub';

describe('scrubLocation', () => {
  it('removes coordinates and API cell lists', () => {
    expect(scrubLocation('GET https://api.novelroute.app/v1/libraries?cells=r1f93,r1f96 failed')).toBe(
      'GET https://api.novelroute.app/v1/libraries?cells=[removed] failed'
    );
    expect(scrubLocation('GET https://api.novelroute.app/v1/tiles/r1f9 failed: HTTP 503')).toBe(
      'GET https://api.novelroute.app/v1/tiles/[removed] failed: HTTP 503'
    );
    expect(scrubLocation('near -34.92723,138.6031511')).toBe('near [coord],[coord]');
  });

  it('removes library IDs, which are exact locations', () => {
    expect(scrubLocation('GET /v1/libraries/sl:45760 failed')).toBe('GET /v1/libraries/[removed] failed');
    expect(scrubLocation('GET /v1/libraries/sl%3A45760?x=1')).toBe('GET /v1/libraries/[removed]?x=1');
    expect(scrubLocation('Opened sl:45760 and c:9f1c2b4e-1a2b')).toBe('Opened sl:[removed] and c:[removed]');
    expect(scrubLocation('at file:///c:/app/index.js')).toBe('at file:///c:/app/index.js');
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

  it('scrubs strings at any depth and drops objects nested too deep to walk', () => {
    let deep: unknown = { lat: 1, note: 'sl:1' };
    for (let i = 0; i < 12; i++) deep = { next: deep, text: `level ${i} at -34.92723` };
    const json = JSON.stringify(scrubDeep(deep));
    expect(json).not.toMatch(/-34\.92723|sl:1/);
    expect(json).toContain('[truncated]');
  });
});
