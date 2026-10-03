'use strict';

// Gamification: XP, levels with animal ranks, daily streaks, a daily goal, badges,
// and the celebrations shown when they change. State lives in Account.data.game.

const RANKS = [
  [1, '🐣', tr('אפרוח', 'Chick')], [3, '🐢', tr('צב', 'Turtle')], [5, '🐇', tr('ארנב', 'Rabbit')], [8, '🦊', tr('שועל', 'Fox')],
  [12, '🐆', tr('צ׳יטה', 'Cheetah')], [16, '🦅', tr('נשר', 'Eagle')], [20, '🚀', tr('טיל', 'Rocket')], [30, '⚡', tr('ברק', 'Lightning')],
];

const localDay = (d = new Date()) => d.toLocaleDateString('en-CA');
const dayBefore = day => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() - 1); return localDay(d); };

const bestWpm = d => d.history.filter(h => h.kind === 'test' && h.chars >= 50).reduce((m, h) => Math.max(m, h.wpm), 0);
// Course badges count in either language: the first n lessons of the Hebrew or the English course.
const courseDone = (d, upTo) => Object.values(COURSES).some(list => {
  const end = typeof upTo === 'number' ? upTo : upTo === 'letters' ? list.findIndex(l => l.milestone === 'letters') + 1 : list.length;
  return list.slice(0, end).every(l => lessonProg(d, l)?.stars);
});
const starsTotal = d => Object.values(d.lessons).reduce((s, l) => s + (l.stars || 0), 0);

// id, emoji, title, how to earn it, test
const BADGES = [
  ['first', '🎯', tr('צעד ראשון', 'First step'), tr('סיימו אימון ראשון', 'Complete your first practice'), c => c.d.history.length + Object.keys(c.g.best).length > 0],
  ['first-test', '⏱️', tr('מבחן ראשון', 'First test'), tr('סיימו מבחן הקלדה', 'Complete a typing test'), c => c.d.history.some(h => h.kind === 'test')],
  ['home-row', '🏠', tr('שורת הבית', 'Home row'), tr('סיימו את ארבעת שיעורי שורת הבית', 'Complete all four home row lessons'), c => courseDone(c.d, 4)],
  ['all-letters', '🔤', tr('כל האותיות', 'All letters'), tr('סיימו את כל שיעורי האותיות, עד החזרה על כל האותיות', 'Complete all letter lessons through the full review'), c => courseDone(c.d, 'letters')],
  ['graduate', '🎓', tr('בוגרי הקורס', 'Course graduate'), tr('סיימו את כל שיעורי הקורס', 'Complete all course lessons'), c => courseDone(c.d)],
  ['stars-24', '⭐', tr('אספני כוכבים', 'Star collector'), tr('אספו 24 כוכבים בשיעורים', 'Earn 24 stars in lessons'), c => starsTotal(c.d) >= 24],
  ['wpm-20', '🐢', tr('20 מילים לדקה', '20 WPM'), tr('הגיעו ל־20 מילים לדקה במבחן', 'Reach 20 words per minute on a test'), c => bestWpm(c.d) >= 20],
  ['wpm-40', '🐇', tr('40 מילים לדקה', '40 WPM'), tr('הגיעו ל־40 מילים לדקה במבחן', 'Reach 40 words per minute on a test'), c => bestWpm(c.d) >= 40],
  ['wpm-60', '🐆', tr('60 מילים לדקה', '60 WPM'), tr('הגיעו ל־60 מילים לדקה במבחן', 'Reach 60 words per minute on a test'), c => bestWpm(c.d) >= 60],
  ['wpm-80', '🚀', tr('80 מילים לדקה', '80 WPM'), tr('הגיעו ל־80 מילים לדקה במבחן', 'Reach 80 words per minute on a test'), c => bestWpm(c.d) >= 80],
  ['perfect', '💯', tr('מושלם', 'Perfect'), tr('מבחן של 20 מילים לפחות בלי אף טעות', 'A test of at least 20 words with zero errors'), c => c.d.history.some(h => h.kind === 'test' && h.chars >= 100 && h.errors === 0)],
  ['goal', '✅', tr('יעד יומי', 'Daily goal'), tr('עמדו ביעד היומי', 'Meet the daily goal'), c => Object.values(c.g.days).some(x => x.xp >= Gamify.goal())],
  ['streak-3', '🔥', tr('3 ימים ברצף', '3-day streak'), tr('התאמנו 3 ימים ברצף', 'Practice 3 days in a row'), c => c.streak >= 3],
  ['streak-7', '🌟', tr('שבוע ברצף', 'Week-long streak'), tr('התאמנו 7 ימים ברצף', 'Practice 7 days in a row'), c => c.streak >= 7],
  ['streak-30', '🏆', tr('חודש ברצף', 'Month-long streak'), tr('התאמנו 30 ימים ברצף', 'Practice 30 days in a row'), c => c.streak >= 30],
  ['balloons-300', '🎈', tr('מפוצצי בלונים', 'Balloon popper'), tr('הגיעו ל־300 נקודות במשחק הבלונים', 'Reach 300 points in the balloon game'), c => Math.max(0, ...Object.values(c.g.best)) >= 300],
  ['balloons-1500', '🎊', tr('אלופי הבלונים', 'Balloon champion'), tr('הגיעו ל־1,500 נקודות במשחק הבלונים', 'Reach 1,500 points in the balloon game'), c => Math.max(0, ...Object.values(c.g.best)) >= 1500],
  ['historian', '📜', tr('חוקרי היסטוריה', 'Historian'), tr('הקלידו 5 טקסטים היסטוריים', 'Type 5 history texts'), c => Object.keys(c.g.texts).filter(k => k.startsWith('history')).length >= 5],
  ['reader', '📚', tr('תולעי ספרים', 'Bookworm'), tr('הקלידו 10 טקסטים שונים מהספרייה', 'Type 10 different texts from the library'), c => Object.keys(c.g.texts).filter(k => k !== 'mine').length >= 10],
  ['own-text', '📝', tr('לומדים חכם', 'Smart learner'), tr('תרגלו על טקסט משלכם', 'Practice on your own text'), c => 'mine' in c.g.texts],
  ['marathon', '🏃', tr('מרתון', 'Marathon'), tr('הקלידו 10,000 תווים נכונים', 'Type 10,000 correct characters'), c => c.g.chars >= 10000],
];

const Gamify = {
  RANKS, BADGES,
  goal() { return 100; },
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
      case 'lesson': return 15 + (r.stars || 1) * 10 + (r.eyes || 0) * 3;
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
    this.notice(`<b class="num">+${reward.xp}</b> XP`, 'xp');
    reward.newBadges.forEach(([, emoji, title, how]) => this.notice(`<span class="n-emoji">${emoji}</span><span><b>${tr('תג חדש', 'New badge')}: ${esc(title)}</b><br>${esc(how)}</span>`, 'badge'));
    if (reward.goalMet) this.notice(`<span class="n-emoji">✅</span><span><b>${tr('עמדתם ביעד היומי!', 'You met the daily goal!')}</b><br>${tr('נתראה מחר כדי לשמור על הרצף 🔥', 'See you tomorrow to keep the streak 🔥')}</span>`, 'badge');
    if (reward.levelUp) {
      const { level, rank } = reward.after;
      this.notice(`<span class="n-emoji">${rank.emoji}</span><span><b>${tr(`עליתם לרמה ${level}!`, `You reached level ${level}!`)}</b><br>${tr('הדרגה שלכם', 'Your rank')}: ${esc(rank.name)}</span>`, 'level');
    }
    if (reward.levelUp || reward.newBadges.length || reward.goalMet) this.confetti();
    Account.emit();
  },
};
