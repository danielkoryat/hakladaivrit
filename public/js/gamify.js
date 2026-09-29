'use strict';

// Gamification: XP, levels with animal ranks, daily streaks, a daily goal, badges,
// and the celebrations shown when they change. State lives in Account.data.game.

const RANKS = [
  [1, '🐣', 'אפרוח'], [3, '🐢', 'צב'], [5, '🐇', 'ארנב'], [8, '🦊', 'שועל'],
  [12, '🐆', 'צ׳יטה'], [16, '🦅', 'נשר'], [20, '🚀', 'טיל'], [30, '⚡', 'ברק'],
];

const localDay = (d = new Date()) => d.toLocaleDateString('en-CA');
const dayBefore = day => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() - 1); return localDay(d); };

const bestWpm = d => d.history.filter(h => h.kind === 'test' && h.chars >= 50).reduce((m, h) => Math.max(m, h.wpm), 0);
const lessonsDone = (d, from, to) => { for (let i = from; i <= to; i++) if (!(d.lessons[i] && d.lessons[i].stars)) return false; return true; };
const starsTotal = d => Object.values(d.lessons).reduce((s, l) => s + (l.stars || 0), 0);

// id, emoji, title, how to earn it, test
const BADGES = [
  ['first', '🎯', 'צעד ראשון', 'סיימו אימון ראשון', c => c.d.history.length + Object.keys(c.g.best).length > 0],
  ['first-test', '⏱️', 'מבחן ראשון', 'סיימו מבחן הקלדה', c => c.d.history.some(h => h.kind === 'test')],
  ['home-row', '🏠', 'שורת הבית', 'סיימו את שיעורים 1 עד 4', c => lessonsDone(c.d, 1, 4)],
  ['all-letters', '🔤', 'כל האותיות', 'סיימו את שיעורים 1 עד 12', c => lessonsDone(c.d, 1, 12)],
  ['graduate', '🎓', 'בוגרי הקורס', 'סיימו את כל 16 השיעורים', c => lessonsDone(c.d, 1, 16)],
  ['stars-24', '⭐', 'אספני כוכבים', 'אספו 24 כוכבים בשיעורים', c => starsTotal(c.d) >= 24],
  ['wpm-20', '🐢', '20 מילים לדקה', 'הגיעו ל־20 מילים לדקה במבחן', c => bestWpm(c.d) >= 20],
  ['wpm-40', '🐇', '40 מילים לדקה', 'הגיעו ל־40 מילים לדקה במבחן', c => bestWpm(c.d) >= 40],
  ['wpm-60', '🐆', '60 מילים לדקה', 'הגיעו ל־60 מילים לדקה במבחן', c => bestWpm(c.d) >= 60],
  ['wpm-80', '🚀', '80 מילים לדקה', 'הגיעו ל־80 מילים לדקה במבחן', c => bestWpm(c.d) >= 80],
  ['perfect', '💯', 'מושלם', 'מבחן של 20 מילים לפחות בלי אף טעות', c => c.d.history.some(h => h.kind === 'test' && h.chars >= 100 && h.errors === 0)],
  ['goal', '✅', 'יעד יומי', 'עמדו ביעד היומי', c => Object.values(c.g.days).some(x => x.xp >= Gamify.goal())],
  ['streak-3', '🔥', '3 ימים ברצף', 'התאמנו 3 ימים ברצף', c => c.streak >= 3],
  ['streak-7', '🌟', 'שבוע ברצף', 'התאמנו 7 ימים ברצף', c => c.streak >= 7],
  ['streak-30', '🏆', 'חודש ברצף', 'התאמנו 30 ימים ברצף', c => c.streak >= 30],
  ['balloons-300', '🎈', 'מפוצצי בלונים', 'הגיעו ל־300 נקודות במשחק הבלונים', c => Math.max(0, ...Object.values(c.g.best)) >= 300],
  ['balloons-1500', '🎊', 'אלופי הבלונים', 'הגיעו ל־1,500 נקודות במשחק הבלונים', c => Math.max(0, ...Object.values(c.g.best)) >= 1500],
  ['historian', '📜', 'חוקרי היסטוריה', 'הקלידו 5 טקסטים היסטוריים', c => Object.keys(c.g.texts).filter(k => k.startsWith('history')).length >= 5],
  ['reader', '📚', 'תולעי ספרים', 'הקלידו 10 טקסטים שונים מהספרייה', c => Object.keys(c.g.texts).filter(k => k !== 'mine').length >= 10],
  ['own-text', '📝', 'לומדים חכם', 'תרגלו על טקסט משלכם', c => 'mine' in c.g.texts],
  ['marathon', '🏃', 'מרתון', 'הקלידו 10,000 תווים נכונים', c => c.g.chars >= 10000],
];

const Gamify = {
  RANKS, BADGES,
  goal() { return Prefs.kids ? 60 : 100; },
  levelOf(xp) { return Math.floor(Math.sqrt(xp / 40)) + 1; },
  xpForLevel(level) { return 40 * (level - 1) ** 2; },
  rank(level) { let r = RANKS[0]; for (const x of RANKS) if (level >= x[0]) r = x; return { emoji: r[1], name: r[2] }; },

  // The game state object itself (filled in with defaults), so changes to it are kept.
  state(d) {
    if (!d.game || typeof d.game !== 'object') d.game = {};
    const g = d.game;
    for (const k of ['xp', 'chars', 'bestStreak']) if (typeof g[k] !== 'number') g[k] = 0;
    for (const k of ['days', 'badges', 'best', 'texts']) if (!g[k] || typeof g[k] !== 'object') g[k] = {};
    return g;
  },

  // Consecutive days with practice, ending today (or yesterday, until today's first practice).
  streak(g) {
    let day = localDay();
    if (!(g.days[day] && g.days[day].xp > 0)) day = dayBefore(day);
    let n = 0;
    while (g.days[day] && g.days[day].xp > 0) { n++; day = dayBefore(day); }
    return n;
  },

  summary(d) {
    const g = this.state(d);
    const level = this.levelOf(g.xp);
    const from = this.xpForLevel(level), to = this.xpForLevel(level + 1);
    const today = (g.days[localDay()] || { xp: 0 }).xp;
    return {
      xp: g.xp, level, rank: this.rank(level), streak: this.streak(g), bestStreak: g.bestStreak,
      levelProgress: (g.xp - from) / (to - from), toNext: to - g.xp,
      today, goal: this.goal(), goalProgress: Math.min(1, today / this.goal()),
    };
  },

  // XP for a finished activity.
  xpFor(r) {
    const correct = r.correct != null ? r.correct : Math.round((r.wpm * 5 * r.secs) / 60);
    switch (r.kind) {
      case 'test': return Math.round(correct / 8) + (r.acc >= 95 ? 10 : 0);
      case 'lesson': return 15 + (r.stars || 1) * 10;
      case 'custom': return 15 + Math.round(correct / 10);
      case 'text': return 10 + Math.round(correct / 6);
      case 'game': return Math.round(r.score / 15);
      default: return Math.round(correct / 8);
    }
  },

  // Applies a finished activity to the game state. Returns what changed, for celebrations.
  award(d, r) {
    const g = this.state(d);
    const before = this.summary(d);
    const xp = Math.max(1, this.xpFor(r));
    const day = localDay();
    g.xp += xp;
    g.days[day] = { xp: ((g.days[day] || {}).xp || 0) + xp, n: ((g.days[day] || {}).n || 0) + 1 };
    const keep = Object.keys(g.days).sort().slice(-120);
    Object.keys(g.days).forEach(k => { if (!keep.includes(k)) delete g.days[k]; });
    if (r.kind !== 'game') g.chars += Math.max(0, r.correct != null ? r.correct : Math.round((r.wpm * 5 * r.secs) / 60));
    if (r.kind === 'game') g.best[r.mode] = Math.max(g.best[r.mode] || 0, r.score);
    if (r.kind === 'text' && r.textId) g.texts[r.textId] = Math.max(g.texts[r.textId] || 0, Math.round(r.wpm));
    const streak = this.streak(g);
    g.bestStreak = Math.max(g.bestStreak || 0, streak);
    const ctx = { d, g, r, streak };
    const newBadges = BADGES.filter(([id, , , , test]) => !g.badges[id] && test(ctx)).map(b => { g.badges[b[0]] = Date.now(); return b; });
    const after = this.summary(d);
    return {
      xp, before, after, newBadges,
      levelUp: after.level > before.level,
      goalMet: before.today < before.goal && after.today >= after.goal,
    };
  },

  // Combines guest progress from this browser into an account's progress.
  merge(a = {}, b = {}) {
    const x = this.state({ game: a }), y = this.state({ game: b });
    const days = { ...x.days };
    Object.entries(y.days).forEach(([k, v]) => { days[k] = { xp: ((days[k] || {}).xp || 0) + v.xp, n: ((days[k] || {}).n || 0) + (v.n || 0) }; });
    const maxMap = (m1, m2) => { const o = { ...m1 }; Object.entries(m2).forEach(([k, v]) => { o[k] = Math.max(o[k] || 0, v); }); return o; };
    const badges = { ...y.badges, ...x.badges };
    return { xp: x.xp + y.xp, days, badges, best: maxMap(x.best, y.best), texts: maxMap(x.texts, y.texts), chars: x.chars + y.chars, bestStreak: Math.max(x.bestStreak, y.bestStreak) };
  },
};

// ---------- Celebrations ----------
const Celebrate = {
  // Small stacked notices in the corner: "+25 XP", new badges.
  notice(html, cls = '') {
    let box = $('#notices');
    if (!box) { box = document.createElement('div'); box.id = 'notices'; box.setAttribute('aria-live', 'polite'); document.body.append(box); }
    const el = document.createElement('div');
    el.className = 'notice ' + cls;
    el.innerHTML = html;
    box.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3600);
  },

  confetti(ms = 1800) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.createElement('canvas');
    c.className = 'confetti';
    document.body.append(c);
    const ctx = c.getContext('2d');
    const W = c.width = innerWidth, H = c.height = innerHeight;
    const colors = ['#9d85ff', '#ffc94a', '#ff6b86', '#44d98e', '#5fc9e6', '#f28cb8'];
    const parts = Array.from({ length: 140 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
      s: 5 + Math.random() * 6, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, c: colors[(Math.random() * colors.length) | 0],
    }));
    const t0 = performance.now();
    const frame = now => {
      ctx.clearRect(0, 0, W, H);
      parts.forEach(p => {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      });
      if (now - t0 < ms) requestAnimationFrame(frame); else c.remove();
    };
    requestAnimationFrame(frame);
  },

  // Everything to show after an activity.
  show(reward) {
    if (!reward) return;
    const kids = Prefs.kids;
    this.notice(`<b class="num">+${reward.xp}</b> XP${kids ? ' 🎉' : ''}`, 'xp');
    reward.newBadges.forEach(([, emoji, title, how]) => this.notice(`<span class="n-emoji">${emoji}</span><span><b>תג חדש: ${esc(title)}</b><br>${esc(how)}</span>`, 'badge'));
    if (reward.goalMet) this.notice('<span class="n-emoji">✅</span><span><b>עמדתם ביעד היומי!</b><br>נתראה מחר כדי לשמור על הרצף 🔥</span>', 'badge');
    if (reward.levelUp) {
      const { level, rank } = reward.after;
      this.notice(`<span class="n-emoji">${rank.emoji}</span><span><b>עליתם לרמה ${level}!</b><br>הדרגה שלכם: ${esc(rank.name)}</span>`, 'level');
    }
    if (reward.levelUp || reward.newBadges.length || reward.goalMet) this.confetti();
    Account.emit();
  },
};
