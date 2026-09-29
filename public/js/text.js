'use strict';

// ---------- Exercise text generation ----------
const FINALS = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };
const FINAL_SET = new Set(Object.values(FINALS));

// A pronounceable-ish letter group drawn from `letters`, containing at least one `focus` letter.
// Final letters only appear at the end, as in real Hebrew.
function pseudoWord(letters, focus, len) {
  const nonFinal = letters.filter(c => !FINAL_SET.has(c));
  const pool = nonFinal.length ? nonFinal : letters;
  const w = [];
  for (let i = 0; i < len; i++) w.push(i === len - 1 ? pick(letters) : pick(pool));
  if (focus.length && !w.some(c => focus.includes(c))) {
    const f = pick(focus);
    if (FINAL_SET.has(f) || len === 1) w[len - 1] = f;
    else w[rand(len - 1)] = f;
  }
  const last = w[len - 1];
  if (FINALS[last] && letters.includes(FINALS[last])) w[len - 1] = FINALS[last];
  return w.join('');
}

function randomWords(n, { punct = false, nums = false } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let w;
    do { w = pick(WORDS); } while (out.length && w === out[out.length - 1]);
    if (nums && Math.random() < 0.12) {
      w = String(rand(Math.random() < 0.5 ? 100 : 2100));
    } else if (punct) {
      const r = Math.random();
      if (r < 0.1) w += ',';
      else if (r < 0.17) w += '.';
      else if (r < 0.2) w += '?';
    }
    out.push(w);
  }
  return out.join(' ');
}

// Words sampled with extra weight for every focus letter they contain.
function weightedWords(n, focus, boost = 6) {
  const weights = WORDS.map(w => 1 + [...w].reduce((s, c) => s + (focus.includes(c) ? boost : 0), 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const out = [];
  while (out.length < n) {
    let r = Math.random() * total;
    let i = 0;
    while (i < weights.length - 1 && r > weights[i]) r -= weights[i++];
    if (WORDS[i] !== out[out.length - 1]) out.push(WORDS[i]);
  }
  return out;
}

function lessonLetters(idx) {
  const set = [];
  for (let i = 0; i <= idx; i++) LESSONS[i].newKeys.forEach(k => { if (isHebrew(k) && !set.includes(k)) set.push(k); });
  return set;
}

function lessonText(lesson, idx) {
  if (lesson.type === 'words') return randomWords(30);
  if (lesson.type === 'sentences') return shuffle(SENTENCES).slice(0, 4).join(' ');
  if (lesson.type === 'punct') {
    const words = randomWords(24).split(' ');
    return words.map((w, i) => {
      if (i === words.length - 1) return w + '.';
      const r = Math.random();
      return r < 0.22 ? w + ',' : r < 0.36 ? w + '.' : w;
    }).join(' ');
  }
  if (lesson.type === 'numbers') {
    const out = [];
    for (let i = 0; i < 24; i++) {
      if (i % 2 === 0) out.push(Array.from({ length: 1 + rand(4) }, () => rand(10)).join(''));
      else out.push(pick(WORDS));
    }
    return out.join(' ');
  }

  const allowed = lessonLetters(idx);
  const focus = lesson.newKeys.length ? lesson.newKeys : allowed;
  const parts = [];
  if (lesson.newKeys.length) {
    lesson.newKeys.forEach(k => parts.push(k.repeat(3)));
    for (let i = 0; i < 6; i++) parts.push(pseudoWord(lesson.newKeys, lesson.newKeys, 2 + rand(2)));
  }
  const allowedSet = new Set(allowed);
  const fits = WORDS.filter(w => [...w].every(c => allowedSet.has(c)) && [...w].some(c => focus.includes(c)));
  const count = lesson.review ? 30 : 22;
  for (let i = 0; i < count; i++) {
    let w;
    do {
      w = fits.length >= 4 && Math.random() < 0.7 ? pick(fits) : pseudoWord(allowed, focus, 2 + rand(4));
    } while (w === parts[parts.length - 1]);
    parts.push(w);
  }
  return parts.join(' ');
}

// Text for a personalised lesson: short drills on the focus keys, then real words rich in them.
function focusText(keys, { words = [], length = 28 } = {}) {
  const letters = keys.filter(isHebrew);
  const others = keys.filter(k => !isHebrew(k) && k !== ' ');
  const parts = [];
  letters.forEach(k => parts.push(k.repeat(3)));
  if (letters.length >= 2) {
    for (let i = 0; i < 4; i++) parts.push(pseudoWord(letters, letters, 2 + rand(2)));
  }
  const pool = letters.length ? weightedWords(length, letters, 10) : randomWords(length).split(' ');
  const out = pool.map(w => {
    if (!others.length || Math.random() > 0.35) return w;
    const o = pick(others);
    return /\d/.test(o) ? o + rand(10) : w + o;
  });
  const mixed = shuffle([...out, ...words, ...words]);
  return [...parts, ...mixed].join(' ');
}
