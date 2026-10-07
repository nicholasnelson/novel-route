import { htmlToText } from '../html';
import { fetchLibrariesForPoint, normalizeLibrary } from '../streetLibrary';

describe('htmlToText', () => {
  it('converts a real WordPress excerpt to plain text', () => {
    const excerpt =
      'Let’s Get Reading!! Free books to Take, Read and Share.<br />\r\nShelves are refreshed weekly. Something for everyone.';
    expect(htmlToText(excerpt)).toBe(
      'Let’s Get Reading!! Free books to Take, Read and Share.\nShelves are refreshed weekly. Something for everyone.'
    );
  });

  it('decodes named and numeric entities and strips tags', () => {
    expect(htmlToText('<p>Tom &amp; Jerry&#8217;s <strong>box</strong>&nbsp;&#x2014; open</p>')).toBe(
      'Tom & Jerry’s box — open'
    );
  });

  it('leaves unknown entities alone', () => {
    expect(htmlToText('a &bogus; b')).toBe('a &bogus; b');
  });
});

describe('normalizeLibrary', () => {
  it('prefixes IDs, parses coordinates and cleans text', () => {
    expect(
      normalizeLibrary({
        id: '45760',
        title: 'Flinders St Baptist Courtyard  Library',
        excerpt: 'Free books<br />\r\nfor all',
        latitude: '-34.9272319',
        longitude: '138.6031511',
        distance: 0.26,
        permalink: 'https://streetlibrary.org.au/library/flinders-st-baptist-courtyard-library/',
      })
    ).toEqual({
      id: 'sl:45760',
      title: 'Flinders St Baptist Courtyard Library',
      latitude: -34.9272319,
      longitude: 138.6031511,
      excerpt: 'Free books\nfor all',
      permalink: 'https://streetlibrary.org.au/library/flinders-st-baptist-courtyard-library/',
    });
  });

  it('rejects items without an ID or valid coordinates', () => {
    expect(normalizeLibrary({ title: 'x', latitude: '1', longitude: '2' })).toBeNull();
    expect(normalizeLibrary({ id: 1, title: 'x', latitude: 'nope', longitude: '2' })).toBeNull();
  });
});

describe('fetchLibrariesForPoint', () => {
  const respond = (body: unknown) => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body }) as unknown as typeof fetch;
  };

  it('treats locations outside Australia and New Zealand as having no libraries', async () => {
    respond({ success: false, data: 'Search location must be within Australia or New Zealand.' });
    await expect(fetchLibrariesForPoint({ lat: 0, lng: 0, nonce: 'n' })).resolves.toEqual({
      libraries: [],
      nonceExpired: false,
    });
  });

  it('surfaces plain-text errors from the server', async () => {
    respond({ success: false, data: 'Something broke' });
    await expect(fetchLibrariesForPoint({ lat: -34.9, lng: 138.6, nonce: 'n' })).rejects.toThrow('Something broke');
  });

  it('detects an expired nonce', async () => {
    respond({ success: false, data: { nonce_expired: true } });
    await expect(fetchLibrariesForPoint({ lat: -34.9, lng: 138.6, nonce: 'n' })).resolves.toEqual({
      libraries: [],
      nonceExpired: true,
    });
  });
});
