import { fmtTime } from './utils.js';

function moonSvg(phase, cx, cy, rx, ry) {
  const lit  = 'rgba(230,218,165,0.95)';
  const dark = 'rgba(14,18,52,0.97)';
  const rim  = 'rgba(110,140,210,0.60)';
  const id   = `mc${cx}${cy}`;
  const clip = `<defs><clipPath id="${id}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath></defs>`;
  const base = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${dark}"/>`;
  const edge = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${rim}" stroke-width="1.5"/>`;
  const c = (p) => `clip-path="url(#${id})" fill="${lit}" d="${p}"`;
  const irx = (rx * 0.72).toFixed(1);
  if (phase === 'new_moon')  return clip + base + edge;
  if (phase === 'full_moon') return clip + `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${lit}" stroke="${rim}" stroke-width="0.8"/>`;
  if (phase === 'first_quarter')
    return clip + base + `<path ${c(`M ${cx},${cy-ry} A ${rx},${ry} 0 0,1 ${cx},${cy+ry} L ${cx},${cy-ry} Z`)}/>` + edge;
  if (phase === 'last_quarter')
    return clip + base + `<path ${c(`M ${cx},${cy-ry} A ${rx},${ry} 0 0,0 ${cx},${cy+ry} L ${cx},${cy-ry} Z`)}/>` + edge;
  if (phase === 'waxing_crescent')
    return clip + base + `<path ${c(`M ${cx},${cy-ry} A ${rx},${ry} 0 0,1 ${cx},${cy+ry} A ${irx},${ry} 0 0,0 ${cx},${cy-ry} Z`)}/>` + edge;
  if (phase === 'waxing_gibbous')
    return clip + base + `<path ${c(`M ${cx},${cy-ry} A ${rx},${ry} 0 0,1 ${cx},${cy+ry} A ${irx},${ry} 0 0,1 ${cx},${cy-ry} Z`)}/>` + edge;
  if (phase === 'waning_gibbous')
    return clip + base + `<path ${c(`M ${cx},${cy-ry} A ${rx},${ry} 0 0,0 ${cx},${cy+ry} A ${irx},${ry} 0 0,0 ${cx},${cy-ry} Z`)}/>` + edge;
  if (phase === 'waning_crescent')
    return clip + base + `<path ${c(`M ${cx},${cy-ry} A ${rx},${ry} 0 0,0 ${cx},${cy+ry} A ${irx},${ry} 0 0,1 ${cx},${cy-ry} Z`)}/>` + edge;
  return clip + base + edge;
}

export function renderSunArc(sun, currentMs) {
  const svg = document.getElementById('sun-arc');
  if (!sun || !sun.dawn || !sun.dusk) return;

  const W = 800, H = 220;
  const ML = 65, MR = 65;
  const AW = W - ML - MR;
  const HORIZON = 150;
  const PEAK = 28;

  const dawn_ts = sun.dawn;
  const dusk_ts = sun.dusk;
  const dayRange = dusk_ts - dawn_ts;
  if (dayRange <= 0) return;

  const ext = dayRange * 0.16;
  const viewStart = dawn_ts - ext;
  const viewEnd = dusk_ts + ext;
  const totalRange = viewEnd - viewStart;

  function tx(ts) {
    return ML + Math.max(0, Math.min(AW, ((ts - viewStart) / totalRange) * AW));
  }
  function ty(ts) {
    const t = (ts - dawn_ts) / dayRange;
    return HORIZON - (HORIZON - PEAK) * Math.sin(Math.PI * t);
  }
  function tyB(ts) { return Math.min(H - 3, Math.max(3, ty(ts))); }

  function pts(fromTs, toTs, steps) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const ts = fromTs + (i / steps) * (toTs - fromTs);
      out.push(`${tx(ts).toFixed(1)},${tyB(ts).toFixed(1)}`);
    }
    return out;
  }
  function pathFill(fromTs, toTs, steps) {
    const p = pts(fromTs, toTs, steps);
    return `M ${tx(fromTs).toFixed(1)} ${HORIZON} L ${p.join(' L ')} L ${tx(toTs).toFixed(1)} ${HORIZON} Z`;
  }

  const preDawnPts = pts(viewStart, dawn_ts, 25);
  const preDawnFill =
    `M ${tx(viewStart).toFixed(1)} ${HORIZON} L ${preDawnPts.join(' L ')} ` +
    `L ${tx(dawn_ts).toFixed(1)} ${HORIZON} Z`;

  const aboveArc   = pts(dawn_ts, dusk_ts, 80);
  const underLeft  = pts(viewStart, dawn_ts, 20);
  const underRight = pts(dusk_ts, viewEnd, 20);

  const sr = sun.sunrise, ss = sun.sunset;
  const nowTs = currentMs ? currentMs / 1000 : Date.now() / 1000;
  let productionFill = '';
  if (sr && ss && nowTs >= sr) {
    const fillEnd = Math.min(ss, nowTs);
    if (fillEnd > sr) productionFill = pathFill(sr, fillEnd, 60);
  }

  const twi1 = (sr && sr > dawn_ts) ? pathFill(dawn_ts, sr, 20) : '';
  const twi2 = (ss && dusk_ts > ss) ? pathFill(ss, dusk_ts, 20) : '';

  const isDay = sr && ss && nowTs >= sr && nowTs <= ss;
  const aboveGround = nowTs >= dawn_ts && nowTs <= dusk_ts;
  const sunIcon = aboveGround ? `
    <circle cx="${tx(nowTs).toFixed(1)}" cy="${tyB(nowTs).toFixed(1)}" r="13"
            fill="${isDay ? '#f5a623' : '#2a2a4a'}"
            stroke="${isDay ? '#c8820a' : '#5555a0'}" stroke-width="1.5"/>` : '';

  let moonIcon = '';
  if (sun.moon_phase) {
    const mTs = viewStart + (dawn_ts - viewStart) * 0.5;
    const mx = tx(mTs).toFixed(1);
    const my = 52;
    const moonRy = 16;
    // Compute rx to compensate for SVG x-stretch so the moon appears circular.
    // getBoundingClientRect gives the actual rendered pixel width; clientWidth returns
    // the SVG viewBox width (800) which is wrong here.
    const svgRenderedW = svg.getBoundingClientRect().width || W;
    const moonRx = parseFloat((moonRy * (200 / H) * (W / svgRenderedW)).toFixed(2));
    moonIcon = moonSvg(sun.moon_phase, parseFloat(mx), my, moonRx, moonRy);
  }

  function aboveLabel(ts, label) {
    if (!ts) return '';
    const x = tx(ts), arcY = ty(ts);
    const timeY  = Math.max(22, arcY - 38);
    const labelY = Math.max(8,  timeY  - 15);
    return `
      <line x1="${x.toFixed(1)}" y1="${(arcY + 1).toFixed(1)}" x2="${x.toFixed(1)}" y2="${HORIZON}"
            stroke="var(--arc-marker)" stroke-width="0.8" stroke-dasharray="3,4"/>
      <text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}"
            text-anchor="middle" font-size="10" fill="var(--arc-label)">${label}</text>
      <text x="${x.toFixed(1)}" y="${timeY.toFixed(1)}"
            text-anchor="middle" font-size="13" fill="var(--arc-time)" font-weight="600">${fmtTime(ts)}</text>`;
  }

  const belowMarkers = [
    {ts: dawn_ts,        label: 'Dawn',       anchor: 'start',  xOff:  3},
    {ts: sun.solar_noon, label: 'Solar noon', anchor: 'middle', xOff:  0},
    {ts: dusk_ts,        label: 'Dusk',       anchor: 'end',    xOff: -3},
  ].filter(m => m.ts);

  const belowSvg = belowMarkers.map(m => {
    const x = tx(m.ts);
    return `
      <line x1="${x.toFixed(1)}" y1="${HORIZON}" x2="${x.toFixed(1)}" y2="${(HORIZON + 7).toFixed(1)}"
            stroke="var(--arc-marker)" stroke-width="0.5"/>
      <text x="${(x + m.xOff).toFixed(1)}" y="${(HORIZON + 14).toFixed(1)}"
            text-anchor="${m.anchor}" font-size="10" fill="var(--arc-label)">${m.label}</text>
      <text x="${(x + m.xOff).toFixed(1)}" y="${(HORIZON + 27).toFixed(1)}"
            text-anchor="${m.anchor}" font-size="12" fill="var(--arc-time)" font-weight="500">${fmtTime(m.ts)}</text>`;
  }).join('');

  svg.innerHTML = `
    <rect width="${W}" height="${H}" fill="var(--arc-bg)"/>
    <path d="${preDawnFill}" fill="var(--arc-night)"/>
    ${twi1 ? `<path d="${twi1}" fill="var(--arc-twilight)"/>` : ''}
    ${twi2 ? `<path d="${twi2}" fill="var(--arc-twilight)"/>` : ''}
    ${productionFill ? `<path d="${productionFill}" fill="var(--arc-fill)"/>` : ''}
    <polyline points="${underLeft.join(' ')}"
              fill="none" stroke="var(--arc-line)" stroke-width="1" opacity="0.4"/>
    <polyline points="${aboveArc.join(' ')}"
              fill="none" stroke="var(--arc-line)" stroke-width="2"/>
    <polyline points="${underRight.join(' ')}"
              fill="none" stroke="var(--arc-line)" stroke-width="1" opacity="0.4"/>
    <line x1="${ML}" y1="${HORIZON}" x2="${W-MR}" y2="${HORIZON}"
          stroke="var(--arc-marker)" stroke-width="0.5"/>
    ${aboveLabel(sr, 'Sunrise')}
    ${aboveLabel(ss, 'Sunset')}
    ${belowSvg}
    ${moonIcon}
    ${sunIcon}
  `;
}
