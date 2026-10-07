import { htmlToText } from '../html';
import { normalizeLibrary } from '../streetLibraryClient';

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
