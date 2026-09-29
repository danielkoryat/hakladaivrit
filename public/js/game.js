'use strict';

// Balloon game: balloons with letters (or short words) float up; type them to pop them
// before they escape. Made for kids, fun for everyone.

const GAME_MODES = {
  home: { name: 'שורת הבית', desc: 'רק האותיות ש ד ג כ ח ל ך ף', emoji: '🏠', letters: ['ש', 'ד', 'ג', 'כ', 'ח', 'ל', 'ך', 'ף'] },
  letters: { name: 'כל האותיות', desc: 'כל אותיות האלפבית, כולל סופיות', emoji: '🔤' },
  words: { name: 'מילים', desc: 'מילים קצרות, אות אחרי אות', emoji: '📝' },
};
const ALL_LETTERS = [...'אבגדהוזחטיכלמנסעפצקרשתךםןףץ'];
const SHORT_WORDS = WORDS.filter(w => [...w].length >= 2 && [...w].length <= 4 && /^[א-ת]+$/.test(w));

const Sound = {
  get on() { return Store.get('sound', true); },
  set on(v) { Store.set('sound', !!v); },
  ctx: null,
  play(kind) {
    if (!this.on) return;
    try {
      this.ctx = this.ctx || new AudioContext();
      const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      const f = { pop: [880, 1320], miss: [220, 160], lose: [330, 110], level: [660, 990] }[kind] || [440, 440];
      o.type = kind === 'miss' || kind === 'lose' ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(f[0], t);
      o.frequency.exponentialRampToValueAtTime(f[1], t + 0.12);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'level' ? 0.35 : 0.16));
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + 0.4);
    } catch { /* no audio */ }
  },
};

function viewGame() {
  document.title = 'משחק הקלדה לילדים: פוצצו את הבלונים | הקלדה עיוורת';
  const challenge = Share.challenge('נקודות במשחק הבלונים');
  let mode = Store.get('gameMode', 'home');
  const best = () => Gamify.state(Account.data).best[mode] || 0;

  view.innerHTML = `
    <section class="page game-page">
      <div class="page-head game-head">
        <div>
          <h1>🎈 משחק הבלונים</h1>
          <p>הקלידו את האות שעל הבלון כדי לפוצץ אותו לפני שהוא עף. כל 10 בלונים המשחק נהיה מהיר יותר!</p>
        </div>
        <button class="icon-btn sound-btn" id="sound" title="צלילים"></button>
      </div>
      ${challenge ? challenge.html : ''}
      <div class="config game-modes" id="modes"></div>
      <div class="game-hud" id="hud"></div>
      <div class="game-area" id="area" dir="ltr">
        <div class="clouds" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="game-overlay" id="overlay"></div>
      </div>
      <div class="kb-wrap" id="kbw"></div>
      ${touchNote()}
      <div id="page-info"></div>
    </section>`;
  fillInfo('game');

  const area = $('#area'), overlay = $('#overlay');
  let kb = null;
  let st = null;          // current round
  let raf = 0;

  const renderSound = () => { $('#sound').textContent = Sound.on ? '🔊' : '🔇'; };
  renderSound();
  $('#sound').onclick = () => { Sound.on = !Sound.on; renderSound(); };

  function renderModes() {
    $('#modes').innerHTML = Object.entries(GAME_MODES).map(([k, m]) =>
      `<button class="cfg-btn${k === mode ? ' active' : ''}" data-mode="${k}">${m.emoji} ${m.name}</button>`).join('');
  }
  $('#modes').addEventListener('click', e => {
    const b = e.target.closest('button[data-mode]');
    if (!b || (st && st.running)) return;
    mode = b.dataset.mode;
    Store.set('gameMode', mode);
    renderModes();
    showStart();
  });

  function buildKeyboard() {
    kb = Keyboard($('#kbw'), { colored: true, hands: Prefs.hands });
  }

  function hud() {
    const s = st || { score: 0, hearts: 3, level: 1, combo: 0 };
    const mult = Math.min(5, 1 + Math.floor(s.combo / 5));
    $('#hud').innerHTML = `
      <span class="hud-item">נקודות <b class="num">${s.score}</b></span>
      <span class="hud-item">רמה <b class="num">${s.level}</b></span>
      <span class="hud-item">${mult > 1 ? `קומבו <b class="num">×${mult}</b>` : `שיא <b class="num">${best()}</b>`}</span>
      <span class="hud-item hearts" aria-label="${s.hearts} לבבות">${'❤️'.repeat(s.hearts)}${'🤍'.repeat(Math.max(0, 3 - s.hearts))}</span>`;
  }

  function showStart() {
    stop();
    area.querySelectorAll('.balloon, .pop').forEach(b => b.remove());
    const m = GAME_MODES[mode];
    overlay.hidden = false;
    overlay.innerHTML = `
      <div class="overlay-card">
        <div class="big-emoji">${m.emoji}</div>
        <h2>${m.name}</h2>
        <p>${m.desc}</p>
        <button class="btn primary big-btn" id="start">להתחיל! (רווח)</button>
        <p class="muted small">Esc לעצירה</p>
      </div>`;
    $('#start').onclick = start;
    st = null;
    hud();
    if (kb) kb.highlight(null);
  }

  function pool() {
    if (mode === 'words') return SHORT_WORDS;
    if (mode === 'letters') return ALL_LETTERS;
    return st && st.level >= 3 ? [...GAME_MODES.home.letters, 'ע', 'י'] : GAME_MODES.home.letters;
  }

  function start() {
    overlay.hidden = true;
    area.querySelectorAll('.balloon, .pop').forEach(b => b.remove());
    st = { running: true, score: 0, hearts: 3, level: 1, combo: 0, pops: 0, keys: 0, good: 0, balloons: [], lock: null, spawnIn: 300, last: performance.now() };
    hud();
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (st) st.running = false;
    cancelAnimationFrame(raf);
  }

  function spawn() {
    const W = area.clientWidth, H = area.clientHeight;
    const list = pool();
    let label;
    do { label = pick(list); } while (st.balloons.some(b => b.label === label) && list.length > st.balloons.length + 1);
    const el = document.createElement('div');
    el.className = 'balloon' + (mode === 'words' ? ' wordy' : '');
    el.style.setProperty('--hue', String(rand(360)));
    el.innerHTML = `<span class="b-label" dir="rtl">${mode === 'words' ? [...label].map(c => `<i>${esc(c)}</i>`).join('') : esc(label)}</span>`;
    area.append(el);
    const bw = el.offsetWidth || 80;
    const b = { el, label, chars: [...label], typed: 0, x: 10 + Math.random() * Math.max(10, W - bw - 20), y: H + 10, w: bw, sway: Math.random() * Math.PI * 2 };
    st.balloons.push(b);
    place(b);
  }

  function place(b) {
    b.el.style.transform = `translate(${(b.x + Math.sin(b.sway) * 8).toFixed(1)}px, ${b.y.toFixed(1)}px)`;
  }

  function nextTarget() {
    if (!st || !st.balloons.length) return null;
    if (st.lock) return st.lock.chars[st.lock.typed];
    const top = st.balloons.reduce((a, b) => (b.y < a.y ? b : a));
    return top.chars[0];
  }

  function tick(now) {
    if (!st || !st.running) return;
    const dt = Math.min(0.05, (now - st.last) / 1000);
    st.last = now;
    const speed = (mode === 'words' ? 26 + st.level * 5 : 38 + st.level * 7) * (Prefs.kids ? 0.85 : 1);
    st.spawnIn -= dt * 1000;
    const maxAlive = mode === 'words' ? 3 + Math.floor(st.level / 3) : 4 + Math.floor(st.level / 2);
    if (st.spawnIn <= 0 && st.balloons.length < maxAlive) {
      spawn();
      st.spawnIn = Math.max(mode === 'words' ? 1400 : 600, (mode === 'words' ? 2600 : 1600) - (st.level - 1) * 130);
    }
    for (const b of [...st.balloons]) {
      b.y -= speed * dt;
      b.sway += dt * 2;
      place(b);
      if (b.y < -b.el.offsetHeight) escaped(b);
    }
    if (kb) kb.highlight(nextTarget());
    if (st.running) raf = requestAnimationFrame(tick);
  }

  function removeBalloon(b) {
    st.balloons = st.balloons.filter(x => x !== b);
    if (st.lock === b) st.lock = null;
  }

  function escaped(b) {
    removeBalloon(b);
    b.el.remove();
    st.hearts--;
    st.combo = 0;
    Sound.play('lose');
    area.classList.remove('hurt');
    void area.offsetWidth;
    area.classList.add('hurt');
    hud();
    if (st.hearts <= 0) gameOver();
  }

  function pop(b) {
    removeBalloon(b);
    const mult = Math.min(5, 1 + Math.floor(st.combo / 5));
    const gain = 10 * b.chars.length * mult;
    st.score += gain;
    st.combo++;
    st.pops++;
    const burst = document.createElement('div');
    burst.className = 'pop';
    burst.style.transform = b.el.style.transform;
    burst.innerHTML = `<span>+${gain}</span>`;
    area.append(burst);
    setTimeout(() => burst.remove(), 600);
    b.el.remove();
    Sound.play('pop');
    if (st.pops % 10 === 0) {
      st.level++;
      Sound.play('level');
      Celebrate.notice(`<span class="n-emoji">🚀</span><span><b>רמה ${st.level}!</b><br>הבלונים מהירים יותר</span>`, 'level');
    }
    hud();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (st && st.running) { stop(); overlay.hidden = false; overlay.innerHTML = '<div class="overlay-card"><div class="big-emoji">⏸️</div><h2>הפסקה</h2><button class="btn primary big-btn" id="resume">להמשיך (רווח)</button></div>'; $('#resume').onclick = resume; }
      return;
    }
    if (!st || !st.running) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (st && st.hearts > 0 && !overlay.hidden && $('#resume')) resume(); else start(); }
      return;
    }
    const ch = resolveChar(e);
    if (!ch || ch === ' ') { if (ch) e.preventDefault(); return; }
    e.preventDefault();
    st.keys++;
    let hit = false;
    if (mode === 'words') {
      if (!st.lock) {
        const cands = st.balloons.filter(b => b.chars[0] === ch);
        if (cands.length) st.lock = cands.reduce((a, b) => (b.y < a.y ? b : a));
      }
      if (st.lock && st.lock.chars[st.lock.typed] === ch) {
        hit = true;
        const b = st.lock;
        b.typed++;
        b.el.classList.add('locked');
        b.el.querySelectorAll('i').forEach((el, i) => el.classList.toggle('done', i < b.typed));
        if (b.typed >= b.chars.length) pop(b);
      }
    } else {
      const cands = st.balloons.filter(b => b.label === ch);
      if (cands.length) { hit = true; pop(cands.reduce((a, b) => (b.y < a.y ? b : a))); }
    }
    if (kb) kb.flash(e.code, hit);
    if (hit) st.good++;
    else { st.combo = 0; Sound.play('miss'); hud(); }
  }

  function resume() {
    overlay.hidden = true;
    st.running = true;
    st.last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function gameOver() {
    stop();
    const acc = st.keys ? Math.round((st.good / st.keys) * 100) : 100;
    const { reward, isBest } = Account.recordGame({ mode, score: st.score, level: st.level });
    const beat = challenge && st.score > challenge.value;
    overlay.hidden = false;
    overlay.innerHTML = `
      <div class="overlay-card">
        <div class="big-emoji">${isBest && st.score > 0 ? '🏆' : '🎈'}</div>
        <h2>${isBest && st.score > 0 ? 'שיא חדש!' : 'המשחק נגמר'}</h2>
        ${beat ? '<p class="win">ניצחתם את האתגר! 💪</p>' : ''}
        <div class="game-stats">
          <div><span>נקודות</span><b class="num">${st.score}</b></div>
          <div><span>בלונים</span><b class="num">${st.pops}</b></div>
          <div><span>רמה</span><b class="num">${st.level}</b></div>
          <div><span>דיוק</span><b class="num">${acc}%</b></div>
        </div>
        <div class="actions center">
          <button class="btn primary big-btn" id="again">עוד פעם! (רווח)</button>
        </div>
        <div class="actions center" id="game-share"></div>
        <p class="small"><a href="/leaderboard">לטבלת האלופים 🏆</a></p>
      </div>`;
    $('#again').onclick = start;
    $('#game-share').append(Share.button(() => ({
      title: `פוצצתי ${st.pops} בלונים!`, big: st.score, unit: 'נקודות במשחק הבלונים',
      chips: [GAME_MODES[mode].name, `רמה ${st.level}`, `דיוק ${acc}%`],
      url: Share.challengeUrl('/game', st.score, { m: mode }),
      message: `צברתי ${st.score} נקודות במשחק הבלונים של הקלדה עיוורת 🎈 תצליחו לנצח אותי?`,
    })));
    Celebrate.show(reward);
    hud();
  }

  const onVisibility = () => { if (document.hidden && st && st.running) onKey({ key: 'Escape', preventDefault() {} }); };
  document.addEventListener('visibilitychange', onVisibility);

  const m = new URLSearchParams(location.search).get('m');
  if (m && GAME_MODES[m]) { mode = m; Store.set('gameMode', m); }
  renderModes();
  buildKeyboard();
  showStart();
  Page.onKey = onKey;
  Page.onLeave = () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
}
