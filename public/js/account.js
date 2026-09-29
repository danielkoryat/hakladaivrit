'use strict';

// ---------- Server API ----------
const Api = {
  async req(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'שגיאה בתקשורת עם השרת'), { status: res.status });
    return data;
  },
};

// ---------- Profile data (server when logged in, browser storage for guests) ----------
// keyStats: { char: [hits, misses, totalMs, timedCount] }
const emptyProfile = () => ({ keyStats: {}, wordErrors: {}, lessons: {}, pbs: {}, history: [], totals: { count: 0, secs: 0 } });

function loadLocalProfile() {
  let p = Store.get('profile', null);
  if (!p) {
    // Migrate data saved by the first version of the site.
    p = emptyProfile();
    Object.entries(Store.get('keyStats', {})).forEach(([c, v]) => { p.keyStats[c] = [v[0] || 0, v[1] || 0, v[2] || 0, v[3] || 0]; });
    p.lessons = Store.get('lessons', {});
    p.pbs = Store.get('pb', {});
  }
  return Object.assign(emptyProfile(), p);
}
const hasLocalProgress = p => p.history.length || Object.keys(p.keyStats).length || Object.keys(p.lessons).length;
const normWord = w => w.replace(/[.,?!:;"'\-]/g, '');

const Account = {
  online: false,
  user: null,
  config: { ads: null, adsPreview: false, contactEmail: '' },
  data: emptyProfile(),
  listeners: [],

  async init() {
    try {
      const [me, config] = await Promise.all([Api.req('GET', '/me'), Api.req('GET', '/config')]);
      this.online = true;
      this.user = me.user;
      this.config = config;
    } catch { this.online = false; }
    if (this.user) {
      try { this.data = await Api.req('GET', '/profile'); } catch { this.data = emptyProfile(); }
    } else {
      this.data = loadLocalProfile();
    }
    this.emit();
  },
  on(fn) { this.listeners.push(fn); },
  emit() { this.listeners.forEach(fn => fn()); },

  // Store a finished session. Updates the in-memory profile immediately, then persists.
  record(r) {
    const d = this.data;
    const entry = {
      at: Date.now(), kind: r.kind, mode: r.mode || '', label: r.label || '',
      wpm: Math.round(r.wpm * 10) / 10, acc: Math.round(r.acc * 10) / 10, cpm: Math.round(r.cpm), secs: Math.round(r.secs * 10) / 10,
      errors: r.errors, chars: r.chars, lessonId: r.lessonId ?? null, stars: r.stars ?? null,
    };
    const wpm = Math.round(r.wpm);
    const isPb = r.kind === 'test' && r.chars > 0 && wpm > (d.pbs[entry.mode] || 0);
    if (isPb) d.pbs[entry.mode] = wpm;

    Object.entries(r.keyStats || {}).forEach(([ch, v]) => {
      const cur = d.keyStats[ch] || [0, 0, 0, 0];
      d.keyStats[ch] = cur.map((x, i) => x + (v[i] || 0));
    });
    const missed = [...new Set((r.missedWords || []).map(normWord).filter(w => w.length >= 2 && !/\d/.test(w)))];
    const clean = [...new Set((r.cleanWords || []).map(normWord))].filter(w => d.wordErrors[w]);
    missed.forEach(w => { d.wordErrors[w] = (d.wordErrors[w] || 0) + 1; });
    clean.forEach(w => { if (--d.wordErrors[w] <= 0) delete d.wordErrors[w]; });

    if (r.kind === 'lesson' && r.stars) {
      const prev = d.lessons[r.lessonId] || { stars: 0, wpm: 0, acc: 0 };
      d.lessons[r.lessonId] = { stars: Math.max(prev.stars, r.stars), wpm: Math.max(prev.wpm, wpm), acc: Math.max(prev.acc, Math.round(r.acc)) };
    }
    d.history.push(entry);
    if (d.history.length > 500) d.history.splice(0, d.history.length - 500);
    d.totals.count++;
    d.totals.secs += entry.secs;
    Analytics.finish(r.kind, r.wpm, r.acc);

    if (this.user) {
      Api.req('POST', '/results', { ...entry, keyStats: r.keyStats, missedWords: missed, cleanWords: clean })
        .catch(() => toast('לא הצלחנו לשמור את התוצאה בשרת', true));
    } else {
      Store.set('profile', d);
    }
    return { isPb };
  },

  async googleAuth(credential) {
    const r = await Api.req('POST', '/auth/google', { credential });
    Analytics.event(r.created ? 'sign_up' : 'login', { method: 'google' });
    await this.signedIn(r.user);
  },

  // After any successful login: move guest progress into the account, then load the profile.
  async signedIn(user) {
    this.user = user;
    const local = loadLocalProfile();
    if (hasLocalProgress(local)) {
      this.data = await Api.req('POST', '/import', local);
      ['profile', 'keyStats', 'lessons', 'pb'].forEach(k => Store.remove(k));
      toast('ההתקדמות מהדפדפן נשמרה בחשבון שלך');
    } else {
      this.data = await Api.req('GET', '/profile');
    }
    this.emit();
  },

  async logout() {
    await Api.req('POST', '/logout', {});
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    this.user = null;
    this.data = loadLocalProfile();
    this.emit();
  },

  async resetStats() {
    this.data.keyStats = {};
    this.data.wordErrors = {};
    if (this.user) await Api.req('POST', '/stats/reset', {});
    else Store.set('profile', this.data);
  },
};

const displayName = u => (u.name || u.email.split('@')[0]).slice(0, 40);

// ---------- Sign in with Google (Google Identity Services) ----------
const GoogleSignIn = {
  ready: null,
  load(clientId, onCredential) {
    if (!clientId) return Promise.resolve(false);
    if (!this.ready) {
      this.ready = new Promise(resolve => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => {
          google.accounts.id.initialize({ client_id: clientId, callback: r => onCredential(r.credential), ux_mode: 'popup', context: 'signin' });
          resolve(true);
        };
        s.onerror = () => resolve(false);
        document.head.append(s);
      });
    }
    return this.ready;
  },
  render(el) {
    el.innerHTML = '';
    google.accounts.id.renderButton(el, {
      type: 'standard', size: 'large', shape: 'pill', text: 'continue_with', locale: 'he', width: 300,
      theme: document.documentElement.dataset.theme === 'light' ? 'outline' : 'filled_black',
    });
  },
};

// ---------- Site analytics (Google Analytics 4) ----------
// The site switches pages without reloading, so page views are sent manually.
// Not loaded for admins or when Global Privacy Control is on.
const Analytics = {
  id: null,
  first: true,
  init(id) {
    if (!id || this.id || navigator.globalPrivacyControl || (Account.user && Account.user.isAdmin)) return;
    this.id = id;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', id, { send_page_view: false });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.append(s);
  },
  event(name, params = {}) {
    if (this.id && !(Account.user && Account.user.isAdmin)) gtag('event', name, params);
  },
  page(path) {
    const params = { page_title: document.title, page_location: location.origin + path, page_path: path };
    if (this.first && document.referrer) params.page_referrer = document.referrer;
    this.first = false;
    this.event('page_view', params);
  },
  finish(kind, wpm, acc) {
    this.event('training_complete', { activity: kind, wpm: Math.round(wpm), accuracy: Math.round(acc) });
  },
};

// ---------- Ads (Google AdSense) ----------
// Views place <div class="ad-slot" data-ad="name"> markers; fill() turns them into ad units.
const Ads = {
  slot: name => `<div class="ad-slot" data-ad="${name}"></div>`,
  fill(root = document) {
    const { ads, adsPreview } = Account.config;
    $$('.ad-slot:not(.filled)', root).forEach(el => {
      el.classList.add('filled');
      const slotId = ads && ads.slots[el.dataset.ad];
      if (slotId) {
        el.innerHTML = '<div class="ad-label">פרסומת</div>';
        const ins = document.createElement('ins');
        ins.className = 'adsbygoogle';
        ins.style.display = 'block';
        Object.assign(ins.dataset, { adClient: ads.client, adSlot: slotId, adFormat: 'auto', fullWidthResponsive: 'true' });
        el.append(ins);
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* ad blocked */ }
      } else if (adsPreview) {
        el.innerHTML = `<div class="ad-label">פרסומת</div><div class="ad-preview">מקום לפרסומת · ${esc(el.dataset.ad)}</div>`;
      } else {
        el.remove();
      }
    });
  },
};

// ---------- Analysis ----------
function aggregate(keys) {
  const hits = keys.reduce((s, k) => s + k.hits, 0);
  const misses = keys.reduce((s, k) => s + k.misses, 0);
  const t = keys.reduce((s, k) => s + k.t, 0);
  const n = keys.reduce((s, k) => s + k.n, 0);
  return { total: hits + misses, acc: hits + misses ? hits / (hits + misses) : null, ms: n ? t / n : null };
}

function analyze(d) {
  const keys = Object.entries(d.keyStats)
    .filter(([ch]) => ch !== ' ' && REVERSE[ch])
    .map(([ch, [h, m, t, n]]) => ({ ch, hits: h, misses: m, t, n, total: h + m, acc: h / (h + m || 1), ms: n ? t / n : null }));
  const overall = aggregate(keys);
  const sampled = keys.filter(k => k.total >= 8);

  const weakKeys = sampled
    .filter(k => k.misses >= 2 && k.acc < Math.min(0.97, overall.acc ?? 1))
    .sort((a, b) => a.acc - b.acc).slice(0, 5);
  const slowKeys = overall.ms
    ? sampled.filter(k => k.n >= 6 && k.ms > overall.ms * 1.15).sort((a, b) => b.ms - a.ms).slice(0, 5)
    : [];
  const strongKeys = sampled
    .filter(k => k.acc >= (overall.acc ?? 0) && (!overall.ms || (k.ms && k.ms <= overall.ms)))
    .sort((a, b) => b.acc - a.acc || a.ms - b.ms).slice(0, 5);

  const fingers = LETTER_FINGERS.map(f => ({ f, name: FINGER_NAMES[f], ...aggregate(keys.filter(k => fingerOfChar(k.ch) === f)) }));
  const fingersSampled = fingers.filter(x => x.total >= 20);
  const byAcc = fingersSampled.slice().sort((a, b) => a.acc - b.acc);
  const weakestFinger = byAcc.length >= 2 && byAcc[0].acc < (overall.acc ?? 1) - 0.01 ? byAcc[0] : null;
  const strongestFinger = byAcc.length >= 2 ? byAcc[byAcc.length - 1] : null;

  const rows = [0, 1, 2, 3].map(r => ({ r, name: ROW_NAMES[r], ...aggregate(keys.filter(k => ROW_OF[k.ch] === r)) }));
  const rowsSampled = rows.filter(x => x.total >= 30).sort((a, b) => a.acc - b.acc);
  const weakestRow = rowsSampled.length >= 2 && rowsSampled[0].acc < (overall.acc ?? 1) - 0.01 ? rowsSampled[0] : null;

  const tests = d.history.filter(h => h.kind === 'test' && h.chars > 0);
  const avg = (arr, k) => arr.length ? arr.reduce((s, h) => s + h[k], 0) / arr.length : null;
  const recent = tests.slice(-10), prev = tests.slice(-20, -10);
  const trend = {
    count: tests.length,
    best: tests.reduce((m, h) => Math.max(m, h.wpm), 0),
    recentWpm: avg(recent, 'wpm'),
    prevWpm: prev.length >= 3 ? avg(prev, 'wpm') : null,
    recentAcc: avg(recent, 'acc'),
  };

  const problemWords = Object.entries(d.wordErrors).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);

  return {
    keys, overall, weakKeys, slowKeys, strongKeys, fingers, weakestFinger, strongestFinger,
    rows, weakestRow, trend, problemWords, enough: overall.total >= 150,
  };
}

// Personalised lessons built from the analysis.
function customLessons(a) {
  const base = a.trend.recentWpm ? Math.max(10, Math.round(a.trend.recentWpm * 0.8)) : 14;
  const list = ks => ks.map(k => k.ch).join(' ');
  const out = [];
  if (a.weakKeys.length) {
    out.push({ id: 'weak', title: 'המקשים החלשים שלך', keys: a.weakKeys.map(k => k.ch), target: base,
      desc: `תרגול ממוקד במקשים שבהם הדיוק שלך הכי נמוך: ${list(a.weakKeys)}. האטו מעט והקפידו על האצבע הנכונה.` });
  }
  if (a.slowKeys.length) {
    out.push({ id: 'slow', title: 'המקשים האיטיים שלך', keys: a.slowKeys.map(k => k.ch), target: base,
      desc: `במקשים ${list(a.slowKeys)} לוקח לך יותר זמן למצוא את המקום. חזרה עליהם תבנה זיכרון שריר.` });
  }
  if (a.weakestFinger) {
    const f = a.weakestFinger;
    out.push({ id: 'finger', title: `חיזוק ${f.name}`, keys: FINGER_CHARS[f.f].filter(c => isHebrew(c) || c === '.' || c === ','), target: base,
      desc: `ה${f.name} היא האצבע עם הדיוק הנמוך ביותר (${Math.round(f.acc * 100)}%). השיעור מתרגל רק את המקשים שלה.` });
  }
  if (a.weakestRow) {
    const r = a.weakestRow;
    const keys = Object.keys(ROW_OF).filter(c => ROW_OF[c] === r.r && (isHebrew(c) || /\d/.test(c)));
    out.push({ id: 'row', title: `חיזוק ${r.name}`, keys, target: base,
      desc: `${r.name} היא השורה עם הדיוק הנמוך ביותר אצלך (${Math.round(r.acc * 100)}%).` });
  }
  if (a.problemWords.length >= 3) {
    out.push({ id: 'words', title: 'המילים הבעייתיות שלך', keys: [], words: a.problemWords, target: base,
      desc: 'מילים שבהן טעית לאחרונה. כל פעם שתקלידו מילה בלי טעות, היא יורדת מהרשימה.' });
  }
  return out;
}

function customLessonText(l) {
  if (l.id === 'words') {
    const extra = weightedWords(10, [...new Set(l.words.join('').split(''))], 3);
    return shuffle([...l.words, ...l.words, ...l.words, ...extra]).join(' ');
  }
  return focusText(l.keys, { length: 26 });
}
