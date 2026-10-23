// Small drawn icons for the "Sky" tab. The markup is fixed (written here, never
// built from data), parsed once and copied; gradient ids get a unique suffix
// per copy so a copy in a hidden row never breaks a visible one.

const MARKUP = {
  Saturn: `<svg viewBox="0 0 40 40"><defs>
<radialGradient id="g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#FFF1C9"/><stop offset="0.55" stop-color="#E4C47F"/><stop offset="1" stop-color="#8E6C33"/></radialGradient>
<clipPath id="c"><circle cx="20" cy="20" r="9.5"/></clipPath></defs>
<ellipse cx="20" cy="20" rx="18" ry="5.2" fill="none" stroke="#CDB57E" stroke-width="2.4" stroke-opacity="0.75" transform="rotate(-18 20 20)"/>
<circle cx="20" cy="20" r="9.5" fill="url(#g)"/>
<g clip-path="url(#c)" stroke="#B8925140" stroke-width="1.6"><path d="M9 16.5 L31 13.5"/><path d="M9 21 L31 18"/><path d="M9 25 L31 22"/></g>
<path d="M2 20 A18 5.2 0 0 0 38 20" fill="none" stroke="#F0DDA8" stroke-width="2.4" transform="rotate(-18 20 20)"/></svg>`,
  Jupiter: `<svg viewBox="0 0 40 40"><defs>
<radialGradient id="g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#FFF4E2"/><stop offset="0.55" stop-color="#E7C9A0"/><stop offset="1" stop-color="#8A6440"/></radialGradient>
<clipPath id="c"><circle cx="20" cy="20" r="14"/></clipPath></defs>
<circle cx="20" cy="20" r="14" fill="url(#g)"/>
<g clip-path="url(#c)" fill="none" stroke-linecap="round">
<path d="M5 13 Q20 11.5 35 13" stroke="#B98A5C" stroke-width="2.2" stroke-opacity="0.8"/>
<path d="M5 18 Q20 16.8 35 18" stroke="#C99A6A" stroke-width="1.6" stroke-opacity="0.7"/>
<path d="M5 23.5 Q20 22.5 35 23.5" stroke="#A9764D" stroke-width="2.6" stroke-opacity="0.8"/>
<path d="M5 29 Q20 28 35 29" stroke="#C99A6A" stroke-width="1.6" stroke-opacity="0.6"/></g>
<ellipse cx="25.5" cy="26.5" rx="3" ry="1.8" fill="#C25B3A" fill-opacity="0.9"/></svg>`,
  Mars: `<svg viewBox="0 0 40 40"><defs>
<radialGradient id="g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#FFB28F"/><stop offset="0.55" stop-color="#D9643C"/><stop offset="1" stop-color="#7A2C17"/></radialGradient>
<clipPath id="c"><circle cx="20" cy="20" r="11"/></clipPath></defs>
<circle cx="20" cy="20" r="11" fill="url(#g)"/>
<g clip-path="url(#c)" fill="#8E3A1E" fill-opacity="0.55"><ellipse cx="16" cy="21" rx="4.5" ry="2.2"/><ellipse cx="25" cy="25" rx="3.5" ry="1.6"/><ellipse cx="23" cy="17" rx="2.5" ry="1.2"/></g>
<ellipse cx="19" cy="10.3" rx="4" ry="1.7" fill="#FFF6F0" fill-opacity="0.9"/></svg>`,
  Venus: `<svg viewBox="0 0 40 40"><defs>
<radialGradient id="g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#FFFDF2"/><stop offset="0.6" stop-color="#F1DFAE"/><stop offset="1" stop-color="#A98E55"/></radialGradient></defs>
<circle cx="20" cy="20" r="12" fill="url(#g)"/>
<path d="M10 17 Q20 14 30 18 M11 24 Q21 21 30 25" fill="none" stroke="#E2C88E" stroke-opacity="0.6" stroke-width="2"/></svg>`,
  Mercury: `<svg viewBox="0 0 40 40"><defs>
<radialGradient id="g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#E9ECEF"/><stop offset="0.6" stop-color="#A9AEB5"/><stop offset="1" stop-color="#5D636B"/></radialGradient></defs>
<circle cx="20" cy="20" r="8.5" fill="url(#g)"/>
<circle cx="17" cy="18" r="1.4" fill="#7C828A"/><circle cx="23" cy="23" r="1.8" fill="#7C828A"/><circle cx="22" cy="15.5" r="0.9" fill="#7C828A"/></svg>`,
  Iss: `<svg viewBox="0 0 40 40">
<g fill="#7FA7D9" stroke="#C9D3DC" stroke-width="0.6"><rect x="3" y="12" width="9" height="16" rx="1"/><rect x="28" y="12" width="9" height="16" rx="1"/></g>
<path d="M12 20 H28" stroke="#C9D3DC" stroke-width="2"/>
<rect x="16" y="15.5" width="8" height="9" rx="2" fill="#E8EDF2"/>
<circle cx="20" cy="20" r="1.6" fill="#5AA6FF"/></svg>`,
  Moon: `<svg viewBox="0 0 40 40"><defs>
<radialGradient id="g" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#AEB4C0"/></radialGradient></defs>
<circle cx="20" cy="20" r="13" fill="url(#g)"/>
<circle cx="15" cy="16" r="2.4" fill="#9AA1AE" fill-opacity="0.6"/><circle cx="25" cy="24" r="3" fill="#9AA1AE" fill-opacity="0.5"/><circle cx="24" cy="13" r="1.4" fill="#9AA1AE" fill-opacity="0.5"/></svg>`,
  Meteor: `<svg viewBox="0 0 40 40" fill="none" stroke-linecap="round">
<path d="M8 8 L27 27" stroke="#D8CFFF" stroke-width="2" stroke-opacity="0.7"/><path d="M14 6 L26 18" stroke="#D8CFFF" stroke-width="1.2" stroke-opacity="0.45"/>
<path d="M6 15 L18 27" stroke="#D8CFFF" stroke-width="1.2" stroke-opacity="0.45"/><circle cx="29" cy="29" r="3.2" fill="#FFFFFF" stroke="none"/></svg>`,
  Eclipse: `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="12" fill="#FFB547"/><circle cx="24" cy="18" r="11.5" fill="#0D1130"/>
<circle cx="20" cy="20" r="14.5" fill="none" stroke="#FFB547" stroke-opacity="0.35" stroke-width="1.5"/></svg>`,
  Pair: `<svg viewBox="0 0 40 40"><circle cx="15" cy="21" r="6" fill="#F0CF9A"/><circle cx="27" cy="16" r="4" fill="#FF8A65"/></svg>`,
};

// A planet next to the Moon (the highlight picture)
function moonAnd(planetColour) {
  return `<svg viewBox="0 0 40 40"><defs>
<radialGradient id="g" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#AEB4C0"/></radialGradient></defs>
<circle cx="25" cy="14" r="10" fill="url(#g)"/>
<circle cx="22" cy="11" r="1.6" fill="#9AA1AE" fill-opacity="0.6"/><circle cx="28" cy="17" r="2.2" fill="#9AA1AE" fill-opacity="0.5"/>
<circle cx="11" cy="29" r="4.6" fill="${planetColour}"/></svg>`;
}
const PLANET_COLOUR = { Mercury: '#B8C2CC', Venus: '#F4E6C3', Mars: '#FF8A65', Jupiter: '#F0CF9A', Saturn: '#E9C67E' };

const SVG_NS = 'http://www.w3.org/2000/svg';
const parsed = new Map();
let uid = 0;

function fromMarkup(markup, size) {
  if (!parsed.has(markup)) {
    const clean = markup.replace(/>\s+</g, '><').replace('<svg ', `<svg xmlns="${SVG_NS}" `);
    const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
    parsed.set(markup, doc.documentElement);
  }
  const svg = document.importNode(parsed.get(markup), true);
  const suffix = `-i${++uid}`;
  for (const node of svg.querySelectorAll('[id]')) node.id += suffix;
  for (const node of svg.querySelectorAll('[fill^="url(#"], [clip-path^="url(#"]')) {
    for (const attr of ['fill', 'clip-path']) {
      const v = node.getAttribute(attr);
      if (v && v.startsWith('url(#')) node.setAttribute(attr, v.replace(/\)$/, `${suffix})`));
    }
  }
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('sicon');
  return svg;
}

export function bodyIcon(key, size = 28) {
  return fromMarkup(MARKUP[key] || MARKUP.Moon, size);
}

export function highlightIcon(hl, size = 34) {
  if (!hl) return null;
  if (hl.kind === 'moon-planet') return fromMarkup(moonAnd(PLANET_COLOUR[hl.planet] || '#E9C67E'), size);
  return fromMarkup(MARKUP[{ meteor: 'Meteor', eclipse: 'Eclipse', pair: 'Pair', moon: 'Moon' }[hl.kind] || 'Moon'], size);
}

/** Constellation icon from its points/lines (see CONSTELLATIONS in night.js). */
export function patternIcon(icon, size = 28) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('sicon');
  const add = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.appendChild(n);
  };
  add('rect', { x: 1, y: 1, width: 38, height: 38, rx: 10, fill: '#262E57' });
  for (const [a, b] of icon.l) {
    const [x1, y1] = icon.p[a];
    const [x2, y2] = icon.p[b];
    add('path', { d: `M${x1} ${y1} L${x2} ${y2}`, stroke: '#B9A7FF', 'stroke-opacity': 0.85, 'stroke-width': 1, fill: 'none' });
  }
  icon.p.forEach(([x, y], i) => {
    const big = icon.big && icon.big.includes(i);
    add('circle', { cx: x, cy: y, r: icon.small ? 1.4 : big ? 2.4 : 1.7, fill: '#FFFFFF' });
  });
  return svg;
}

/** Quarter-circle dial: horizon at the bottom, the dot shows how high to look. */
export function heightDial(alt) {
  const a = (Math.max(5, Math.min(85, alt)) * Math.PI) / 180;
  const x = (2 + 11 * Math.cos(a)).toFixed(1);
  const y = (13 - 11 * Math.sin(a)).toFixed(1);
  return fromMarkup(`<svg viewBox="0 0 15 15"><path d="M1.5 13.5 H14" stroke="#C9D3DC" stroke-width="1.4" stroke-linecap="round"/>
<path d="M13 13 A11 11 0 0 0 2 2" fill="none" stroke="#C9D3DC" stroke-opacity="0.6" stroke-width="1.1" stroke-dasharray="1.6 1.6"/>
<path d="M2 13 L${x} ${y}" stroke="#D8CFFF" stroke-opacity="0.5" stroke-width="1"/>
<circle cx="${x}" cy="${y}" r="2.6" fill="#FFFFFF"/></svg>`, 15);
}

/** The deep-space background: stars (a few twinkle), dim galaxies, a faint Milky Way. */
export function spaceBackground(width, height) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('space');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const defs = fromMarkup(`<svg viewBox="0 0 1 1"><defs>
<radialGradient id="sg"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.45"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
<radialGradient id="ga"><stop offset="0" stop-color="#E9DDFF" stop-opacity="0.32"/><stop offset="0.25" stop-color="#B9A7FF" stop-opacity="0.14"/><stop offset="1" stop-color="#B9A7FF" stop-opacity="0"/></radialGradient>
<radialGradient id="gb"><stop offset="0" stop-color="#FFE3C2" stop-opacity="0.26"/><stop offset="0.3" stop-color="#7FA7FF" stop-opacity="0.10"/><stop offset="1" stop-color="#7FA7FF" stop-opacity="0"/></radialGradient>
<radialGradient id="nb"><stop offset="0" stop-color="#6E5BD6" stop-opacity="0.16"/><stop offset="1" stop-color="#6E5BD6" stop-opacity="0"/></radialGradient>
<linearGradient id="bd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B9A7FF" stop-opacity="0"/><stop offset="0.5" stop-color="#C9C2FF" stop-opacity="0.07"/><stop offset="1" stop-color="#B9A7FF" stop-opacity="0"/></linearGradient>
<linearGradient id="dp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#151A3A"/><stop offset="0.55" stop-color="#0D1130"/><stop offset="1" stop-color="#0A0D24"/></linearGradient>
</defs></svg>`, 1).querySelector('defs');
  svg.appendChild(defs);
  const id = (name) => defs.querySelector(`[id^="${name}-"]`).id;
  const add = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.appendChild(n);
    return n;
  };
  const W = width;
  const H = height;
  add('rect', { width: W, height: H, fill: `url(#${id('dp')})` });
  add('rect', { x: -80, y: H * 0.3, width: W + 160, height: 150, fill: `url(#${id('bd')})`, transform: `rotate(-28 ${W / 2} ${H * 0.4})` });
  add('ellipse', { cx: W * 0.23, cy: H * 0.74, rx: 120, ry: 90, fill: `url(#${id('nb')})` });
  for (const [cx, cy, rx, ry, rot, g, core] of [[W * 0.79, H * 0.5, 46, 15, -24, 'ga', '#F3EDFF'], [W * 0.19, H * 0.93, 30, 12, 32, 'gb', '#FFF1DE'], [W * 0.63, H * 0.24, 18, 7, 12, 'ga', null]]) {
    add('ellipse', { cx, cy, rx, ry, fill: `url(#${id(g)})`, transform: `rotate(${rot} ${cx} ${cy})` });
    if (core) add('ellipse', { cx, cy, rx: rx / 6.5, ry: ry / 5.5, fill: core, 'fill-opacity': 0.33, transform: `rotate(${rot} ${cx} ${cy})` });
  }
  const colours = ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#CFE0FF', '#FFE9C7', '#E3D9FF'];
  const count = Math.round((W * H) / 1450);
  for (let i = 0; i < count; i++) {
    const r = [0.45, 0.55, 0.6, 0.7, 0.8, 0.9, 1.1, 1.3][Math.floor(rnd() * 8)];
    const star = add('circle', {
      cx: (rnd() * W).toFixed(1), cy: (rnd() * H).toFixed(1), r,
      fill: colours[Math.floor(rnd() * colours.length)],
      'fill-opacity': (r < 1 ? 0.18 + rnd() * 0.37 : 0.45 + rnd() * 0.35).toFixed(2),
    });
    if (i % 23 === 0) {
      star.classList.add('tw');
      star.style.animationDelay = `-${(rnd() * 4).toFixed(1)}s`;
    }
  }
  for (const [fx, fy] of [[0.87, 0.15], [0.11, 0.57], [0.8, 0.84], [0.4, 0.37]]) {
    add('circle', { cx: W * fx, cy: H * fy, r: 5, fill: `url(#${id('sg')})` });
    add('circle', { cx: W * fx, cy: H * fy, r: 1.3, fill: '#FFFFFF', 'fill-opacity': 0.9 });
  }
  return svg;
}
