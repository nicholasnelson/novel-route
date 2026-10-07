// Generates the library marker icons (docs/ux.md "Map and markers").
// Run with `npm run build:markers` after changing the design; outputs are committed.
//
// A little library on a post. State is shown by colour and door position:
// a visit opens the doors, and they slowly swing shut over the months.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(import.meta.dirname, '..', 'assets', 'markers');

export const STATES = {
  never: { body: '#e9a23b', roof: '#b9721a', door: '#f6c870', doors: 'closed' },
  fresh: { body: '#1f8f3a', roof: '#146b2c', door: '#4cb565', doors: 'open' },
  recent: { body: '#5fae71', roof: '#3e8a50', door: '#9bd1a6', doors: 'half' },
  old: { body: '#a8c1ad', roof: '#7f9c86', door: '#cfdfd2', doors: 'ajar' },
};

// Door panels as polygons, hinged at the outer edges of the 24-wide opening (x 12..36).
const DOORS = {
  closed: [[12, 21, 24, 21, 24, 35, 12, 35], [24, 21, 36, 21, 36, 35, 24, 35]],
  ajar: [[12, 21, 22.5, 21.6, 22.5, 34.4, 12, 35], [36, 21, 25.5, 21.6, 25.5, 34.4, 36, 35]],
  half: [[12, 21, 17.5, 22.3, 17.5, 33.7, 12, 35], [36, 21, 30.5, 22.3, 30.5, 33.7, 36, 35]],
  open: [[12, 21, 5, 22.6, 5, 33.4, 12, 35], [36, 21, 43, 22.6, 43, 33.4, 36, 35]],
};

const BOOKS = ['#c94f3d', '#3b6ea8', '#e3c25a', '#5a8f5a', '#8a5aa0', '#d9822b', '#4f7f8f'];

function markerSvg(state) {
  const s = STATES[state];
  const doors = DOORS[s.doors];
  const polygon = (d, attrs) => `<polygon points="${d.join(' ')}" ${attrs}/>`;
  const books = BOOKS.map(
    (c, i) => `<rect x="${13 + i * 3.25}" y="${23 + (i % 3)}" width="2.6" height="${11 - (i % 3)}" rx="0.4" fill="${c}"/>`
  ).join('');
  const knobs =
    s.doors === 'closed'
      ? `<circle cx="22.4" cy="28" r="0.9" fill="${s.roof}"/><circle cx="25.6" cy="28" r="0.9" fill="${s.roof}"/>`
      : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 64" width="48" height="64">
  <ellipse cx="24" cy="61" rx="7" ry="2" fill="#000" fill-opacity="0.2"/>
  <g fill="#fff" stroke="#fff" stroke-width="3.2" stroke-linejoin="round">
    <rect x="22" y="36" width="4" height="24"/>
    <path d="M4 20 L24 5 L44 20 Z"/>
    <rect x="8" y="18" width="32" height="20" rx="2"/>
    ${doors.map((d) => polygon(d, '')).join('')}
  </g>
  <rect x="22" y="36" width="4" height="24" rx="1" fill="#5b5f5c"/>
  <path d="M4 20 L24 5 L44 20 Z" fill="${s.roof}" stroke="${s.roof}" stroke-width="1.5" stroke-linejoin="round"/>
  <rect x="8" y="18" width="32" height="20" rx="2" fill="${s.body}"/>
  <rect x="12" y="21" width="24" height="14" fill="#3a2e24"/>
  ${books}
  ${doors.map((d) => polygon(d, `fill="${s.door}" stroke="${s.roof}" stroke-width="0.8" stroke-linejoin="round"`)).join('')}
  ${knobs}
</svg>
`;
}

// Map markers are 30x40 dp; the large variant (detail panel, cards) is 60x80 dp.
const SIZES = [
  { name: 'marker', width: 30 },
  { name: 'marker-large', width: 60 },
];
const SCALES = [1, 2, 3];

mkdirSync(OUT_DIR, { recursive: true });
for (const state of Object.keys(STATES)) {
  const svg = markerSvg(state);
  writeFileSync(join(OUT_DIR, `${state}.svg`), svg);
  for (const size of SIZES) {
    for (const scale of SCALES) {
      const png = new Resvg(svg, { fitTo: { mode: 'width', value: size.width * scale } }).render().asPng();
      const suffix = scale === 1 ? '' : `@${scale}x`;
      writeFileSync(join(OUT_DIR, `${size.name}-${state}${suffix}.png`), png);
    }
  }
}
console.log(`Wrote markers to ${OUT_DIR}`);
