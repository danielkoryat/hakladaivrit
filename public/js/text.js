'use strict';

// ---------- Exercise text generation ----------
const FINALS = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };
const FINAL_SET = new Set(Object.values(FINALS));
const MEDIAL = Object.fromEntries(Object.entries(FINALS).map(([m, f]) => [f, m]));

// Real words the lessons can draw on: the common-word list plus words that can be typed
// with only the first lessons' keys.
const LESSON_POOL = [...new Set([...WORDS, ...LESSON_WORDS])];

// A pronounceable-ish letter group drawn from `letters`, containing at least one `focus` letter.
// As in real Hebrew, final letters only appear at the end, and a letter that has a final
// form (כ מ נ פ צ) never ends a group in its regular form.
function pseudoWord(letters, focus, len) {
  const inner = letters.filter(c => !FINAL_SET.has(c));
  const enders = letters.filter(c => !FINALS[c]);
  const mid = inner.length ? inner : letters;
  const end = enders.length ? enders : letters;
  const w = [];
  for (let i = 0; i < len; i++) {
    const from = i === len - 1 ? end : mid;
    let c = pick(from);
    // No letter three times in a row.
    if (i >= 2 && c === w[i - 1] && c === w[i - 2] && from.length > 1) c = pick(from.filter(x => x !== c));
    w.push(c);
  }
  if (focus.length && !w.some(c => focus.includes(c))) {
    const f = pick(focus);
    if (FINAL_SET.has(f) || len === 1) w[len - 1] = f;
    else w[rand(len - 1)] = f;
  }
  const last = w[len - 1];
  if (FINALS[last] && len > 1) w[len - 1] = letters.includes(FINALS[last]) ? FINALS[last] : pick(end);
  return w.join('');
}

// The key a drill pairs with a new key: the home key of the same finger (ח for ו, f for r),
// so each reach is practised as a movement out of the home row and back. A home key is
// paired with the same finger's key on the other hand (כ with ח).
const MIRROR_FINGER = { lp: 'rp', lr: 'rr', lm: 'rm', li: 'ri', ri: 'li', rm: 'lm', rr: 'lr', rp: 'lp' };
function anchorKey(k) {
  const f = fingerOfChar(k);
  if (!HOME_KEY[f]) return null;
  const home = BASE[HOME_KEY[f]];
  return home !== k ? home : BASE[HOME_KEY[MIRROR_FINGER[f]]];
}

// Hebrew spelling for a letter group: a final letter only at the end, and no regular
// כ מ נ פ צ at the end.
const validGroup = w => ![...w].slice(0, -1).some(c => FINAL_SET.has(c)) && !(w.length > 1 && FINALS[w[w.length - 1]]);

// Opening drills for new keys: the key alone, then out of its home key and back.
function keyDrills(keys) {
  const parts = [];
  keys.forEach(k => {
    parts.push(k.repeat(3));
    const a = anchorKey(k);
    if (!a) return;
    const drills = [a + k + a, k + a + k, a + k, k + a, a + a + k, k + k + a].filter(validGroup).slice(0, 2);
    parts.push(...(drills.length ? drills : [`${a} ${k} ${a} ${k}`]));
  });
  return parts;
}

function randomWords(n, { punct = false, nums = false } = {}) {
  const out = [];
  const pool = WORDS;
  for (let i = 0; i < n; i++) {
    let w;
    do { w = pick(pool); } while (out.length && w === out[out.length - 1]);
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

// The letters taught up to and including lesson idx.
function lessonLetters(idx) {
  const set = [];
  for (let i = 0; i <= idx; i++) LESSONS[i].newKeys.forEach(k => { if (isLangLetter(k) && !set.includes(k)) set.push(k); });
  return set;
}

// Every key the letter lessons have taught so far, including ; on the English home row.
function lessonKeys(idx) {
  const set = new Set();
  for (let i = 0; i <= idx; i++) if (!LESSONS[i].type) LESSONS[i].newKeys.forEach(k => set.add(k));
  return [...set];
}

// The letters a review practises most: those taught since the previous review.
function groupLetters(idx) {
  const set = [];
  for (let i = idx - 1; i >= 0 && !LESSONS[i].review; i--) {
    LESSONS[i].newKeys.forEach(k => { if (isLangLetter(k) && !set.includes(k)) set.push(k); });
  }
  return set;
}

// Pushes items onto out until the text reaches about `chars` characters.
function fillTo(out, chars, next) {
  let len = out.join(' ').length;
  const count = {};
  for (let guard = 0; len < chars && guard < 500; guard++) {
    const w = next();
    // Avoid the same word twice in a row or more than twice in one lesson.
    if (!w || w === out[out.length - 1] || (count[w] || 0) >= 2) continue;
    count[w] = (count[w] || 0) + 1;
    out.push(w);
    len += w.length + 1;
  }
  return out;
}

// A letter lesson: drills on the new keys, then mostly real words that contain them, some
// real words with earlier keys only (spaced review) and letter groups where real words run out.
function letterLessonText(lesson, idx) {
  const allowed = lessonLetters(idx);
  const newLetters = lesson.newKeys.filter(isLangLetter);
  const focus = lesson.review ? groupLetters(idx) : newLetters;
  const parts = [];
  if (lesson.newKeys.length) {
    parts.push(...keyDrills(lesson.newKeys));
    const anchors = lesson.newKeys.map(anchorKey).filter(k => k && isLangLetter(k));
    const mix = [...new Set([...newLetters, ...anchors])];
    for (let i = 0; i < 4; i++) parts.push(pseudoWord(mix, newLetters, 3 + rand(2)));
  }
  return practiceWords(allowed, focus, lesson.review ? 230 : 160, parts).join(' ');
}

// About `chars` characters of words typed only with `allowed` letters: mostly real words with
// a focus letter, some real words without one (so other keys keep coming back), and letter
// groups where real words run out.
function practiceWords(allowed, focus, chars, parts = []) {
  const allowedSet = new Set(allowed);
  const pool = LESSON_POOL.filter(w => [...w].every(c => allowedSet.has(c)));
  const withFocus = pool.filter(w => [...w].some(c => focus.includes(c)));
  const older = pool.filter(w => !withFocus.includes(w));
  // The fewer real words there are, the more letter groups fill in.
  const pFocus = Math.min(0.7, withFocus.length / 15);
  const pOlder = older.length >= 6 ? 0.2 : 0;
  return fillTo(parts, parts.join(' ').length + chars, () => {
    const r = Math.random();
    if (r < pFocus) return pick(withFocus);
    if (r < pFocus + pOlder) return pick(older);
    return pseudoWord(allowed, focus, 2 + rand(3));
  });
}

// Digits for a number lesson: the new ones most of the time, earlier ones some of the time.
function numberText(lesson, idx) {
  const known = [];
  for (let i = 0; i <= idx; i++) if (LESSONS[i].type === 'numbers') known.push(...LESSONS[i].newKeys);
  const digits = lesson.newKeys;
  const parts = digits.map(d => d.repeat(3));
  for (let i = 0; i < 4; i++) parts.push(pick(digits) + pick(digits));
  const num = () => Array.from({ length: 1 + rand(4) }, () => (Math.random() < 0.7 ? pick(digits) : pick(known))).join('');
  let n = 0;
  return fillTo(parts, 190, () => (n++ % 2 === 0 ? num() : pick(WORDS))).join(' ');
}

function lessonText(lesson, idx) {
  switch (lesson.type) {
    case 'words': return randomWords(30);
    case 'caps': {
      const drills = shuffle(['f', 'j', 'd', 'k', 's', 'l', 'a', 'e', 'i', 't']).slice(0, 6).map(c => c.toUpperCase() + c);
      const words = randomWords(24).split(' ').map((w, i) => (i % 2 === 0 || Math.random() < 0.3 ? w[0].toUpperCase() + w.slice(1) : w));
      return [...drills, ...words].join(' ');
    }
    case 'sentences': return shuffle(SENTENCES).slice(0, 4).join(' ');
    case 'quotes': return shuffle(QUOTES).slice(0, 3).map(q => q.text).join(' ');
    case 'punct': {
      const words = randomWords(24).split(' ');
      return words.map((w, i) => {
        if (i === words.length - 1) return w + '.';
        const r = Math.random();
        return r < 0.22 ? w + ',' : r < 0.36 ? w + '.' : w;
      }).join(' ');
    }
    case 'shift': return [...lesson.newKeys.map(k => k.repeat(3)), ...shuffle(SHIFT_PHRASES).slice(0, 10)].join(' ');
    case 'marks': {
      const words = shuffle(MARK_WORDS).slice(0, 14);
      return [...lesson.newKeys.map(k => k.repeat(3)), ...shuffle([...words, ...randomWords(6).split(' ')])].join(' ');
    }
    case 'numbers': return numberText(lesson, idx);
    case 'finals': {
      // Each final next to its regular form, then word pairs and words with final letters.
      const drills = lesson.newKeys.map(f => `${MEDIAL[f]}${MEDIAL[f]} ${f}${f}`);
      const pairs = shuffle(FINAL_PAIRS).slice(0, 10);
      const words = shuffle(WORDS.filter(w => FINAL_SET.has(w[w.length - 1]))).slice(0, 10);
      return [...drills, ...shuffle([...pairs, ...words])].join(' ');
    }
    case 'prefixes': return shuffle(PREFIXED).slice(0, 26).join(' ');
    default: return letterLessonText(lesson, idx);
  }
}

// Text for a personalised lesson: short drills on the focus keys, then real words rich in them.
function focusText(keys, { words = [], length = 28 } = {}) {
  const letters = keys.filter(isLangLetter);
  const others = keys.filter(k => !isLangLetter(k) && k !== ' ');
  const parts = keyDrills(letters);
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

// ---------- Letter unlocking (the keybr approach) ----------
// Letters open one at a time, most common first. Every open letter keeps a moving average of
// its speed and accuracy, and the next letter opens only when all open letters reach the
// target. Each round concentrates on the open letter that is furthest from it.
const Adaptive = {
  START: 6,
  storeKey: () => 'adaptive.' + LANG,
  state() {
    const s = Store.get(this.storeKey(), null) || {};
    return { n: s.n || this.START, target: s.target || 25, keys: s.keys || {} };
  },
  save(s) { Store.set(this.storeKey(), s); },
  reset(target) { this.save({ n: this.START, target, keys: {} }); },
  open(s) { return ADAPTIVE_ORDER.slice(0, s.n); },
  targetMs(s) { return 60000 / (s.target * 5); },
  // 0 to 1: how close a letter is to the target speed, 95% accuracy and 15 presses.
  progress(s, ch) {
    const k = s.keys[ch];
    if (!k || k.ms == null) return 0;
    return Math.min(1, this.targetMs(s) / k.ms, k.acc / 0.95, k.n / 15);
  },
  // The open letter furthest from the target; the newest one when they are equal.
  focus(s) {
    const open = this.open(s);
    return open.reduce((best, ch) => (this.progress(s, ch) < this.progress(s, best) ? ch : best), open[open.length - 1]);
  },
  text(s) { return practiceWords(this.open(s), [this.focus(s)], 170).join(' '); },
  // Adds a finished round's key statistics to the averages and opens the next letter when
  // every open letter is ready. Returns the letter that opened, if any.
  update(s, charStats) {
    const a = 0.3;
    for (const [ch, [hits, misses, ms, timed]] of Object.entries(charStats)) {
      if (!ADAPTIVE_ORDER.includes(ch) || hits + misses === 0) continue;
      const k = s.keys[ch] || (s.keys[ch] = { ms: null, acc: 0, n: 0 });
      if (timed) k.ms = Math.round(k.ms == null ? ms / timed : k.ms * (1 - a) + (ms / timed) * a);
      const acc = hits / (hits + misses);
      k.acc = Math.round((k.n ? k.acc * (1 - a) + acc * a : acc) * 1000) / 1000;
      k.n += hits + misses;
    }
    let opened = null;
    if (s.n < ADAPTIVE_ORDER.length && this.open(s).every(ch => this.progress(s, ch) >= 1)) opened = ADAPTIVE_ORDER[s.n++];
    this.save(s);
    return opened;
  },
};
