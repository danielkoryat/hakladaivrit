'use strict';

// Shared pieces used by every page: the page context the router fills in, page texts,
// preferences, icons, small HTML helpers and the typing engine.

// Filled in by the router (app.js). token changes on every page change, so async work can
// check it is still on the page that started it.
const Page = { token: 0, onKey: null, onLeave: null, navigate: null };

const view = $('#view');

// Page texts live in public/content/*.html. The server already puts the current page's text
// into the HTML (for search engines and AI crawlers); reuse it instead of fetching it again.
const contentCache = new Map();
if (view.dataset.ssr) contentCache.set(view.dataset.ssr, Promise.resolve(view.innerHTML));
function content(name) {
  if (!contentCache.has(name)) {
    contentCache.set(name, fetch(`/content/${name}.html`).then(r => (r.ok ? r.text() : '')).catch(() => ''));
  }
  return contentCache.get(name);
}
// Fills the #page-info box at the bottom of a page with its explanation text.
function fillInfo(name) {
  const token = Page.token;
  content(name).then(html => { const el = $('#page-info'); if (token === Page.token && el) el.innerHTML = html; });
}
const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;

const Prefs = {
  get hands() { return Store.get('hands', true); },
  set hands(v) { Store.set('hands', !!v); },
  // Blind mode hides the on-screen keyboard in lessons, so the help fades out.
  get blind() { return Store.get('blind', false); },
  set blind(v) { Store.set('blind', !!v); },
  // Eye stars: signals over the text that reward keeping the eyes on the screen.
  get eyeStars() { return Store.get('eyeStars', true); },
  set eyeStars(v) { Store.set('eyeStars', !!v); },
};

const ICON = {
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a4 4 0 0 1-4 4M7 5H4v2a4 4 0 0 0 4 4"/></svg>',
  balloon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16c3.9 0 6-3.4 6-7a6 6 0 0 0-12 0c0 3.6 2.1 7 6 7z"/><path d="M12 16l-1 2h2zM12 18c0 2-2 2-2 4"/></svg>',
  scroll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h11a2 2 0 0 0 2-2v-1H10v1a2 2 0 0 1-4 0V5a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2h4"/><path d="M18 3H6M18 3a2 2 0 0 1 2 2v13M10 8h6M10 12h6"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3.5 4.5 5.2 4.5 9.5A4.5 4.5 0 0 1 12 16a4.5 4.5 0 0 1-4.5-4.5c0-1.6.6-2.8 1.5-3.8C9.3 10 10.3 11 11 11c0-3 1-6 1-9z"/><path d="M6 14.5a6 6 0 0 0 12 0c0 4.1-2.7 7.5-6 7.5s-6-3.4-6-7.5z" opacity=".55"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A10 10 0 0 1 12 4c5 0 9 4.5 10 8a13 13 0 0 1-2.2 3.7M6.6 6.6C4.4 8 2.8 10.1 2 12c1 3.5 5 8 10 8a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></svg>',
};
const starsHtml = (n, cls = '') =>
  `<span class="stars ${cls}" aria-label="${n} כוכבים">${[1, 2, 3].map(i => `<span class="${i <= n ? 'on' : ''}">${ICON.star}</span>`).join('')}</span>`;
const touchNote = () => isTouch ? '<p class="touch-note">האתר מיועד להקלדה במקלדת פיזית. חברו מקלדת כדי לתרגל.</p>' : '';
const statBox = (label, value, big) => `<div class="stat${big ? ' big' : ''}"><div class="label">${label}</div><div class="value">${value}</div></div>`;
const KIND_NAMES = { test: 'מבחן', lesson: 'שיעור', practice: 'תרגול', custom: 'שיעור אישי', text: 'טקסט' };

function missedHtml(charStats) {
  const missed = Object.entries(charStats).filter(([, s]) => s[1] > 0).sort((a, b) => b[1][1] - a[1][1]).slice(0, 8);
  if (!missed.length) return `<div class="missed"><div class="missed-title">אף טעות, כל הכבוד!</div></div>`;
  return `<div class="missed"><div class="missed-title">מקשים שבהם טעיתם</div><div class="chips">${
    missed.map(([ch, s]) => `<span class="chip">${ch === ' ' ? 'רווח' : esc(ch)} <span class="num">×${s[1]}</span></span>`).join('')
  }</div></div>`;
}

// ---------- Typing engine ----------
class Typer {
  constructor(opts) {
    this.o = opts;
    this.el = opts.el;
    this.strict = !!opts.strict;
    this.timeLimit = opts.timeLimit || 0;
    onResizeWhile(this.el, () => this.updateCaret());
    this.reset(opts.text);
  }

  reset(text) {
    clearInterval(this.timer);
    Object.assign(this, {
      pos: 0, typed: [], keystrokes: 0, correctKeys: 0, errors: 0, lastKey: null,
      startTime: null, endTime: null, finished: false, charStats: {}, errPositions: new Set(),
    });
    this.el.classList.add('idle');
    this.render(text);
    this.o.onUpdate && this.o.onUpdate(this);
  }

  render(text) {
    this.el.innerHTML = '';
    this.wordsEl = document.createElement('div');
    this.wordsEl.className = 'words';
    this.caret = document.createElement('div');
    this.caret.className = 'caret';
    this.wordsEl.append(this.caret);
    this.el.append(this.wordsEl);
    Object.assign(this, { chars: [], spans: [], ltr: [], ranges: [], lastWord: null, lastInRun: false, lastRtl: null, run: null });
    // The box runs right to left for Hebrew text and left to right for English.
    const letters = text.match(/[א-תA-Za-z]/g) || [];
    const heb = letters.filter(isHebrew).length;
    this.rtl = letters.length ? heb * 2 >= letters.length : LANG !== 'en';
    this.el.dir = this.rtl ? 'rtl' : 'ltr';
    this.addWords(text.trim().split(/\s+/));
    requestAnimationFrame(() => this.updateCaret());
  }

  letter(ch, parent, ltr) {
    const s = document.createElement('span');
    s.className = ch === ' ' ? 'l sp' : 'l';
    s.textContent = ch;
    parent.append(s);
    this.chars.push(ch);
    this.spans.push(s);
    this.ltr.push(ltr);
  }

  // Words in the other direction (English or numbers in Hebrew text, Hebrew in English text)
  // are grouped into one run, so a phrase keeps its own reading order and still wraps.
  addWords(words) {
    const frag = document.createDocumentFragment();
    words.forEach(w => {
      const rtl = /[א-ת]/.test(w) && !/\d/.test(w) ? true : /[A-Za-z\d]/.test(w) ? false : this.lastRtl ?? this.rtl;
      const inRun = rtl !== this.rtl;
      const wordEl = document.createElement('div');
      wordEl.className = 'word';
      // The space between two words takes the direction they share, otherwise the box's own,
      // so it sits between a run and the word after it.
      if (this.lastWord) {
        if (this.lastInRun && !inRun) this.letter(' ', wordEl, !this.rtl);
        else this.letter(' ', this.lastWord, this.lastInRun ? !rtl : !this.rtl);
      }
      if (inRun) {
        if (!this.lastInRun) {
          this.run = document.createElement('div');
          this.run.className = rtl ? 'rtl-run' : 'ltr-run';
          frag.append(this.run);
        }
        this.run.append(wordEl);
      } else {
        frag.append(wordEl);
      }
      const start = this.chars.length;
      for (const c of w) this.letter(c, wordEl, !rtl);
      this.ranges.push([start, this.chars.length]);
      Object.assign(this, { lastWord: wordEl, lastInRun: inRun, lastRtl: rtl });
    });
    this.wordsEl.append(frag);
  }

  get wordCount() { return this.ranges.length; }
  wordsDone() { return this.ranges.filter(([, end]) => end <= this.pos).length; }
  nextChar() { return this.finished ? null : this.chars[this.pos]; }

  wordsWhere(hasError) {
    const text = this.chars.join('');
    return this.ranges
      .filter(([s, e]) => {
        if (e > this.pos) return false;
        for (let i = s; i < e; i++) if (this.errPositions.has(i)) return hasError;
        return !hasError;
      })
      .map(([s, e]) => text.slice(s, e));
  }
  errorWords() { return this.wordsWhere(true); }
  cleanWords() { return this.wordsWhere(false); }

  start() {
    this.startTime = performance.now();
    this.el.classList.remove('idle');
    this.timer = setInterval(() => {
      if (this.timeLimit && (performance.now() - this.startTime) / 1000 >= this.timeLimit) this.finish(true);
      else this.o.onTick && this.o.onTick(this);
    }, 200);
  }

  finish(timedOut) {
    if (this.finished) return;
    this.finished = true;
    clearInterval(this.timer);
    this.endTime = timedOut ? this.startTime + this.timeLimit * 1000 : performance.now();
    this.o.onFinish && this.o.onFinish(this.stats(), this);
  }

  stats() {
    const end = this.endTime || performance.now();
    const secs = this.startTime ? Math.max((end - this.startTime) / 1000, 0.5) : 0;
    let correct = 0;
    if (this.strict) correct = this.pos;
    else for (let i = 0; i < this.pos; i++) if (this.typed[i] === this.chars[i]) correct++;
    const mins = secs / 60;
    return {
      secs,
      correct,
      chars: this.pos,
      incorrect: this.strict ? this.errors : this.pos - correct,
      errors: this.errors,
      wpm: secs ? correct / 5 / mins : 0,
      cpm: secs ? correct / mins : 0,
      acc: this.keystrokes ? (this.correctKeys / this.keystrokes) * 100 : 100,
      charStats: this.charStats,
    };
  }

  // Everything the profile needs from a finished session.
  report(extra) {
    const s = this.stats();
    return {
      ...extra, wpm: s.wpm, acc: s.acc, cpm: s.cpm, secs: s.secs, errors: s.errors, chars: s.chars, correct: s.correct,
      keyStats: this.charStats, missedWords: this.errorWords(), cleanWords: this.cleanWords(),
    };
  }

  handleKey(e) {
    if (this.finished) return false;
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (this.strict || this.pos === 0) return true;
      let target = this.pos - 1;
      if (e.ctrlKey) while (target > 0 && this.chars[target - 1] !== ' ') target--;
      for (let i = this.pos - 1; i >= target; i--) this.spans[i].classList.remove('correct', 'incorrect');
      this.typed.length = target;
      this.pos = target;
      this.updateCaret();
      this.o.onUpdate && this.o.onUpdate(this);
      return true;
    }
    const want = this.chars[this.pos];
    // The right key counts whichever keyboard language the computer is set to.
    const ch = want && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === want || isKeyFor(e, want)) ? want : resolveChar(e);
    if (!ch) return false;
    e.preventDefault();
    if (!this.startTime) this.start();

    const now = performance.now();
    const expected = this.chars[this.pos];
    const ok = ch === expected;
    const st = this.charStats[expected] || (this.charStats[expected] = [0, 0, 0, 0]);
    this.keystrokes++;
    if (ok) {
      this.correctKeys++;
      st[0]++;
      // Time to find the key, ignoring long pauses.
      if (this.lastKey != null && now - this.lastKey < 3000) { st[2] += Math.round(now - this.lastKey); st[3]++; }
    } else {
      this.errors++;
      st[1]++;
      this.errPositions.add(this.pos);
    }
    this.lastKey = now;
    this.o.onPress && this.o.onPress(e.code, ok);

    const span = this.spans[this.pos];
    if (this.strict) {
      if (ok) {
        span.classList.add(span.classList.contains('miss') ? 'corrected' : 'correct');
        this.pos++;
      } else {
        span.classList.add('miss');
        this.el.classList.remove('shake');
        void this.el.offsetWidth;
        this.el.classList.add('shake');
      }
    } else {
      this.typed[this.pos] = ch;
      span.classList.add(ok ? 'correct' : 'incorrect');
      this.pos++;
    }

    if (this.o.more && this.chars.length - this.pos < 80) this.addWords(this.o.more().split(' '));
    this.updateCaret();
    this.o.onUpdate && this.o.onUpdate(this);
    if (this.pos >= this.chars.length) this.finish(false);
    return true;
  }

  updateCaret() {
    if (!this.spans.length) return;
    const s = this.spans[this.pos];
    let x, y;
    if (s) {
      x = this.ltr[this.pos] ? s.offsetLeft : s.offsetLeft + s.offsetWidth;
      y = s.offsetTop;
    } else {
      const last = this.spans[this.spans.length - 1];
      x = this.ltr[this.spans.length - 1] ? last.offsetLeft + last.offsetWidth : last.offsetLeft;
      y = last.offsetTop;
    }
    this.caret.style.transform = `translate(${x - 1}px, ${y}px)`;
    const firstWord = this.wordsEl.querySelector('.word');
    const lineStep = firstWord ? firstWord.offsetHeight : 0;
    if (lineStep) {
      const line = Math.floor((y + 2) / lineStep);
      this.wordsEl.style.transform = `translateY(${-Math.max(0, line - 1) * lineStep}px)`;
    }
  }

  destroy() { clearInterval(this.timer); }
}

// ---------- Shared typing page pieces ----------
function handsButton(onToggle) {
  const b = document.createElement('button');
  b.className = 'cfg-btn' + (Prefs.hands ? ' active' : '');
  b.innerHTML = `${ICON.hand}<span>ידיים</span>`;
  b.title = 'הצגת ידיים וירטואליות על המקלדת';
  b.onclick = () => { Prefs.hands = !Prefs.hands; b.classList.toggle('active', Prefs.hands); onToggle(); };
  return b;
}

// Blind mode: no on-screen keyboard, and the finger hint only appears after a hesitation.
function blindButton(onToggle) {
  const b = document.createElement('button');
  b.className = 'cfg-btn' + (Prefs.blind ? ' active' : '');
  b.innerHTML = `${ICON.eyeOff}<span>מצב עיוור</span>`;
  b.title = 'הסתרת המקלדת שעל המסך. הרמז מופיע רק אם מתעכבים.';
  b.onclick = () => { Prefs.blind = !Prefs.blind; b.classList.toggle('active', Prefs.blind); onToggle(); };
  return b;
}

function eyeStarsButton(onToggle) {
  const b = document.createElement('button');
  b.className = 'cfg-btn' + (Prefs.eyeStars ? ' active' : '');
  b.innerHTML = `${ICON.star}<span>כוכבי עיניים</span>`;
  b.title = 'מדי פעם מופיע כוכב מעל הטקסט. לחיצה על Enter בזמן שהוא מופיע נותנת נקודות.';
  b.onclick = () => { Prefs.eyeStars = !Prefs.eyeStars; b.classList.toggle('active', Prefs.eyeStars); onToggle(); };
  return b;
}

