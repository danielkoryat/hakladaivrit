'use strict';

// ---------- Keyboard maps ----------
const BASE = {}, FINGER = {}, REVERSE = {}, ROW_OF = {};
KEY_ROWS.forEach((row, ri) => row.forEach(([code, he, , finger]) => {
  FINGER[code] = finger;
  if (finger === 'mod') return;
  const ch = code === 'Space' ? ' ' : LANG === 'en' ? EN_KEYS[code][0] : he;
  BASE[code] = ch;
  REVERSE[ch] = { code, shift: false };
  ROW_OF[ch] = ri;
}));
Object.entries(SHIFT_CHARS).forEach(([code, ch]) => { if (!REVERSE[ch]) REVERSE[ch] = { code, shift: true }; });

// Every character either layout can produce, by physical key. Pasted text can mix Hebrew
// and English, and a key press counts when it is the right key in either layout.
const KEY_OF = { ...REVERSE };
const addKey = (ch, code, shift) => { if (ch && !KEY_OF[ch]) KEY_OF[ch] = { code, shift }; };
KEY_ROWS.flat().forEach(([code, he, , f]) => { if (f !== 'mod' && code !== 'Space') addKey(he, code, false); });
Object.entries(HE_SHIFT).forEach(([code, ch]) => addKey(ch, code, true));
Object.entries(EN_KEYS).forEach(([code, [lo, up]]) => { addKey(lo, code, false); addKey(up, code, true); });
const isKeyFor = (e, ch) => { const k = KEY_OF[ch]; return !!k && k.code === e.code && k.shift === e.shiftKey; };

const ROW_NAMES = [tr('שורת המספרים', 'Number row'), tr('השורה העליונה', 'Top row'), tr('שורת הבית', 'Home row'), tr('השורה התחתונה', 'Bottom row')];
const HOME_KEY = { lp: 'KeyA', lr: 'KeyS', lm: 'KeyD', li: 'KeyF', ri: 'KeyJ', rm: 'KeyK', rr: 'KeyL', rp: 'Semicolon' };
const LETTER_FINGERS = Object.keys(HOME_KEY);
// Characters each finger is responsible for.
const FINGER_CHARS = {};
Object.entries(BASE).forEach(([code, ch]) => {
  const f = FINGER[code];
  if (f === 'th') return;
  (FINGER_CHARS[f] = FINGER_CHARS[f] || []).push(ch);
});
const fingerOfChar = ch => { const r = REVERSE[ch]; return r ? FINGER[r.code] : null; };

// Resolve the character for a key press by physical position, so the site works
// even when the OS keyboard layout is set to English.
function resolveChar(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (LANG === 'en' ? /^[A-Za-z]$/.test(e.key) : isHebrew(e.key)) return e.key;
  const mapped = e.shiftKey ? SHIFT_CHARS[e.code] : BASE[e.code];
  if (mapped) return mapped;
  return e.key && e.key.length === 1 ? e.key : null;
}

// ---------- Hands overlay ----------
// Hands seen from above, drawn from a simple anatomical skeleton: every finger runs from its
// knuckle to the fingertip with joint widths, a nail and knuckle creases; the back of the hand
// joins the knuckles to the wrist and the thumb. All shapes are painted as one silhouette
// (outline layer under a fill layer), so only the hand's outer edge shows, like a drawing.
const HAND_IDS = ['lp', 'lr', 'lm', 'li', 'lt', 'rt', 'ri', 'rm', 'rr', 'rp'];
let handsUid = 0;

const f1 = v => v.toFixed(1);

// Smooth closed path through points (Catmull-Rom → cubic Bézier).
function smoothClosed(pts) {
  const n = pts.length;
  const at = i => pts[((i % n) + n) % n];
  let d = `M${f1(at(0).x)},${f1(at(0).y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += `C${f1(p1.x + (p2.x - p0.x) / 6)},${f1(p1.y + (p2.y - p0.y) / 6)} ` +
      `${f1(p2.x - (p3.x - p1.x) / 6)},${f1(p2.y - (p3.y - p1.y) / 6)} ${f1(p2.x)},${f1(p2.y)}`;
  }
  return d + 'Z';
}

// Width profile along a finger, from the knuckle (t=0) to the tip centre (t=1).
const FINGER_PROFILE = [[-0.45, 1.06], [0, 1.0], [0.22, 0.97], [0.44, 1.02], [0.6, 0.95], [0.76, 0.93], [0.9, 0.9]];
const THUMB_PROFILE = [[-0.5, 1.35], [0, 1.18], [0.3, 1.02], [0.52, 1.0], [0.7, 0.96], [0.86, 0.92]];

// Outline, nail and creases for a finger whose knuckle is at B and fingertip pad at T.
function fingerShape(B, T, w, bend, thumb) {
  const dx = T.x - B.x, dy = T.y - B.y;
  const L = Math.hypot(dx, dy) || 1;
  const d = { x: dx / L, y: dy / L };           // along the finger, knuckle → tip
  const n = { x: -d.y, y: d.x };                // sideways
  const P = (t, side) => ({ x: B.x + d.x * t * L + n.x * side, y: B.y + d.y * t * L + n.y * side });
  const profile = thumb ? THUMB_PROFILE : FINGER_PROFILE;
  const curve = t => bend * Math.sin(Math.PI * Math.max(0, Math.min(1, t)));
  const rTip = (w * profile[profile.length - 1][1]) / 2;
  const left = profile.map(([t, k]) => P(t, -(w * k) / 2 + curve(t)));
  const right = profile.map(([t, k]) => P(t, (w * k) / 2 + curve(t))).reverse();
  const tip = [];
  for (let a = 20; a <= 160; a += 35) {
    const r = (a * Math.PI) / 180;
    tip.push({ x: T.x - n.x * rTip * Math.cos(r) + d.x * rTip * Math.sin(r), y: T.y - n.y * rTip * Math.cos(r) + d.y * rTip * Math.sin(r) });
  }
  const outline = smoothClosed([...left, ...tip, ...right]);
  // Sides and tip only, starting just above the knuckle: used to highlight a finger so it
  // still grows out of the hand instead of showing its own base.
  const k0 = profile.findIndex(([t]) => t >= 0.08);
  const openPts = [...left.slice(k0), ...tip, ...right.slice(0, right.length - k0)];
  const openFill = smoothClosed(openPts);
  const openLine = openFill.replace(/Z$/, '').split('C').slice(0, -1).join('C');

  // Nail: a rounded shield at the far end of the fingertip.
  const nc = { x: T.x + d.x * rTip * 0.28, y: T.y + d.y * rTip * 0.28 };
  const nail = { cx: nc.x, cy: nc.y, rx: rTip * 0.56, ry: rTip * 0.72, angle: (Math.atan2(d.y, d.x) * 180) / Math.PI + 90 };

  // Knuckle creases: short arcs across the finger at the joints.
  const creases = (thumb ? [0.52] : [0.44, 0.76]).map(t => {
    const half = (w * 0.3);
    const a = P(t, -half + curve(t)), b = P(t, half + curve(t)), m = P(t + 0.04, curve(t));
    return `M${f1(a.x)},${f1(a.y)}Q${f1(m.x)},${f1(m.y)} ${f1(b.x)},${f1(b.y)}`;
  });
  return { outline, openFill, openLine, nail, creases };
}

function Hands(stage, kb, keys) {
  const layer = $('.hands', stage);
  const uid = ++handsUid;
  const pid = id => `hp${uid}-${id}`;
  const SHAPES = ['palm-l', 'palm-r', ...HAND_IDS];
  layer.innerHTML = `
    <svg class="hands-svg" aria-hidden="true">
      <defs>
        <linearGradient id="hf${uid}" gradientUnits="userSpaceOnUse" x1="0" x2="0">
          <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <mask id="hm${uid}" maskUnits="userSpaceOnUse"><rect class="mask-rect" x="-50" y="-50" fill="url(#hf${uid})"/></mask>
        ${SHAPES.map(s => `<path id="${pid(s)}"/>`).join('')}
      </defs>
      <g class="hands-art" mask="url(#hm${uid})">
        <g class="h-stroke">${SHAPES.map(s => `<use href="#${pid(s)}"/>`).join('')}</g>
        <g class="h-fill">${SHAPES.map(s => `<use href="#${pid(s)}"/>`).join('')}</g>
        <g class="h-details"></g>
        <g class="h-top"></g>
      </g>
    </svg>`;
  const svg = $('.hands-svg', layer);
  const shapeEl = s => $(`#${pid(s)}`, svg);
  const fingers = {};
  HAND_IDS.forEach(id => { fingers[id] = { cur: null, from: null, to: null, t0: 0 }; });
  let geo = null, targets = {}, heatRates = null, raf = 0, flashes = {};

  const rect = code => {
    const k = keys[code];
    return { x: k.offsetLeft + k.offsetWidth / 2, y: k.offsetTop + k.offsetHeight / 2, l: k.offsetLeft, r: k.offsetLeft + k.offsetWidth, t: k.offsetTop, h: k.offsetHeight };
  };

  function layout() {
    if (!stage.isConnected || !keys.KeyA.offsetWidth) return;
    const A = rect('KeyA'), S = rect('KeyS'), D = rect('KeyD'), F = rect('KeyF'), J = rect('KeyJ'), K = rect('KeyK'), SC = rect('Semicolon'), Q = rect('KeyQ'), SP = rect('Space');
    const u = S.x - A.x;            // key pitch
    const v = A.y - Q.y;            // row pitch
    const h = A.h;
    const kbB = kb.offsetTop + kb.offsetHeight;
    stage.style.paddingBottom = Math.round(v * 2.3) + 'px';
    const W = stage.clientWidth, H = stage.clientHeight;
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    const grad = $(`#hf${uid}`, svg);
    grad.setAttribute('y1', kbB + v * 0.15);
    grad.setAttribute('y2', H - v * 0.1);
    const mr = $('.mask-rect', svg);
    mr.setAttribute('width', W + 100);
    mr.setAttribute('height', H + 100);

    const g = { u, v, h, H, bases: {}, widths: {}, bends: {}, homes: {} };
    // Fingertip pads rest just below each home-row letter so it stays readable.
    const pad = k => ({ x: k.x, y: k.y + h * 0.1 + u * 0.3 });
    [['l', [A, S, D, F], 1, (S.x + D.x) / 2], ['r', [J, K, rect('KeyL'), SC], -1, (K.x + rect('KeyL').x) / 2]].forEach(([hand, homeKeys, s, cx]) => {
      // Order outer → inner: pinky, ring, middle, index (left hand keys are A S D F).
      const order = hand === 'l' ? ['p', 'r', 'm', 'i'] : ['i', 'm', 'r', 'p'];
      const knuckleDrop = { p: 2.05, r: 2.35, m: 2.45, i: 2.3 };   // rows below the home row
      const width = { p: 0.66, r: 0.76, m: 0.8, i: 0.8 };
      const bend = { p: 0.1, r: 0.04, m: 0, i: -0.05 };            // gentle curl toward the middle finger
      order.forEach((t, k) => {
        const id = hand + t;
        const home = homeKeys[k];
        g.homes[id] = pad(home);
        g.bases[id] = { x: cx + (home.x - cx) * 0.84, y: home.y + v * knuckleDrop[t] };
        g.widths[id] = u * width[t];
        g.bends[id] = s * u * bend[t];
      });
      // Thumb: from the base of the hand up and inward to the space bar.
      const th = hand + 't';
      const idx = g.bases[hand + 'i'];
      g.homes[th] = { x: SP.x - s * u * 1.05, y: SP.y + h * 0.05 };
      g.bases[th] = { x: idx.x - s * u * 0.55, y: idx.y + v * 2.25 };
      g.widths[th] = u * 0.9;
      g.bends[th] = -s * u * 0.12;

      // Back of the hand, from the knuckles down to the wrist.
      const B = t => g.bases[hand + t], Wd = t => g.widths[hand + t];
      const p = B('p'), r = B('r'), m = B('m'), i = B('i'), tb = g.bases[th];
      const palm = [
        { x: p.x - s * Wd('p') * 0.62, y: p.y + v * 0.15 },
        { x: p.x - s * Wd('p') * 0.2, y: p.y - v * 0.22 },
        { x: r.x, y: r.y - v * 0.3 },
        { x: m.x, y: m.y - v * 0.3 },
        { x: i.x + s * Wd('i') * 0.1, y: i.y - v * 0.26 },
        { x: i.x + s * Wd('i') * 0.6, y: i.y + v * 0.15 },
        { x: i.x + s * Wd('i') * 0.62, y: i.y + v * 0.75 },
        { x: tb.x + s * u * 0.35, y: tb.y + v * 0.1 },
        { x: tb.x + s * u * 0.05, y: H + v * 0.5 },
        { x: p.x + s * u * 0.45, y: H + v * 0.5 },
        { x: p.x - s * Wd('p') * 0.55, y: p.y + v * 1.3 },
      ];
      shapeEl('palm-' + hand).setAttribute('d', smoothClosed(palm));
      // Knuckle bumps on the back of the hand.
      g.knuckles = (g.knuckles || '') + ['p', 'r', 'm', 'i'].map(t => {
        const b = B(t), half = Wd(t) * 0.28, y = b.y + v * 0.12;
        return `<path class="crease knuckle" d="M${f1(b.x - half)},${f1(y)}Q${f1(b.x)},${f1(y - v * 0.14)} ${f1(b.x + half)},${f1(y)}"/>`;
      }).join('');
    });
    geo = g;
    HAND_IDS.forEach(id => { fingers[id].cur = null; fingers[id].to = null; });
    render();
  }

  function targetPoint(id) {
    const code = targets[id];
    if (!code || code === 'Space') return geo.homes[id];
    const k = rect(code);
    const off = geo.h * 0.1 + geo.u * 0.3;
    if (code === 'ShiftLeft') return { x: k.r - geo.u * 0.55, y: k.y + off };
    if (code === 'ShiftRight') return { x: k.l + geo.u * 0.55, y: k.y + off };
    return { x: k.x, y: k.y + off };
  }

  function drawAll() {
    let details = geo.knuckles || '', top = '';
    const nailSvg = n => `<ellipse class="nail" cx="${f1(n.cx)}" cy="${f1(n.cy)}" rx="${f1(n.rx)}" ry="${f1(n.ry)}" transform="rotate(${n.angle.toFixed(1)} ${f1(n.cx)} ${f1(n.cy)})"/>`;
    HAND_IDS.forEach(id => {
      const fs = fingerShape(geo.bases[id], fingers[id].cur, geo.widths[id], geo.bends[id], id[1] === 't');
      shapeEl(id).setAttribute('d', fs.outline);
      const detail = fs.creases.map(c => `<path class="crease" d="${c}"/>`).join('') + nailSvg(fs.nail);
      const cls = [targets[id] ? 'active' : '', flashes[id] || '', heatRates && heatRates[id] != null ? 'heat' : ''].filter(Boolean).join(' ');
      if (cls) {
        const heat = heatRates && heatRates[id] != null ? ` style="--heat:${Math.min(85, Math.round(heatRates[id] * 500))}%"` : '';
        top += `<g class="digit ${cls}"${heat}><path class="finger-fill" d="${fs.openFill}"/><path class="finger-line" d="${fs.openLine}"/>${detail}</g>`;
      } else {
        details += detail;
      }
    });
    $('.h-details', svg).innerHTML = details;
    $('.h-top', svg).innerHTML = top;
  }

  const ease = t => 1 - Math.pow(1 - t, 3);
  function tick(now) {
    let running = false;
    HAND_IDS.forEach(id => {
      const f = fingers[id];
      if (!f.to) return;
      const t = Math.min(1, (now - f.t0) / 200), e = ease(t);
      f.cur = { x: f.from.x + (f.to.x - f.from.x) * e, y: f.from.y + (f.to.y - f.from.y) * e };
      if (t < 1) running = true; else f.to = null;
    });
    drawAll();
    raf = running ? requestAnimationFrame(tick) : 0;
  }

  function render() {
    if (!geo) return;
    const now = performance.now();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    HAND_IDS.forEach(id => {
      const f = fingers[id];
      const target = targetPoint(id);
      if (!f.cur || reduce) { f.cur = target; f.to = null; return; }
      if (Math.hypot(target.x - f.cur.x, target.y - f.cur.y) < 0.3) { f.to = null; return; }
      f.from = { ...f.cur };
      f.to = target;
      f.t0 = now;
    });
    drawAll();
    if (!raf && HAND_IDS.some(id => fingers[id].to)) raf = requestAnimationFrame(tick);
  }

  function flash(id, cls, ms) {
    flashes[id] = cls;
    drawAll();
    clearTimeout(fingers[id].ft);
    fingers[id].ft = setTimeout(() => { delete flashes[id]; if (geo) drawAll(); }, ms);
  }

  requestAnimationFrame(layout);
  if (document.fonts) document.fonts.ready.then(layout);
  onResizeWhile(stage, layout);

  return {
    point(t) { targets = t; render(); },
    tap(code, ok) {
      let id = Object.keys(targets).find(f => targets[f] === code);
      if (!id) {
        const f = FINGER[code];
        if (f === 'th') id = targets.lt ? 'lt' : 'rt';
        else if (f && f !== 'mod') id = f;
      }
      if (id && geo) flash(id, ok ? 'tap' : 'bad', ok ? 150 : 350);
    },
    heat(rates) { heatRates = rates; if (geo) drawAll(); },
  };
}

// ---------- On-screen keyboard ----------
// The practised language's character is the big label, the other one sits in the corner.
function keyLabels(he, en) {
  if (he === 'רווח') he = tr('רווח', 'space');
  const [main, corner] = LANG === 'en' && en ? [en, SITE_LANG === 'en' ? '' : (he === en ? '' : he)] : [he, en];
  return `<span class="k-he">${esc(main)}</span>${corner ? `<span class="k-en">${esc(corner)}</span>` : ''}`;
}

function Keyboard(el, { colored = false, hands = false } = {}) {
  el.innerHTML = `<div class="kb-stage${hands ? ' with-hands' : ''}">` +
    `<div class="kb${colored ? ' colored' : ''}" dir="ltr">${KEY_ROWS.map(row =>
      `<div class="kb-row">${row.map(([code, he, en, f, w = 1]) =>
        `<div class="key f-${f}${code === 'KeyF' || code === 'KeyJ' ? ' bump' : ''}" data-code="${code}" style="--w:${w}">` +
        keyLabels(he, en) + '</div>').join('')}</div>`).join('')}</div>` +
    `${hands ? '<div class="hands" aria-hidden="true"></div>' : ''}</div>`;
  const keys = {};
  $$('.key', el).forEach(k => { keys[k.dataset.code] = k; });
  const handsApi = hands ? Hands($('.kb-stage', el), $('.kb', el), keys) : null;
  let lit = [];
  let lastHand = 'l';

  return {
    hands: handsApi,
    highlight(ch) {
      lit.forEach(k => k.classList.remove('next'));
      lit = [];
      const r = ch == null ? null : KEY_OF[ch];
      if (!r) { if (handsApi) handsApi.point({}); return null; }
      const f = FINGER[r.code];
      const t = {};
      lit.push(keys[r.code]);
      if (f === 'th') {
        // Press space with the thumb opposite the hand that typed the previous letter.
        t[lastHand === 'l' ? 'rt' : 'lt'] = r.code;
      } else {
        t[f] = r.code;
        lastHand = f[0];
      }
      if (r.shift) {
        const shift = f[0] === 'l' ? 'ShiftRight' : 'ShiftLeft';
        lit.push(keys[shift]);
        t[f[0] === 'l' ? 'rp' : 'lp'] = shift;
      }
      lit.forEach(k => k.classList.add('next'));
      if (handsApi) handsApi.point(t);
      return f;
    },
    flash(code, ok) {
      const k = keys[code];
      if (handsApi) handsApi.tap(code, ok);
      if (!k) return;
      const c = ok ? 'hit' : 'miss';
      k.classList.remove('hit', 'miss');
      void k.offsetWidth;
      k.classList.add(c);
      clearTimeout(k._t);
      k._t = setTimeout(() => k.classList.remove(c), 160);
    },
    mark(chars, cls) {
      Object.values(keys).forEach(k => k.classList.remove(cls));
      chars.forEach(ch => { const r = REVERSE[ch]; if (r) keys[r.code].classList.add(cls); });
    },
    dimExcept(chars) {
      const keep = new Set(chars.map(ch => REVERSE[ch] && REVERSE[ch].code));
      Object.entries(keys).forEach(([code, k]) => k.classList.toggle('dim', FINGER[code] !== 'mod' && !keep.has(code)));
    },
    heat(stats) {
      Object.entries(keys).forEach(([code, k]) => {
        const ch = BASE[code];
        const s = ch && stats[ch];
        const total = s ? s[0] + s[1] : 0;
        k.classList.remove('heat');
        k.removeAttribute('title');
        if (!s || total < 3 || ch === ' ') return;
        const rate = s[1] / total;
        k.style.setProperty('--heat', Math.min(90, Math.round(rate * 400)) + '%');
        k.classList.add('heat');
        const ms = s[3] ? ` · ${Math.round(s[2] / s[3])}ms` : '';
        k.title = `${ch}: ${tr('דיוק', 'accuracy')} ${Math.round((1 - rate) * 100)}% (${total} ${tr('הקשות', 'taps')})${ms}`;
      });
    },
  };
}

const fingerLegend = () => `<div class="legend">
  <span><i style="background:var(--f-p)"></i>${tr('זרת', 'little')}</span>
  <span><i style="background:var(--f-r)"></i>${tr('קמיצה', 'ring')}</span>
  <span><i style="background:var(--f-m)"></i>${tr('אמה', 'middle')}</span>
  <span><i style="background:var(--f-i)"></i>${tr('אצבע מורה', 'index')}</span>
  <span><i style="background:var(--f-t)"></i>${tr('אגודל', 'thumb')}</span>
</div>`;
