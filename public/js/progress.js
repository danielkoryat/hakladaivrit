'use strict';

// ---------- Progress over time (profile page) ----------
// Speed, accuracy and typing time per day on a real time axis, a calendar of practice
// days, and a weekly table with the same numbers (the chart's readable twin).

const PROGRESS_METRICS = {
  speed: { name: tr('מהירות', 'Speed'), sub: tr('מילים לדקה · ממוצע יומי במבחני ההקלדה', 'words per minute · daily average on typing tests') },
  acc: { name: tr('דיוק', 'Accuracy'), sub: tr('אחוז הקשות נכונות · ממוצע יומי בכל האימונים', 'percent correct keystrokes · daily average on all training') },
  time: { name: tr('זמן הקלדה', 'Typing time'), sub: tr('דקות הקלדה בכל יום', 'minutes of typing each day') },
};
const PROGRESS_RANGES = { 30: tr('30 יום', '30 days'), 90: tr('90 יום', '90 days'), all: tr('הכל', 'All time') };
const WEEKDAYS = [tr('א׳', 'Sun'), tr('ב׳', 'Mon'), tr('ג׳', 'Tue'), tr('ד׳', 'Wed'), tr('ה׳', 'Thu'), tr('ו׳', 'Fri'), tr('ש׳', 'Sat')];
const MONTHS = [tr('ינו׳', 'Jan'), tr('פבר׳', 'Feb'), tr('מרץ', 'Mar'), tr('אפר׳', 'Apr'), tr('מאי', 'May'), tr('יוני', 'Jun'), tr('יולי', 'Jul'), tr('אוג׳', 'Aug'), tr('ספט׳', 'Sep'), tr('אוק׳', 'Oct'), tr('נוב׳', 'Nov'), tr('דצמ׳', 'Dec')];

// The language a result was typed in. English tests and lessons are marked by their mode;
// practice and texts can be either, so they count for both.
function resultLang(h) {
  const m = h.mode || '';
  if (m.startsWith('en-') || /^lesson-[13]\d\d$/.test(m)) return 'en';
  if (h.kind === 'test' || h.kind === 'lesson') return 'he';
  return null;
}
const inLang = h => { const l = resultLang(h); return !l || l === LANG; };

const dayTime = day => new Date(day + 'T00:00:00').getTime();
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return localDay(d); };
const weekStart = day => addDays(day, -new Date(day + 'T12:00:00').getDay());   // weeks start on Sunday
const shortDate = day => { const [, m, dd] = day.split('-'); return `${Number(dd)}.${Number(m)}`; };
const weekday = day => WEEKDAYS[new Date(day + 'T12:00:00').getDay()];

function niceStepOf(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

// Groups results into buckets (a day or a week) with everything the three metrics need.
function bucketHistory(d, keyOf, filter) {
  const by = {};
  d.history.forEach(h => {
    if (!h.at || !filter(h)) return;
    const key = keyOf(localDay(new Date(h.at)));
    const b = by[key] || (by[key] = { day: key, n: 0, tests: 0, wpm: 0, best: 0, accW: 0, chars: 0, secs: 0 });
    b.n++;
    b.secs += h.secs || 0;
    if (h.kind === 'test' && h.chars > 0 && inLang(h)) { b.tests++; b.wpm += h.wpm; b.best = Math.max(b.best, h.wpm); }
    if (h.chars > 0 && inLang(h)) { b.accW += h.acc * h.chars; b.chars += h.chars; }
  });
  return Object.values(by).sort((a, b) => (a.day < b.day ? -1 : 1));
}

// One point per day (or per week for long bar ranges) for the chosen metric.
function progressPoints(d, metric, start, byWeek) {
  const buckets = bucketHistory(d, byWeek ? weekStart : x => x, h => localDay(new Date(h.at)) >= start);
  return buckets
    .map(b => ({
      day: b.day, n: b.n, tests: b.tests, best: b.best,
      value: metric === 'speed' ? (b.tests ? b.wpm / b.tests : null)
        : metric === 'acc' ? (b.chars ? b.accW / b.chars : null)
        : b.secs / 60,
    }))
    .filter(p => p.value != null && (metric !== 'time' || p.value > 0));
}

function fmtValue(metric, v) {
  if (metric === 'acc') return `${Math.round(v)}%`;
  if (metric === 'time') return v < 1 ? '<1' : String(Math.round(v));
  return String(Math.round(v));
}
const unitOf = metric => (metric === 'speed' ? tr('מילים לדקה', 'words per minute') : metric === 'acc' ? tr('דיוק', 'accuracy') : tr('דקות', 'minutes'));

// "Then vs now" for the range: the first and last few points, or totals for typing time.
function progressSummary(metric, pts, byWeek) {
  const fig = (label, value, sub, cls = '') => `<div class="pg-fig"><span class="pg-label">${label}</span><b class="pg-value ${cls}">${value}</b><span class="pg-sub">${sub}</span></div>`;
  if (metric === 'time') {
    const total = pts.reduce((s, p) => s + p.value, 0);
    const days = pts.length;
    return fig(tr('סך הכל', 'Total'), fmtTime(total * 60), tr('זמן הקלדה בטווח', 'typing time in this range')) +
      fig(byWeek ? tr('שבועות', 'weeks') : tr('ימים', 'days'), days, byWeek ? tr('שבועות שבהם התאמנתם', 'weeks you practiced') : tr('ימים שבהם התאמנתם', 'days you practiced')) +
      fig(tr('ממוצע', 'Average'), fmtValue('time', days ? total / days : 0), byWeek ? tr('דקות בשבוע תרגול', 'minutes per week practiced') : tr('דקות ביום תרגול', 'minutes per day practiced'));
  }
  if (pts.length < 2) return '';
  const k = Math.min(3, Math.floor(pts.length / 2));
  const avg = arr => arr.reduce((s, p) => s + p.value, 0) / arr.length;
  const first = avg(pts.slice(0, k)), last = avg(pts.slice(-k));
  const diff = Math.round(last - first);
  const unit = metric === 'acc' ? tr(' נק׳ אחוז', ' percentage points') : tr(' מילים לדקה', ' words per minute');
  const change = diff === 0 ? tr('ללא שינוי', 'no change') : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}`;
  return fig(tr('בהתחלה', 'Start'), fmtValue(metric, first), k > 1 ? `${tr('ממוצע', 'average')} ${k} ${tr('הימים הראשונים', 'first days')}` : shortDate(pts[0].day)) +
    fig(tr('עכשיו', 'Now'), fmtValue(metric, last), k > 1 ? `${tr('ממוצע', 'average')} ${k} ${tr('הימים האחרונים', 'last days')}` : shortDate(pts[pts.length - 1].day)) +
    fig(tr('שינוי', 'Change'), change, diff === 0 ? '&nbsp;' : unit.trim(), diff > 0 ? 'up' : diff < 0 ? 'down' : '');
}

// Line (speed, accuracy) or bars (typing time) on a time axis from `start` to today.
function progressChart(el, pts, { metric, start, end, byWeek }) {
  el.setAttribute('dir', 'ltr');
  el.tabIndex = 0;
  el.setAttribute('role', 'img');
  const bars = metric === 'time';
  if (pts.length < (bars ? 1 : 2)) {
    el.removeAttribute('aria-label');
    el.innerHTML = `<p class="muted pg-empty" dir="${tr('rtl', 'ltr')}">${metric === 'speed'
      ? tr('צריך לפחות שני ימים עם מבחן הקלדה בטווח הזה כדי לראות מגמה.', 'Need at least two days with a typing test in this range to see a trend.')
      : tr('אין מספיק נתונים בטווח הזה. המשיכו להתאמן והגרף יתמלא.', 'Not enough data in this range. Keep practicing and the graph will fill up.')}</p>`;
    return;
  }
  const last = pts[pts.length - 1];
  el.setAttribute('aria-label', `${PROGRESS_METRICS[metric].name}: ${pts.length} ${byWeek ? tr('שבועות', 'weeks') : tr('ימים', 'days')}, ${tr('אחרון', 'last')} ${fmtValue(metric, last.value)} ${unitOf(metric)}`);
  let active = null;

  function draw() {
    const W = el.clientWidth || 600, H = 250, m = { t: 18, r: bars ? 12 : 44, b: 30, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const t0 = dayTime(start), t1 = dayTime(end);
    const span = Math.max(1, t1 - t0);
    const slots = Math.max(1, Math.round(span / 86400000 / (byWeek ? 7 : 1)) + 1);
    const slotW = iw / slots;
    const x = day => bars
      ? m.l + ((dayTime(day) - t0) / span) * (iw - slotW) + slotW / 2
      : m.l + (t1 === t0 ? iw / 2 : ((dayTime(day) - t0) / span) * iw);

    const vals = pts.map(p => p.value);
    let lo = 0, top;
    if (metric === 'acc') {
      lo = Math.max(0, Math.floor((Math.min(...vals) - 4) / 5) * 5);
      top = 100;
    } else {
      top = Math.max(metric === 'speed' ? 10 : 5, ...vals);
    }
    const step = niceStepOf((top - lo) / 4);
    top = lo + Math.ceil((top - lo) / step - 1e-9) * step;
    const y = v => m.t + ih - ((v - lo) / (top - lo)) * ih;

    let grid = '';
    for (let v = lo; v <= top + 1e-9; v += step) {
      grid += `<line class="c-grid" x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}"/>` +
        `<text class="c-tick" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${metric === 'acc' ? v + '%' : v}</text>`;
    }
    // About five date ticks, evenly spread over the range.
    const nTicks = Math.max(2, Math.min(5, Math.floor(iw / 90)));
    let ticks = '';
    for (let i = 0; i < nTicks; i++) {
      const day = localDay(new Date(t0 + (span * i) / (nTicks - 1) + 43200000));
      const tx = m.l + (iw * i) / (nTicks - 1);
      ticks += `<text class="c-tick" x="${tx}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === nTicks - 1 ? 'end' : 'middle'}">${shortDate(day)}</text>`;
    }

    let marks = '';
    if (bars) {
      const bw = Math.max(2, Math.min(28, slotW - 2));
      marks = pts.map(p => {
        const bx = x(p.day) - bw / 2, by = y(p.value), bh = y(0) - by;
        const r = Math.min(4, bw / 2, bh);
        return `<path class="c-bar" d="M${bx},${y(0)}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + bw - r}Q${bx + bw},${by} ${bx + bw},${by + r}V${y(0)}Z"/>`;
      }).join('');
    } else {
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
      const area = metric === 'speed' ? `<path class="c-area" d="${line}L${x(last.day).toFixed(1)},${y(lo)}L${x(pts[0].day).toFixed(1)},${y(lo)}Z"/>` : '';
      const dots = pts.length <= 40 ? pts.slice(0, -1).map(p => `<circle class="c-dot small" cx="${x(p.day)}" cy="${y(p.value)}" r="3"/>`).join('') : '';
      marks = `${area}<path class="c-line" d="${line}"/>${dots}
        <circle class="c-dot" cx="${x(last.day)}" cy="${y(last.value)}" r="4"/>
        <text class="c-end" x="${x(last.day) + 9}" y="${y(last.value) + 4}">${fmtValue(metric, last.value)}</text>`;
    }

    el.innerHTML = `
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
        ${grid}${ticks}${marks}
        <line class="c-cross" id="pg-cross" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
        <circle class="c-dot" id="pg-hover" r="4" visibility="hidden"/>
        <rect x="${m.l - 10}" y="0" width="${iw + 20}" height="${H}" fill="transparent" id="pg-hit"/>
      </svg>
      <div class="c-tip" id="pg-tip" hidden><strong></strong><span></span></div>`;

    const cross = $('#pg-cross', el), hover = $('#pg-hover', el), tip = $('#pg-tip', el);
    const show = i => {
      active = i;
      const p = pts[i];
      const px = x(p.day);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      if (!bars) { hover.setAttribute('cx', px); hover.setAttribute('cy', y(p.value)); hover.setAttribute('visibility', 'visible'); }
      tip.hidden = false;
      $('strong', tip).textContent = `${fmtValue(metric, p.value)} ${metric === 'acc' ? tr('דיוק', 'accuracy') : unitOf(metric)}`;
      const when = byWeek ? `${tr('השבוע של', 'Week of')} ${shortDate(p.day)}` : `${tr('יום', 'Day')} ${weekday(p.day)} ${shortDate(p.day)}`;
      const count = metric === 'speed' ? `${p.tests} ${p.tests === 1 ? tr('מבחן', 'test') : tr('מבחנים', 'tests')}${p.tests > 1 ? ` · ${tr('שיא', 'best')} ${Math.round(p.best)}` : ''}` : `${p.n} ${p.n === 1 ? tr('אימון', 'training') : tr('אימונים', 'trainings')}`;
      $('span', tip).textContent = `${when} · ${count}`;
      const tx = Math.min(Math.max(px - tip.offsetWidth / 2, 0), W - tip.offsetWidth);
      tip.style.left = tx + 'px';
      tip.style.top = Math.max(0, y(p.value) - tip.offsetHeight - 14) + 'px';
    };
    const hide = () => { active = null; cross.setAttribute('visibility', 'hidden'); hover.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    const nearest = px => pts.reduce((best, p, i) => (Math.abs(x(p.day) - px) < Math.abs(x(pts[best].day) - px) ? i : best), 0);
    const hit = $('#pg-hit', el);
    hit.addEventListener('pointermove', e => show(nearest(e.clientX - el.getBoundingClientRect().left)));
    hit.addEventListener('pointerleave', hide);
    el.onkeydown = e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      show(active == null ? pts.length - 1 : Math.max(0, Math.min(pts.length - 1, active + dir)));
    };
    el.onblur = hide;
  }
  draw();
  onResizeWhile(el, draw);
}

// The same numbers, week by week (newest first).
function weeklyTable(d) {
  const weeks = bucketHistory(d, weekStart, () => true).reverse().slice(0, 12);
  if (!weeks.length) return `<p class="muted">${tr('עדיין אין נתונים.', 'No data yet.')}</p>`;
  return `<table class="table">
    <thead><tr><th>${tr('שבוע', 'Week')}</th><th>${tr('אימונים', 'Trainings')}</th><th>${tr('מהירות במבחנים', 'Speed on tests')}</th><th>${tr('דיוק', 'Accuracy')}</th><th>${tr('זמן הקלדה', 'Typing time')}</th></tr></thead>
    <tbody>${weeks.map(w => `<tr>
      <td class="num">${shortDate(w.day)}</td>
      <td class="num">${w.n}</td>
      <td class="num">${w.tests ? Math.round(w.wpm / w.tests) : '-'}</td>
      <td class="num">${w.chars ? Math.round(w.accW / w.chars) + '%' : '-'}</td>
      <td class="num">${fmtTime(w.secs)}</td></tr>`).join('')}</tbody>
  </table>`;
}

// A calendar of practice days, coloured by the XP earned that day (the daily goal is 100).
const CAL_LEVELS = [[0, tr('לא התאמנתם', 'No practice')], [1, tr('עד 29 XP', 'Up to 29 XP')], [30, tr('30 עד 99 XP', '30 to 99 XP')], [100, tr('יעד יומי: 100 XP ומעלה', 'Daily goal: 100 XP or more')], [200, tr('200 XP ומעלה', '200 XP or more')]];
const calLevel = xp => (xp >= 200 ? 4 : xp >= 100 ? 3 : xp >= 30 ? 2 : xp > 0 ? 1 : 0);

function practiceCalendar(el, sumEl, d) {
  const g = Gamify.state(d);
  el.setAttribute('dir', 'ltr');
  function draw() {
    const cell = 12, gap = 3, stepPx = cell + gap, left = 22, topPad = 16;
    const weeks = Math.max(10, Math.min(53, Math.floor(((el.clientWidth || 420) - left) / stepPx)));   // up to a year
    const today = localDay();
    const first = addDays(weekStart(today), -(weeks - 1) * 7);
    let cells = '', months = '', active = 0, lastLabel = -9;
    const grid = [];
    for (let w = 0; w < weeks; w++) {
      for (let r = 0; r < 7; r++) {
        const day = addDays(first, w * 7 + r);
        // Each month is named above the column where it starts, unless that would crowd the previous name.
        if (day.endsWith('-01') && w - lastLabel >= 3 && w < weeks - 1) {
          months += `<text class="c-tick" x="${left + w * stepPx}" y="10">${MONTHS[Number(day.slice(5, 7)) - 1]}</text>`;
          lastLabel = w;
        }
        if (day > today) continue;
        const info = g.days[day];
        const xp = info ? info.xp : 0;
        if (xp > 0) active++;
        grid.push({ w, r, day, xp, n: info ? info.n : 0 });
        cells += `<rect class="cal-cell lv${calLevel(xp)}${day === today ? ' today' : ''}" x="${left + w * stepPx}" y="${topPad + r * stepPx}" width="${cell}" height="${cell}" rx="3"/>`;
      }
    }
    const labels = [1, 3, 5].map(r => `<text class="c-tick" x="${left - 6}" y="${topPad + r * stepPx + 10}" text-anchor="end">${WEEKDAYS[r]}</text>`).join('');
    const W = left + weeks * stepPx, H = topPad + 7 * stepPx;
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${active} ${tr('ימי תרגול ב־', 'practice days in the last ')}${weeks} ${tr('השבועות האחרונים', 'weeks')}">${months}${labels}${cells}</svg>
      <div class="c-tip" hidden><strong></strong><span></span></div>`;
    const svg = $('svg', el), tip = $('.c-tip', el);
    svg.addEventListener('pointermove', e => {
      const rect = svg.getBoundingClientRect();
      const w = Math.floor((e.clientX - rect.left - left) / stepPx), r = Math.floor((e.clientY - rect.top - topPad) / stepPx);
      const c = grid.find(x => x.w === w && x.r === r);
      if (!c) { tip.hidden = true; return; }
      tip.hidden = false;
      $('strong', tip).textContent = c.xp ? `${c.xp} XP` : tr('לא התאמנתם', 'No practice');
      $('span', tip).textContent = `${tr('יום', 'Day')} ${weekday(c.day)} ${shortDate(c.day)}${c.n ? ` · ${c.n} ${c.n === 1 ? tr('אימון', 'training') : tr('אימונים', 'trainings')}` : ''}`;
      const cx = left + c.w * stepPx + cell / 2;
      tip.style.left = Math.min(Math.max(cx - tip.offsetWidth / 2, 0), W - tip.offsetWidth) + 'px';
      tip.style.top = Math.max(0, topPad + c.r * stepPx - tip.offsetHeight - 6) + 'px';
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
    const best = Math.max(g.bestStreak || 0, Gamify.streak(g));
    sumEl.innerHTML = `<b class="num">${active}</b> ${tr('ימי תרגול ב־', 'practice days in the last ')}${weeks} ${tr('השבועות האחרונים', 'weeks')} · ${tr('הרצף הארוך ביותר:', 'Longest streak:')} <b class="num">${best}</b> ${best === 1 ? tr('יום', 'day') : tr('ימים', 'days')}`;
  }
  draw();
  onResizeWhile(el, draw);
}

// The whole section: a filter row, the chart card and the calendar card.
function progressSection() {
  const b = (group, key, label) => `<button class="cfg-btn" data-${group}="${key}">${label}</button>`;
  return `
    <div class="pg-top">
      <h2 class="section-title">${tr('ההתקדמות שלי לאורך זמן', 'My progress over time')}</h2>
      <div class="config pg-filters">
        <div class="cfg-group">${Object.entries(PROGRESS_METRICS).map(([k, v]) => b('metric', k, v.name)).join('')}</div>
        <div class="cfg-sep"></div>
        <div class="cfg-group">${Object.entries(PROGRESS_RANGES).map(([k, v]) => b('range', k, v)).join('')}</div>
      </div>
    </div>
    <div class="panel">
      <p class="panel-sub" id="pg-sub"></p>
      <div class="pg-summary" id="pg-summary"></div>
      <div class="chart" id="pg-chart"></div>
      <details class="pg-table"><summary>${tr('הנתונים לפי שבוע', 'Data by week')}</summary><div id="pg-weeks"></div></details>
    </div>
    <div class="panel">
      <h2>${tr('ימי תרגול', 'Practice days')}</h2>
      <p class="panel-sub">${tr('כל ריבוע הוא יום. ככה נראית התמדה.', 'Each square is a day. This is what consistency looks like.')}</p>
      <div class="calendar" id="pg-cal"></div>
      <div class="cal-foot">
        <span id="pg-cal-sum"></span>
        <span class="cal-legend" aria-hidden="true">${tr('פחות', 'Less')} ${CAL_LEVELS.map((l, i) => `<i class="lv${i}" title="${l[1]}"></i>`).join('')} ${tr('יותר', 'More')}</span>
      </div>
    </div>`;
}

function mountProgress(d) {
  const st = Object.assign({ metric: 'speed', range: '30' }, Store.get('progressView', {}));
  const render = () => {
    $$('.pg-filters [data-metric]').forEach(x => x.classList.toggle('active', x.dataset.metric === st.metric));
    $$('.pg-filters [data-range]').forEach(x => x.classList.toggle('active', x.dataset.range === st.range));
    const end = localDay();
    const firstAt = d.history.reduce((min, h) => (h.at && h.at < min ? h.at : min), Date.now());
    const start = st.range === 'all' ? localDay(new Date(firstAt)) : addDays(end, -(Number(st.range) - 1));
    const byWeek = st.metric === 'time' && (dayTime(end) - dayTime(start)) / 86400000 > 120;
    const from = byWeek ? weekStart(start) : start;
    const pts = progressPoints(d, st.metric, from, byWeek);
    $('#pg-sub').textContent = PROGRESS_METRICS[st.metric].sub.replace(tr('בכל יום', 'each day'), byWeek ? tr('בכל שבוע', 'each week') : tr('בכל יום', 'each day')) + (st.metric === 'speed' && LANG === 'en' ? tr(' באנגלית', '') : '');
    $('#pg-summary').innerHTML = progressSummary(st.metric, pts, byWeek);
    progressChart($('#pg-chart'), pts, { metric: st.metric, start: from, end, byWeek });
  };
  $('.pg-filters').addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.metric) st.metric = t.dataset.metric;
    if (t.dataset.range) st.range = t.dataset.range;
    Store.set('progressView', st);
    render();
  });
  render();
  $('#pg-weeks').innerHTML = weeklyTable(d);
  practiceCalendar($('#pg-cal'), $('#pg-cal-sum'), d);
}
