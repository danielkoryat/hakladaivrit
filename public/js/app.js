'use strict';

(() => {
  const view = $('#view');
  const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;

  const Prefs = {
    get hands() { return Store.get('hands', true); },
    set hands(v) { Store.set('hands', !!v); },
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
    sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></svg>',
  };
  const starsHtml = (n, cls = '') =>
    `<span class="stars ${cls}" aria-label="${n} כוכבים">${[1, 2, 3].map(i => `<span class="${i <= n ? 'on' : ''}">${ICON.star}</span>`).join('')}</span>`;
  const touchNote = () => isTouch ? '<p class="touch-note">האתר מיועד להקלדה במקלדת פיזית. חברו מקלדת כדי לתרגל.</p>' : '';
  const statBox = (label, value, big) => `<div class="stat${big ? ' big' : ''}"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  const KIND_NAMES = { test: 'מבחן', lesson: 'שיעור', practice: 'תרגול', custom: 'שיעור אישי' };

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
      Object.assign(this, { chars: [], spans: [], ltr: [], ranges: [], lastWord: null });
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

    addWords(words) {
      if (this.lastWord) this.letter(' ', this.lastWord, false);
      const frag = document.createDocumentFragment();
      words.forEach((w, i) => {
        const wordEl = document.createElement('div');
        wordEl.className = 'word';
        let box = wordEl;
        const ltr = /\d/.test(w);
        if (ltr) {
          box = document.createElement('span');
          box.className = 'ltr-run';
          wordEl.append(box);
        }
        const start = this.chars.length;
        for (const c of w) this.letter(c, box, ltr);
        this.ranges.push([start, this.chars.length]);
        if (i < words.length - 1) this.letter(' ', wordEl, false);
        frag.append(wordEl);
        this.lastWord = wordEl;
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
        ...extra, wpm: s.wpm, acc: s.acc, cpm: s.cpm, secs: s.secs, errors: s.errors, chars: s.chars,
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
      const ch = resolveChar(e);
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
      const lineStep = this.wordsEl.children[1] ? this.wordsEl.children[1].offsetHeight : 0;
      if (lineStep) {
        const line = Math.floor((y + 2) / lineStep);
        this.wordsEl.style.transform = `translateY(${-Math.max(0, line - 1) * lineStep}px)`;
      }
    }

    destroy() { clearInterval(this.timer); }
  }

  // ---------- Router ----------
  let cleanup = null;
  let keyHandler = null;
  document.addEventListener('keydown', e => {
    if (!keyHandler || $('dialog[open]')) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
    keyHandler(e);
  });

  // Pages have real addresses (/test, /lesson/3 …) so search engines can index each one.
  function navigate(path) {
    if (path !== location.pathname) history.pushState(null, '', path);
    route();
  }

  function route() {
    if (cleanup) cleanup();
    cleanup = null;
    keyHandler = null;
    const [, page = '', arg] = location.pathname.replace(/\/+$/, '').split('/');
    const navKey = page === 'lesson' || page === 'custom' ? 'lessons' : page;
    $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey));
    if (page === 'test') viewTest();
    else if (page === 'lessons') viewLessons();
    else if (page === 'lesson') viewLesson(Number(arg));
    else if (page === 'custom') viewCustom(arg);
    else if (page === 'practice') viewPractice();
    else if (page === 'profile') viewProfile();
    else if (page === 'admin') viewAdmin();
    else if (page === 'privacy') viewPrivacy();
    else viewHome();
    window.scrollTo(0, 0);
    Ads.fill();
    Analytics.page(location.pathname);
  }
  window.addEventListener('popstate', route);
  // Internal links switch pages without reloading.
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="/"]');
    if (!a || a.target || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  // Old links such as /#/lesson/3 keep working.
  function upgradeHashLink() {
    if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1) || '/');
  }
  window.addEventListener('hashchange', () => { upgradeHashLink(); route(); });

  // Keep Space / Enter from activating a focused button while typing.
  view.addEventListener('click', e => { const b = e.target.closest('button'); if (b) b.blur(); });

  // ---------- Header: account area & login dialog ----------
  function renderUserArea() {
    const el = $('#user-area');
    if (Account.user) {
      el.innerHTML = (Account.user.isAdmin ? '<a class="user-chip admin" href="/admin" title="לוח ניהול">ניהול</a>' : '') +
        `<a class="user-chip" href="/profile" title="הפרופיל שלי">${ICON.user}<span>${esc(displayName(Account.user))}</span></a>`;
    } else if (Account.online) {
      el.innerHTML = '<button class="btn small" id="login-btn">התחברות</button>';
      $('#login-btn').onclick = () => openAuth();
    } else {
      el.innerHTML = '';
    }
  }
  Account.on(renderUserArea);

  const authDlg = $('#auth');
  function openAuth() {
    $('#auth-error').textContent = '';
    authDlg.showModal();
    const clientId = Account.config.googleClientId;
    $('#auth-unavailable').hidden = !!clientId;
    if (!clientId) return;
    GoogleSignIn.load(clientId, onGoogleCredential).then(ok => {
      if (ok) GoogleSignIn.render($('#google-btn'));
      else $('#auth-error').textContent = 'לא הצלחנו לטעון את ההתחברות עם Google. נסו לרענן את הדף.';
    });
  }
  async function onGoogleCredential(credential) {
    $('#auth-error').textContent = '';
    try {
      await Account.googleAuth(credential);
      if (authDlg.open) authDlg.close();
      route();
    } catch (err) {
      if (!authDlg.open) authDlg.showModal();
      $('#auth-error').textContent = err.message;
    }
  }
  $('#auth-close').onclick = () => authDlg.close();
  authDlg.addEventListener('click', e => { if (e.target === authDlg) authDlg.close(); });

  // ---------- Shared typing page pieces ----------
  function handsButton(onToggle) {
    const b = document.createElement('button');
    b.className = 'cfg-btn' + (Prefs.hands ? ' active' : '');
    b.innerHTML = `${ICON.hand}<span>ידיים</span>`;
    b.title = 'הצגת ידיים וירטואליות על המקלדת';
    b.onclick = () => { Prefs.hands = !Prefs.hands; b.classList.toggle('active', Prefs.hands); onToggle(); };
    return b;
  }

  // ---------- Home ----------
  function viewHome() {
    document.title = 'הקלדה עיוורת בעברית | מבחן הקלדה, שיעורים ותרגול';
    view.innerHTML = `
      <section class="hero">
        <h1>הקלדה <span>עיוורת</span> בעברית</h1>
        <p class="lead">מבחן הקלדה חינמי, שיעורים מדורגים ותרגול חכם. ללמוד להקליד מהר ומדויק בעשר אצבעות, בלי להסתכל על המקלדת.</p>
        <div class="hero-actions">
          <a class="btn primary" href="/test">התחלת מבחן הקלדה</a>
          <a class="btn" href="/practice">התחלת תרגול</a>
          <a class="btn ghost" href="/lessons">שיעורי הקלדה</a>
        </div>
        <div class="hero-kb" id="home-kb"></div>
        ${fingerLegend()}
      </section>
      ${Ads.slot('home')}

      <article class="content">
        <h2>הקלדה עיוורת: להקליד מהר בלי להסתכל על המקלדת</h2>
        <p><strong>הקלדה עיוורת</strong>, שנקראת גם <strong>הקלדה בעשר אצבעות</strong>, היא שיטה שבה מקלידים בלי להסתכל על המקלדת. כל אצבע אחראית על קבוצת מקשים קבועה, ועם הזמן נבנה <strong>זיכרון שריר</strong> שמוצא כל אות לבד.</p>
        <p>בין אם אתם סטודנטים, מתכנתים, כותבים או עובדי משרד, שליטה בהקלדה עיוורת <strong>משפרת משמעותית את המהירות ואת הדיוק</strong>.</p>

        <h2>למה ללמוד הקלדה עיוורת?</h2>
        <ul>
          <li>להקליד מהר ומדויק יותר</li>
          <li>להתרכז במחשבות ולא במקלדת</li>
          <li>לעבוד ביעילות ובפחות עייפות</li>
        </ul>
        <p>בלי לחפש מקשים ובלי להעביר את המבט בין המסך למקלדת. רק הקלדה חלקה, מהירה ומדויקת.</p>

        <h2>יתרונות מרכזיים</h2>
        <div class="cards3">
          <div class="card"><div class="card-icon">${ICON.zap}</div><h3>מהירות</h3><p>עם תרגול קבוע אפשר להגיע ל־200 עד 400 תווים לדקה ויותר, ולסיים משימות מהר יותר.</p></div>
          <div class="card"><div class="card-icon">${ICON.check}</div><h3>דיוק</h3><p>כשהאצבעות יודעות את הדרך, יש פחות טעויות ופחות זמן על תיקונים.</p></div>
          <div class="card"><div class="card-icon">${ICON.heart}</div><h3>ארגונומיה</h3><p>יציבה נכונה ומבט קבוע במסך מפחיתים עומס על הצוואר, הגב והעיניים.</p></div>
        </div>

        <h2>שורת הבית: ש ד ג כ · ח ל ך ף</h2>
        <p>האצבעות נחות תמיד על שורת הבית. ביד שמאל: זרת על <b>ש</b>, קמיצה על <b>ד</b>, אמה על <b>ג</b> ואצבע מורה על <b>כ</b>. ביד ימין: אצבע מורה על <b>ח</b>, אמה על <b>ל</b>, קמיצה על <b>ך</b> וזרת על <b>ף</b>. על המקשים כ ו־ח (F ו־J) יש בליטה קטנה, וכך מוצאים את המקום בלי להסתכל. האגודלים אחראים על מקש הרווח.</p>

        <h2>ידיים וירטואליות בזמן אמת</h2>
        <p>בזמן ההקלדה מופיעה מתחת לטקסט מקלדת עם <strong>ידיים וירטואליות</strong>: האצבע שצריכה ללחוץ על המקש הבא נדלקת ונשלחת אליו, כך שתמיד ברור איזו אצבע עובדת, בלי להסתכל על הידיים האמיתיות.</p>

        <h2>מבחן הקלדה אונליין</h2>
        <ul>
          <li><strong>זמן</strong>: מקלידים כמה שיותר במשך 15, 30, 60 או 120 שניות.</li>
          <li><strong>מילים</strong>: מקלידים מספר קבוע של מילים: 10, 25, 50 או 100.</li>
          <li><strong>ציטוט</strong>: מקלידים משפט מפורסם, כולל סימני פיסוק.</li>
        </ul>
        <p>בסיום מקבלים מילים לדקה (WPM), תווים לדקה (CPM), אחוז דיוק ורשימה של המקשים שבהם טעיתם.</p>

        <h2>שיעורים מותאמים אישית</h2>
        <p>האתר מנתח כל הקשה: <strong>דיוק ומהירות לכל מקש, לכל אצבע ולכל שורה</strong>, ואת המילים שבהן אתם טועים. מתוך הנתונים נבנים שיעורים אישיים שמחזקים בדיוק את החולשות שלכם. עם חשבון, כל התוצאות וההתקדמות נשמרות ומסונכרנות בין מכשירים.</p>

        ${Ads.slot('home')}
        <h2>שאלות נפוצות</h2>
        <details><summary>כמה זמן לוקח ללמוד הקלדה עיוורת?</summary><p>רוב האנשים מכירים את כל המקשים אחרי שבוע או שבועיים של 15 עד 20 דקות תרגול ביום. המהירות ממשיכה לעלות עם הזמן.</p></details>
        <details><summary>צריך להחליף את שפת המקלדת לעברית?</summary><p>לא חובה. האתר מזהה את המיקום הפיזי של המקש, כך שגם כשהמחשב מוגדר לאנגלית, לחיצה על A תיחשב כ־ש.</p></details>
        <details><summary>מה נחשב מהירות טובה?</summary><p>הקלדה ממוצעת היא בערך 35 עד 40 מילים לדקה. 60 ומעלה נחשב מהיר, ו־80 ומעלה מצוין. בהתחלה חשוב יותר להקפיד על דיוק, והמהירות תגיע.</p></details>
        <details><summary>צריך חשבון?</summary><p>לא. אפשר לתרגל כאורח, והנתונים יישמרו בדפדפן. עם חשבון, התוצאות נשמרות בשרת ואפשר להמשיך מכל מחשב.</p></details>

        <div class="home-cta"><a class="btn primary" href="/lessons">מתחילים מהשיעור הראשון</a></div>
      </article>`;

    // A little demo: the hands "type" a phrase on the home keyboard.
    const kb = Keyboard($('#home-kb'), { colored: true, hands: true });
    const demo = [...'שלום עולם '];
    let i = 0;
    const timer = setInterval(() => {
      if (!document.hidden) { kb.highlight(demo[i]); i = (i + 1) % demo.length; }
    }, 700);
    cleanup = () => clearInterval(timer);
  }

  // ---------- Test ----------
  function viewTest() {
    document.title = 'מבחן הקלדה בעברית: בדקו את מהירות ההקלדה שלכם | הקלדה עיוורת';
    const cfg = Object.assign({ mode: 'time', time: 30, words: 25, punct: false, nums: false, kb: true }, Store.get('testCfg', {}));
    view.innerHTML = `
      <section class="page">
        <div class="config" id="config"></div>
        <div class="stage" id="stage">
          <div class="live"><span class="live-main num" id="live-main"></span><span class="live-sub num" id="live-wpm"></span></div>
          <div class="typing-box idle" id="tb"></div>
          <div class="under"><button class="icon-btn restart" id="restart" aria-label="התחלה מחדש" title="התחלה מחדש (Tab)">${ICON.restart}</button></div>
          <div class="kb-wrap" id="kbw"></div>
        </div>
        <div class="result" id="result" hidden></div>
        ${touchNote()}
      </section>`;

    let typer = null, kb = null, lastText = '', lastQuote = null;

    function renderConfig() {
      const b = (attr, val, label, active) => `<button class="cfg-btn${active ? ' active' : ''}" data-${attr}="${val}">${label}</button>`;
      const values = cfg.mode === 'time' ? [15, 30, 60, 120] : [10, 25, 50, 100];
      $('#config').innerHTML = `
        ${cfg.mode !== 'quote' ? `<div class="cfg-group">
          ${b('toggle', 'punct', '<span class="num">!?</span> פיסוק', cfg.punct)}
          ${b('toggle', 'nums', '<span class="num">#</span> מספרים', cfg.nums)}
        </div><div class="cfg-sep"></div>` : ''}
        <div class="cfg-group">
          ${b('mode', 'time', 'זמן', cfg.mode === 'time')}
          ${b('mode', 'words', 'מילים', cfg.mode === 'words')}
          ${b('mode', 'quote', 'ציטוט', cfg.mode === 'quote')}
        </div>
        ${cfg.mode !== 'quote' ? `<div class="cfg-sep"></div><div class="cfg-group">
          ${values.map(v => b('value', v, `<span class="num">${v}</span>`, cfg[cfg.mode] === v)).join('')}
        </div>` : ''}
        <div class="cfg-sep"></div>
        <div class="cfg-group" id="view-group">${b('toggle', 'kb', 'מקלדת', cfg.kb)}</div>`;
      if (cfg.kb) $('#view-group').append(handsButton(buildKeyboard));
    }

    $('#config').addEventListener('click', e => {
      const t = e.target.closest('button[data-mode], button[data-value], button[data-toggle]');
      if (!t) return;
      if (t.dataset.mode) cfg.mode = t.dataset.mode;
      if (t.dataset.value) cfg[cfg.mode] = Number(t.dataset.value);
      if (t.dataset.toggle) cfg[t.dataset.toggle] = !cfg[t.dataset.toggle];
      Store.set('testCfg', cfg);
      renderConfig();
      start();
    });

    function buildKeyboard() {
      $('#kbw').hidden = !cfg.kb;
      kb = cfg.kb ? Keyboard($('#kbw'), { hands: Prefs.hands }) : null;
      if (kb && typer) kb.highlight(typer.nextChar());
    }

    function live(tp) {
      const s = tp.stats();
      if (cfg.mode === 'time') {
        $('#live-main').textContent = tp.startTime ? Math.max(0, Math.ceil(cfg.time - s.secs)) : cfg.time;
      } else {
        $('#live-main').textContent = `${tp.wordsDone()}/${tp.wordCount}`;
      }
      $('#live-wpm').textContent = tp.startTime && s.secs > 1 ? `${Math.round(s.wpm)} wpm` : '';
    }

    function start(same) {
      $('#result').hidden = true;
      $('#stage').hidden = false;
      let text;
      if (same && lastText) text = lastText;
      else if (cfg.mode === 'quote') { lastQuote = pick(QUOTES); text = lastQuote.text; }
      else if (cfg.mode === 'words') text = randomWords(cfg.words, cfg);
      else text = randomWords(80, cfg);
      lastText = text;
      if (typer) typer.destroy();
      typer = null;
      buildKeyboard();
      typer = new Typer({
        el: $('#tb'),
        text,
        timeLimit: cfg.mode === 'time' ? cfg.time : 0,
        more: cfg.mode === 'time' ? () => randomWords(40, cfg) : null,
        onUpdate: tp => { live(tp); if (kb) kb.highlight(tp.nextChar()); },
        onTick: live,
        onPress: (code, ok) => kb && kb.flash(code, ok),
        onFinish: showResult,
      });
    }

    function showResult(s, tp) {
      const mode = cfg.mode === 'quote' ? 'quote' : `${cfg.mode}-${cfg[cfg.mode]}${cfg.punct ? '-p' : ''}${cfg.nums ? '-n' : ''}`;
      const label = cfg.mode === 'time' ? `זמן ${cfg.time}` : cfg.mode === 'words' ? `מילים ${cfg.words}` : 'ציטוט';
      const { isPb } = Account.record(tp.report({ kind: 'test', mode, label }));
      $('#stage').hidden = true;
      const r = $('#result');
      r.hidden = false;
      r.innerHTML = `
        ${isPb ? '<div class="pb">שיא אישי חדש!</div>' : ''}
        <div class="result-top">
          ${statBox('מילים לדקה', Math.round(s.wpm), true)}
          ${statBox('דיוק', Math.round(s.acc) + '%', true)}
        </div>
        ${lastQuote && cfg.mode === 'quote' ? `<p class="quote-src">${esc(lastQuote.source)}</p>` : ''}
        <div class="result-grid">
          ${statBox('תווים לדקה', Math.round(s.cpm))}
          ${statBox('זמן', fmtTime(s.secs))}
          ${statBox('תווים (נכון/שגוי)', `${s.correct}/${s.incorrect}`)}
          ${statBox('סוג מבחן', `<span dir="rtl" style="font-family:var(--font);font-size:1.2rem">${label}</span>`)}
        </div>
        ${missedHtml(s.charStats)}
        ${!Account.user && Account.online ? '<p class="save-note">רוצים לשמור את התוצאות ולקבל שיעורים מותאמים אישית? <button class="link-btn" id="save-login">התחברו עם Google</button></p>' : ''}
        <div class="actions">
          <button class="btn primary" id="again">${ICON.restart} מבחן חדש</button>
          <button class="btn" id="same">אותו טקסט שוב</button>
          <a class="btn ghost" href="/profile">לניתוח הביצועים שלי</a>
        </div>
        ${Ads.slot('results')}`;
      Ads.fill(r);
      $('#again').onclick = () => start();
      $('#same').onclick = () => start(true);
      if ($('#save-login')) $('#save-login').onclick = () => openAuth();
    }

    $('#restart').onclick = () => start();
    keyHandler = e => {
      if (e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); start(); return; }
      if (!$('#stage').hidden && typer) typer.handleKey(e);
    };
    cleanup = () => typer && typer.destroy();
    renderConfig();
    start();
  }

  // ---------- Lessons list ----------
  function viewLessons() {
    document.title = 'שיעורי הקלדה עיוורת בעברית: 16 שיעורים מדורגים | הקלדה עיוורת';
    const prog = Account.data.lessons;
    const done = LESSONS.filter(l => prog[l.id] && prog[l.id].stars).length;
    const pct = Math.round((done / LESSONS.length) * 100);
    const groups = [...new Set(LESSONS.map(l => l.group))];
    const typeLabel = { words: 'מילים נפוצות', sentences: 'משפטים שלמים', review: 'חזרה' };
    const custom = customLessons(analyze(Account.data));
    view.innerHTML = `
      <section class="page">
        <div class="lessons-top page-head">
          <div>
            <h1>שיעורי הקלדה</h1>
            <p>מתחילים בשורת הבית ומתקדמים שורה אחרי שורה. כל שיעור מוסיף כמה מקשים חדשים.</p>
          </div>
          <div class="overall">
            <span class="pct">${pct}%</span>
            <div><div class="progress"><div class="bar" style="width:${pct}%"></div></div><div style="font-size:.85rem">${done} מתוך ${LESSONS.length} שיעורים</div></div>
          </div>
        </div>
        ${Ads.slot('lessons')}
        ${custom.length ? `
          <h2 class="section-title">${ICON.sparkle} השיעורים האישיים שלך</h2>
          <div class="lesson-grid">${custom.map(customCard).join('')}</div>` : ''}
        <div class="kb-wrap" id="lkb"></div>
        ${fingerLegend()}
        ${groups.map(g => `
          <h2 class="section-title">${g}</h2>
          <div class="lesson-grid">
            ${LESSONS.filter(l => l.group === g).map(l => {
              const p = prog[l.id];
              const keys = l.newKeys.length
                ? `<div class="lc-keys">${l.newKeys.map(k => `<span class="kc">${esc(k)}</span>`).join('')}</div>`
                : `<div class="lc-type">${typeLabel[l.type] || typeLabel.review}</div>`;
              return `<a class="lesson-card${p && p.stars ? ' done' : ''}" href="/lesson/${l.id}">
                <div class="lc-top"><span class="lc-num">${String(l.id).padStart(2, '0')}</span>${starsHtml(p ? p.stars : 0)}</div>
                <div class="lc-title">${esc(l.title)}</div>
                ${keys}
                ${p ? `<div class="lc-best">שיא: <span class="num">${p.wpm}</span> מילים לדקה · <span class="num">${p.acc}%</span> דיוק</div>` : ''}
              </a>`;
            }).join('')}
          </div>`).join('')}
      </section>`;
    Keyboard($('#lkb'), { colored: true, hands: Prefs.hands });
  }

  function customCard(l) {
    const keys = l.keys.length
      ? `<div class="lc-keys">${l.keys.slice(0, 10).map(k => `<span class="kc">${esc(k)}</span>`).join('')}</div>`
      : `<div class="lc-keys">${l.words.slice(0, 4).map(w => `<span class="kc">${esc(w)}</span>`).join('')}</div>`;
    return `<a class="lesson-card custom" href="/custom/${l.id}">
      <div class="lc-top"><span class="lc-num">${ICON.sparkle}</span></div>
      <div class="lc-title">${esc(l.title)}</div>
      ${keys}
    </a>`;
  }

  // ---------- Lesson runner (regular and personalised lessons) ----------
  function runLesson({ docTitle, meta, title, desc, focusKeys, dimTo, makeText, target, save, next }) {
    document.title = docTitle;
    view.innerHTML = `
      <section class="page">
        <div class="lesson-head">
          <a class="back" href="/lessons">→ כל השיעורים</a>
          <div class="lesson-meta">${meta}</div>
          <h1>${esc(title)}</h1>
          <p>${esc(desc)}</p>
        </div>
        <div class="stage" id="stage">
          <div class="progress"><div class="bar" id="bar"></div></div>
          <div class="typing-box idle" id="tb"></div>
          <div class="hint-row"><div class="hint" id="hint"></div><div id="tools"></div></div>
          <div class="kb-wrap" id="kbw"></div>
          ${fingerLegend()}
        </div>
        <div class="result" id="result" hidden></div>
        ${touchNote()}
      </section>`;

    let kb = null, typer = null;
    function buildKeyboard() {
      kb = Keyboard($('#kbw'), { colored: true, hands: Prefs.hands });
      if (dimTo) kb.dimExcept(dimTo);
      kb.mark(focusKeys, 'focus');
      if (typer) update(typer);
    }
    $('#tools').append(handsButton(buildKeyboard));

    function update(tp) {
      const ch = tp.nextChar();
      const finger = kb.highlight(ch);
      $('#bar').style.width = (tp.pos / tp.chars.length) * 100 + '%';
      $('#hint').innerHTML = ch == null ? '' :
        `הקישו <span class="hint-key">${ch === ' ' ? 'רווח' : esc(ch)}</span> עם <span class="hint-finger">${FINGER_NAMES[finger] || ''}</span>`;
    }

    function start() {
      $('#result').hidden = true;
      $('#stage').hidden = false;
      if (typer) typer.destroy();
      typer = null;
      buildKeyboard();
      typer = new Typer({
        el: $('#tb'),
        text: makeText(),
        strict: true,
        onUpdate: update,
        onPress: (code, ok) => kb.flash(code, ok),
        onFinish: finish,
      });
    }

    function finish(s, tp) {
      const wpm = Math.round(s.wpm);
      const acc = Math.round(s.acc);
      const stars = acc >= 97 && wpm >= target ? 3 : acc >= 92 ? 2 : 1;
      save(tp, stars);
      const note = stars === 3 ? 'מעולה! עברתם את השיעור בהצטיינות.'
        : stars === 2 ? `יפה מאוד. לשלושה כוכבים: דיוק של 97% ומעלה ולפחות ${target} מילים לדקה.`
        : 'סיימתם את השיעור! נסו שוב והתמקדו בדיוק, לאט ובטוח.';
      $('#stage').hidden = true;
      const r = $('#result');
      r.hidden = false;
      r.innerHTML = `
        ${starsHtml(stars, 'big')}
        <h2 class="result-title">הושלם: ${esc(title)}</h2>
        <p class="result-note">${note}</p>
        <div class="result-top">
          ${statBox('מילים לדקה', wpm, true)}
          ${statBox('דיוק', acc + '%', true)}
        </div>
        <div class="result-grid">
          ${statBox('תווים לדקה', Math.round(s.cpm))}
          ${statBox('זמן', fmtTime(s.secs))}
          ${statBox('טעויות', s.errors)}
          ${statBox('יעד מהירות', target)}
        </div>
        ${missedHtml(s.charStats)}
        <div class="actions">
          ${next ? `<a class="btn primary" href="${next.href}">${next.label} ${ICON.next}</a>` : ''}
          <button class="btn" id="again">${ICON.restart} שוב</button>
          <a class="btn ghost" href="/lessons">כל השיעורים</a>
        </div>
        ${Ads.slot('results')}`;
      Ads.fill(r);
      $('#again').onclick = start;
    }

    keyHandler = e => {
      if (e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); start(); return; }
      if (!$('#stage').hidden && typer) typer.handleKey(e);
      else if (e.key === 'Enter' && next) navigate(next.href);
    };
    cleanup = () => typer && typer.destroy();
    start();
  }

  function viewLesson(id) {
    const idx = LESSONS.findIndex(l => l.id === id);
    if (idx < 0) { navigate('/lessons'); return; }
    const lesson = LESSONS[idx];
    const nextLesson = LESSONS[idx + 1];
    runLesson({
      docTitle: `שיעור ${id}: ${lesson.title} | הקלדה עיוורת`,
      meta: `שיעור ${id} מתוך ${LESSONS.length} · ${esc(lesson.group)}`,
      title: lesson.title,
      desc: lesson.desc,
      focusKeys: lesson.newKeys,
      dimTo: lesson.type ? null : [...lessonLetters(idx), ' '],
      makeText: () => lessonText(lesson, idx),
      target: lesson.target,
      save: (tp, stars) => Account.record(tp.report({ kind: 'lesson', mode: `lesson-${id}`, label: `שיעור ${id}`, lessonId: id, stars })),
      next: nextLesson ? { href: `/lesson/${nextLesson.id}`, label: 'לשיעור הבא' } : { href: '/profile', label: 'לניתוח הביצועים' },
    });
  }

  function viewCustom(id) {
    const lesson = customLessons(analyze(Account.data)).find(l => l.id === id);
    if (!lesson) { navigate('/profile'); return; }
    runLesson({
      docTitle: `${lesson.title} | הקלדה עיוורת`,
      meta: `${ICON.sparkle} שיעור מותאם אישית שנבנה מתוך הנתונים שלך`,
      title: lesson.title,
      desc: lesson.desc,
      focusKeys: lesson.keys,
      dimTo: null,
      makeText: () => customLessonText(lesson),
      target: lesson.target,
      save: tp => Account.record(tp.report({ kind: 'custom', mode: `custom-${id}`, label: lesson.title })),
      next: { href: '/profile', label: 'לניתוח המעודכן' },
    });
  }

  // ---------- Practice ----------
  function viewPractice() {
    document.title = 'תרגול הקלדה בעברית שמתמקד במקשים החלשים שלכם | הקלדה עיוורת';
    const cfg = Object.assign({ mode: 'weak', noMistakes: true }, Store.get('practiceCfg', {}));
    const MODE_NAMES = { weak: 'מקשים חלשים', common: 'מילים נפוצות', sentences: 'משפטים' };
    view.innerHTML = `
      <section class="page">
        <div class="config" id="config"></div>
        <div class="banner" id="banner" hidden></div>
        <div class="stage" id="stage">
          <div class="live"><span class="live-main num" id="live-main"></span><span class="live-sub" id="live-sub"></span></div>
          <div class="typing-box idle" id="tb"></div>
          <div class="under"><button class="icon-btn restart" id="restart" aria-label="סבב חדש" title="סבב חדש (Tab)">${ICON.restart}</button></div>
          <div class="kb-wrap" id="kbw"></div>
        </div>
        <div class="result" id="result" hidden></div>
        ${touchNote()}

        <h2 class="section-title">מפת הטעויות שלכם</h2>
        <div class="weak-row">
          <div id="weak"></div>
          <div><a class="btn ghost" href="/profile">לניתוח המלא</a><button class="btn ghost" id="reset-stats">איפוס נתונים</button></div>
        </div>
        <div class="kb-wrap" id="heat" style="margin-top:0"></div>
        <div class="legend"><span>מדויק</span><span class="heat-scale"></span><span>הרבה טעויות</span></div>
      </section>`;

    let typer = null, kb = null, round = 1;
    const heatKb = Keyboard($('#heat'));
    const weakLetters = () => analyze(Account.data).weakKeys.map(k => k.ch).filter(isHebrew);

    function refreshHeat() {
      heatKb.heat(Account.data.keyStats);
      const weak = weakLetters();
      $('#weak').innerHTML = weak.length
        ? `<span style="color:var(--c-sub-alt)">האותיות החלשות שלכם: </span><span class="chips" style="display:inline-flex">${weak.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</span>`
        : '<span style="color:var(--c-sub-alt)">עדיין אין מספיק נתונים. הקלידו קצת והמפה תתמלא.</span>';
    }

    function renderConfig() {
      const b = (attr, val, label, active) => `<button class="cfg-btn${active ? ' active' : ''}" data-${attr}="${val}">${label}</button>`;
      $('#config').innerHTML = `
        <div class="cfg-group">
          ${Object.entries(MODE_NAMES).map(([k, n]) => b('mode', k, n, cfg.mode === k)).join('')}
        </div>
        <div class="cfg-sep"></div>
        <div class="cfg-group" id="view-group">${b('toggle', 'noMistakes', 'ללא טעויות', cfg.noMistakes)}</div>`;
      $('#view-group').append(handsButton(buildKeyboard));
    }
    $('#config').addEventListener('click', e => {
      const t = e.target.closest('button[data-mode], button[data-toggle]');
      if (!t) return;
      if (t.dataset.mode) cfg.mode = t.dataset.mode;
      if (t.dataset.toggle) cfg.noMistakes = !cfg.noMistakes;
      Store.set('practiceCfg', cfg);
      renderConfig();
      start();
    });

    function buildKeyboard() {
      kb = Keyboard($('#kbw'), { hands: Prefs.hands });
      if (typer) kb.highlight(typer.nextChar());
    }

    function freshText(n = 25) {
      if (cfg.mode === 'sentences') return shuffle(SENTENCES).slice(0, 3).join(' ');
      if (cfg.mode === 'weak') {
        const weak = weakLetters();
        if (weak.length) return weightedWords(n, weak).join(' ');
      }
      return randomWords(n);
    }

    function banner(html, good) {
      const el = $('#banner');
      el.hidden = !html;
      el.className = 'banner' + (good ? ' good' : '');
      el.innerHTML = html || '';
    }

    function live(tp) {
      $('#live-main').textContent = `${tp.wordsDone()}/${tp.wordCount}`;
      const s = tp.stats();
      $('#live-sub').textContent = cfg.noMistakes ? `סבב ${round}` : (tp.startTime && s.secs > 1 ? `${Math.round(s.wpm)} wpm` : '');
    }

    function start(text, keepRound) {
      if (!keepRound) { round = 1; banner(''); }
      if (!text && cfg.mode === 'weak' && !weakLetters().length) {
        banner('עוד אין מספיק נתונים על המקשים החלשים שלכם, אז בינתיים מתרגלים מילים נפוצות.', true);
      }
      $('#result').hidden = true;
      $('#stage').hidden = false;
      if (typer) typer.destroy();
      typer = null;
      buildKeyboard();
      typer = new Typer({
        el: $('#tb'),
        text: text || freshText(),
        strict: cfg.noMistakes,
        onUpdate: tp => { live(tp); kb.highlight(tp.nextChar()); },
        onTick: live,
        onPress: (code, ok) => kb.flash(code, ok),
        onFinish: finish,
      });
    }

    function finish(s, tp) {
      Account.record(tp.report({ kind: 'practice', mode: `practice-${cfg.mode}`, label: `תרגול: ${MODE_NAMES[cfg.mode]}` }));
      refreshHeat();
      if (cfg.noMistakes && s.errors > 0) {
        const missedWords = [...new Set(tp.errorWords())];
        round++;
        banner(`סבב ${round - 1}: ${s.errors === 1 ? 'טעות אחת' : s.errors + ' טעויות'} (${Math.round(s.wpm)} מילים לדקה). המילים שבהן טעיתם חוזרות. ממשיכים עד סבב בלי אף טעות.`);
        const next = cfg.mode === 'sentences'
          ? shuffle(SENTENCES).slice(0, 2).join(' ') + ' ' + missedWords.join(' ')
          : shuffle([...missedWords, ...missedWords, ...freshText(Math.max(8, 20 - missedWords.length * 2)).split(' ')]).join(' ');
        start(next, true);
        return;
      }
      banner('');
      $('#stage').hidden = true;
      const r = $('#result');
      r.hidden = false;
      r.innerHTML = `
        <h2 class="result-title">${cfg.noMistakes ? (round > 1 ? `סבב מושלם אחרי ${round} סבבים!` : 'סבב מושלם בניסיון הראשון!') : 'התרגול הסתיים'}</h2>
        <div class="result-top">
          ${statBox('מילים לדקה', Math.round(s.wpm), true)}
          ${statBox('דיוק', Math.round(s.acc) + '%', true)}
        </div>
        <div class="result-grid">
          ${statBox('תווים לדקה', Math.round(s.cpm))}
          ${statBox('זמן', fmtTime(s.secs))}
          ${statBox('טעויות', s.errors)}
          ${statBox('מילים', tp.wordCount)}
        </div>
        ${missedHtml(s.charStats)}
        <div class="actions"><button class="btn primary" id="again">${ICON.restart} תרגול נוסף</button><a class="btn ghost" href="/profile">לניתוח הביצועים</a></div>
        ${Ads.slot('results')}`;
      Ads.fill(r);
      $('#again').onclick = () => start();
    }

    $('#restart').onclick = () => start();
    $('#reset-stats').onclick = async () => {
      try { await Account.resetStats(); refreshHeat(); toast('נתוני המקשים אופסו'); } catch (e) { toast(e.message, true); }
    };
    keyHandler = e => {
      if (e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); start(); return; }
      if (!$('#stage').hidden && typer) typer.handleKey(e);
    };
    cleanup = () => typer && typer.destroy();
    renderConfig();
    refreshHeat();
    start();
  }

  // ---------- Profile & analysis ----------
  function niceStep(raw) {
    const pow = 10 ** Math.floor(Math.log10(raw));
    const n = raw / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }

  // Single-series line chart with crosshair + tooltip. opts: value, label, tipTitle, tipSub, aria.
  function lineChart(el, pts, opts) {
    const val = opts.value;
    el.setAttribute('dir', 'ltr');
    el.tabIndex = 0;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', opts.aria(pts));
    let active = null;

    function draw() {
      const W = el.clientWidth || 600, H = 240, m = { t: 16, r: 48, b: 30, l: 40 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const maxV = Math.max(10, ...pts.map(val));
      const step = niceStep(maxV / 4);
      const top = Math.ceil(maxV / step) * step;
      const x = i => m.l + (pts.length === 1 ? iw / 2 : (i * iw) / (pts.length - 1));
      const y = v => m.t + ih - (v / top) * ih;
      let grid = '';
      for (let v = 0; v <= top + 1e-9; v += step) {
        grid += `<line class="c-grid" x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}"/>` +
          `<text class="c-tick" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
      }
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(val(p)).toFixed(1)}`).join('');
      const area = `${line}L${x(pts.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
      const li = pts.length - 1;
      el.innerHTML = `
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
          ${grid}
          <path class="c-area" d="${area}"/>
          <path class="c-line" d="${line}"/>
          <line class="c-cross" id="c-cross" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
          <circle class="c-dot" cx="${x(li)}" cy="${y(val(pts[li]))}" r="4"/>
          <circle class="c-dot" id="c-hover" r="4" visibility="hidden"/>
          <text class="c-end" x="${x(li) + 9}" y="${y(val(pts[li])) + 4}">${Math.round(val(pts[li]))}</text>
          <text class="c-tick" x="${m.l}" y="${H - 8}" text-anchor="start">${esc(opts.label(pts[0]))}</text>
          <text class="c-tick" x="${m.l + iw}" y="${H - 8}" text-anchor="end">${esc(opts.label(pts[li]))}</text>
          <rect x="${m.l - 10}" y="0" width="${iw + 20}" height="${H}" fill="transparent" id="c-hit"/>
        </svg>
        <div class="c-tip" id="c-tip" hidden><strong></strong><span></span></div>`;

      const cross = $('#c-cross', el), hover = $('#c-hover', el), tip = $('#c-tip', el);
      const show = i => {
        active = i;
        const p = pts[i];
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
        hover.setAttribute('cx', x(i)); hover.setAttribute('cy', y(val(p))); hover.setAttribute('visibility', 'visible');
        tip.hidden = false;
        $('strong', tip).textContent = opts.tipTitle(p);
        $('span', tip).textContent = opts.tipSub(p);
        const tx = Math.min(Math.max(x(i) - tip.offsetWidth / 2, 0), W - tip.offsetWidth);
        tip.style.left = tx + 'px';
        tip.style.top = Math.max(0, y(val(p)) - tip.offsetHeight - 14) + 'px';
      };
      const hide = () => { active = null; cross.setAttribute('visibility', 'hidden'); hover.setAttribute('visibility', 'hidden'); tip.hidden = true; };
      const hit = $('#c-hit', el);
      hit.addEventListener('pointermove', e => {
        const px = e.clientX - el.getBoundingClientRect().left;
        show(pts.length === 1 ? 0 : Math.max(0, Math.min(li, Math.round(((px - m.l) / iw) * li))));
      });
      hit.addEventListener('pointerleave', hide);
      el.onkeydown = e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const d = e.key === 'ArrowRight' ? 1 : -1;
        show(active == null ? li : Math.max(0, Math.min(li, active + d)));
      };
      el.onblur = hide;
    }
    draw();
    onResizeWhile(el, draw);
  }

  function insights(a, d) {
    const pct = v => Math.round(v * 100) + '%';
    const good = [], bad = [];
    const t = a.trend;
    if (t.prevWpm != null && t.recentWpm != null) {
      const diff = Math.round(t.recentWpm - t.prevWpm);
      if (diff >= 1) good.push(`המהירות שלך עלתה ב־${diff} מילים לדקה ב־10 המבחנים האחרונים.`);
      else if (diff <= -2) bad.push(`המהירות הממוצעת ירדה ב־${-diff} מילים לדקה לעומת 10 המבחנים הקודמים.`);
    }
    if (a.overall.acc != null && a.overall.total >= 100) {
      if (a.overall.acc >= 0.96) good.push(`דיוק כללי גבוה: ${pct(a.overall.acc)} מכל ההקשות.`);
      else bad.push(`הדיוק הכללי שלך ${pct(a.overall.acc)}. נסו להאט מעט, כי דיוק קודם למהירות.`);
    }
    if (a.strongestFinger) good.push(`האצבע החזקה שלך: ${a.strongestFinger.name} (${pct(a.strongestFinger.acc)} דיוק).`);
    if (a.strongKeys.length) good.push(`המקשים המדויקים והמהירים שלך: ${a.strongKeys.map(k => k.ch).join(' ')}.`);
    const doneLessons = Object.values(d.lessons).filter(l => l.stars).length;
    if (doneLessons) good.push(`השלמת ${doneLessons} מתוך ${LESSONS.length} שיעורים.`);

    if (a.weakKeys.length) bad.push(`דיוק נמוך במקשים: ${a.weakKeys.map(k => `${k.ch} (${pct(k.acc)})`).join(', ')}.`);
    if (a.slowKeys.length) bad.push(`מקשים איטיים: ${a.slowKeys.map(k => `${k.ch} (${Math.round(k.ms)}ms)`).join(', ')}, לעומת ממוצע של ${Math.round(a.overall.ms)}ms.`);
    if (a.weakestFinger) bad.push(`האצבע החלשה ביותר: ${a.weakestFinger.name} (${pct(a.weakestFinger.acc)} דיוק).`);
    if (a.weakestRow) bad.push(`השורה החלשה ביותר: ${a.weakestRow.name} (${pct(a.weakestRow.acc)} דיוק).`);
    if (a.problemWords.length) bad.push(`מילים שחוזרות על טעויות: ${a.problemWords.slice(0, 6).join(', ')}.`);
    return { good, bad };
  }

  function viewProfile() {
    document.title = 'הפרופיל שלי | הקלדה עיוורת';
    const d = Account.data;
    const a = analyze(d);
    const tests = d.history.filter(h => h.kind === 'test' && h.chars > 0);
    const custom = customLessons(a);
    const { good, bad } = insights(a, d);
    const user = Account.user;
    const avgOf = (arr, k) => arr.length ? arr.reduce((s, h) => s + h[k], 0) / arr.length : null;
    const recent = tests.slice(-10);
    const delta = a.trend.prevWpm != null && a.trend.recentWpm != null ? Math.round(a.trend.recentWpm - a.trend.prevWpm) : null;
    const tile = (label, value, sub) => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value num">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
    const lessonsDone = Object.values(d.lessons).filter(l => l.stars).length;
    const recentRows = d.history.slice(-15).reverse();

    view.innerHTML = `
      <section class="page">
        <div class="page-head profile-head">
          <div>
            <h1>${user ? esc(displayName(user)) : 'הפרופיל שלי'}</h1>
            <p>${user ? `<span class="num">${esc(user.email)}</span> · ההתקדמות שלך נשמרת בחשבון ומסונכרנת בין מכשירים.`
              : 'את/ה מתרגל/ת כאורח, והנתונים נשמרים רק בדפדפן הזה.'}</p>
          </div>
          <div class="profile-actions">
            ${user ? '<button class="btn ghost" id="logout">התנתקות</button>'
              : Account.online ? '<button class="btn primary" id="login-cta">התחברות עם Google לשמירת ההתקדמות</button>'
              : '<span class="muted">כדי לשמור תוצאות בחשבון יש להריץ את האתר עם השרת (npm run dev).</span>'}
          </div>
        </div>

        ${!d.history.length ? `
          <div class="panel empty">
            <h2>עוד אין נתונים</h2>
            <p>עשו מבחן הקלדה או שיעור ראשון, והניתוח האישי שלכם יופיע כאן.</p>
            <div class="actions"><a class="btn primary" href="/test">למבחן הקלדה</a><a class="btn" href="/lesson/1">לשיעור הראשון</a></div>
          </div>` : `
        <div class="tiles">
          ${tile('מהירות שיא', a.trend.best ? Math.round(a.trend.best) : '-', 'מילים לדקה במבחן')}
          ${tile('ממוצע 10 מבחנים', a.trend.recentWpm != null ? Math.round(a.trend.recentWpm) : '-',
            delta != null ? `<span class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}</span> לעומת 10 הקודמים` : 'מילים לדקה')}
          ${tile('דיוק ממוצע', recent.length ? Math.round(avgOf(recent, 'acc')) + '%' : a.overall.acc != null ? Math.round(a.overall.acc * 100) + '%' : '-', recent.length ? '10 מבחנים אחרונים' : 'כל ההקשות')}
          ${tile('זמן הקלדה', fmtTime(d.totals.secs || 0), `${d.totals.count || d.history.length} אימונים`)}
          ${tile('שיעורים', `${lessonsDone}/${LESSONS.length}`, 'הושלמו')}
        </div>

        <div class="panel">
          <h2>מהירות במבחנים</h2>
          <p class="panel-sub">מילים לדקה · ${Math.min(tests.length, 50)} המבחנים האחרונים</p>
          ${tests.length >= 2 ? '<div class="chart" id="chart"></div>' : '<p class="muted">עשו לפחות שני מבחני הקלדה כדי לראות את גרף ההתקדמות.</p>'}
        </div>

        <div class="two-col">
          <div class="panel">
            <h2>חוזקות</h2>
            ${good.length ? `<ul class="insights good">${good.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '<p class="muted">המשיכו להתאמן, והחוזקות יופיעו כאן.</p>'}
          </div>
          <div class="panel">
            <h2>לשיפור</h2>
            ${bad.length ? `<ul class="insights bad">${bad.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`
              : `<p class="muted">${a.enough ? 'אין חולשות בולטות, כל הכבוד!' : 'צריך עוד קצת נתונים (לפחות 150 הקשות) כדי לזהות חולשות.'}</p>`}
          </div>
        </div>

        <h2 class="section-title">${ICON.sparkle} שיעורים מותאמים אישית</h2>
        ${custom.length ? `<div class="lesson-grid">${custom.map(customCard).join('')}</div>`
          : `<p class="muted">${a.enough ? 'לא נמצאו חולשות משמעותיות. נסו מבחן ארוך יותר כדי לאתגר את עצמכם.' : 'השיעורים האישיים ייבנו אחרי שנאסוף מספיק נתונים. המשיכו לתרגל!'}</p>`}

        <h2 class="section-title">מפת דיוק: מקשים ואצבעות</h2>
        <div class="kb-wrap" id="pkb" style="margin-top:0"></div>
        <div class="legend"><span>מדויק</span><span class="heat-scale"></span><span>הרבה טעויות</span></div>

        <div class="two-col" style="margin-top:2rem">
          <div class="panel">
            <h2>לפי אצבע</h2>
            <table class="table">
              <thead><tr><th>אצבע</th><th>דיוק</th><th>זמן להקשה</th><th>הקשות</th></tr></thead>
              <tbody>${a.fingers.map(f => `<tr><td>${f.name}</td><td class="num">${f.acc != null ? Math.round(f.acc * 100) + '%' : '-'}</td><td class="num">${f.ms ? Math.round(f.ms) + 'ms' : '-'}</td><td class="num">${f.total}</td></tr>`).join('')}</tbody>
            </table>
          </div>
          <div class="panel">
            <h2>לפי שורה</h2>
            <table class="table">
              <thead><tr><th>שורה</th><th>דיוק</th><th>זמן להקשה</th><th>הקשות</th></tr></thead>
              <tbody>${a.rows.map(r => `<tr><td>${r.name}</td><td class="num">${r.acc != null ? Math.round(r.acc * 100) + '%' : '-'}</td><td class="num">${r.ms ? Math.round(r.ms) + 'ms' : '-'}</td><td class="num">${r.total}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <h2>אימונים אחרונים</h2>
          <table class="table">
            <thead><tr><th>תאריך</th><th>סוג</th><th>מילים לדקה</th><th>דיוק</th><th>זמן</th></tr></thead>
            <tbody>${recentRows.map(h => `<tr>
              <td class="num">${fmtDate(h.at)}</td>
              <td>${esc(h.label || KIND_NAMES[h.kind] || '')}${h.stars ? ' ' + starsHtml(h.stars) : ''}</td>
              <td class="num">${Math.round(h.wpm)}</td>
              <td class="num">${Math.round(h.acc)}%</td>
              <td class="num">${fmtTime(h.secs)}</td></tr>`).join('')}</tbody>
          </table>
        </div>`}
        ${Ads.slot('profile')}
      </section>`;

    if ($('#logout')) $('#logout').onclick = async () => { try { await Account.logout(); route(); } catch (e) { toast(e.message, true); } };
    if ($('#login-cta')) $('#login-cta').onclick = () => openAuth();
    if (!d.history.length) return;
    if ($('#chart')) {
      lineChart($('#chart'), tests.slice(-50), {
        value: p => p.wpm,
        label: p => fmtDate(p.at),
        tipTitle: p => `${Math.round(p.wpm)} מילים לדקה`,
        tipSub: p => `${p.label || 'מבחן'} · דיוק ${Math.round(p.acc)}% · ${fmtDate(p.at)}`,
        aria: pts => `גרף מהירות: ${pts.length} מבחנים, אחרון ${Math.round(pts[pts.length - 1].wpm)} מילים לדקה`,
      });
    }
    const kb = Keyboard($('#pkb'), { hands: true });
    kb.heat(d.keyStats);
    const rates = {};
    a.fingers.forEach(f => { if (f.total >= 20) rates[f.f] = 1 - f.acc; });
    kb.hands.heat(rates);
  }

  // ---------- Admin dashboard (registered users; visitor stats are in Google Analytics) ----------
  function viewAdmin() {
    document.title = 'לוח ניהול | הקלדה עיוורת';
    if (!Account.user || !Account.user.isAdmin) {
      view.innerHTML = `<section class="page"><div class="panel empty"><h2>אין הרשאה</h2>
        <p>${!Account.user ? 'הדף זמין רק למנהלי האתר. התחברו עם חשבון מנהל.'
          : 'החשבון הזה אינו מנהל. הוסיפו את כתובת האימייל שלו ל־ADMIN_EMAILS (בקובץ wrangler.jsonc, או ‎.dev.vars במחשב) ופרסמו מחדש.'}</p></div></section>`;
      return;
    }
    let days = Store.get('adminDays', 30);
    view.innerHTML = `
      <section class="page">
        <div class="page-head profile-head">
          <div><h1>לוח ניהול</h1><p>משתמשים רשומים ופעילות באתר</p></div>
          <div class="config" id="range" style="margin:0"></div>
        </div>
        <div id="admin-body"><p class="muted">טוען…</p></div>
      </section>`;

    const renderRange = () => {
      $('#range').innerHTML = [[7, '7 ימים'], [30, '30 יום'], [90, '90 יום'], [365, 'שנה']]
        .map(([d, l]) => `<button class="cfg-btn${d === days ? ' active' : ''}" data-days="${d}">${l}</button>`).join('');
    };
    $('#range').addEventListener('click', e => {
      const b = e.target.closest('button[data-days]');
      if (!b) return;
      days = Number(b.dataset.days);
      Store.set('adminDays', days);
      renderRange();
      load();
    });

    async function load() {
      let s;
      try { s = await Api.req('GET', `/admin/stats?days=${days}`); } catch (e) {
        $('#admin-body').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
        return;
      }
      if (!$('#admin-body')) return;
      const n = v => Number(v || 0).toLocaleString('he-IL');
      const tile = (label, value, sub) => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value num">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
      const table = (heads, rows, empty = 'אין נתונים עדיין') => rows.length
        ? `<table class="table"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        : `<p class="muted">${empty}</p>`;
      const finishes = Object.values(s.finishes).reduce((a, b) => a + b, 0);
      const fmtDay = d => { const [, m, dd] = d.split('-'); return `${Number(dd)}.${Number(m)}`; };

      $('#admin-body').innerHTML = `
        <div class="panel ga-panel">
          <div>
            <h2>מבקרים, צפיות ומקורות תנועה</h2>
            <p class="panel-sub" style="margin:0">${s.gaId
              ? `הנתונים על כל המבקרים באתר נמצאים ב־Google Analytics (מזהה <span class="num">${esc(s.gaId)}</span>).`
              : 'Google Analytics עדיין לא מחובר. הוסיפו GA_MEASUREMENT_ID לקובץ wrangler.jsonc ופרסמו מחדש.'}</p>
          </div>
          <a class="btn primary" href="https://analytics.google.com/" target="_blank" rel="noopener">פתיחת Google Analytics</a>
        </div>

        <div class="tiles">
          ${tile('משתמשים רשומים', n(s.users.total), 'סך הכול')}
          ${tile('הרשמות חדשות', n(s.users.new), `ב־${days} הימים האחרונים`)}
          ${tile('משתמשים פעילים', n(s.users.active), 'השלימו לפחות אימון אחד')}
          ${tile('אימונים שהושלמו', n(finishes), 'של משתמשים רשומים')}
          ${tile('אימונים למשתמש פעיל', s.users.active ? (finishes / s.users.active).toFixed(1) : '0', 'ממוצע בתקופה')}
        </div>

        <div class="panel">
          <h2>משתמשים פעילים ליום</h2>
          <p class="panel-sub">משתמשים רשומים שהשלימו אימון · ${days} הימים האחרונים</p>
          <div class="chart" id="admin-chart"></div>
        </div>

        <div class="two-col">
          <div class="panel">
            <h2>אימונים לפי סוג</h2>
            ${table(['סוג', 'כמות'], ['test', 'lesson', 'practice', 'custom'].map(k => [KIND_NAMES[k], n(s.finishes[k])]))}
          </div>
          <div class="panel">
            <h2>פירוט יומי</h2>
            ${table(['תאריך', 'פעילים', 'אימונים', 'הרשמות'], s.daily.slice().reverse().slice(0, 14).map(d => [
              fmtDay(d.day), n(d.activeUsers), n(d.results), n(d.signups),
            ]))}
          </div>
        </div>

        <div class="panel">
          <h2>משתמשים אחרונים שנרשמו</h2>
          ${table(['משתמש', 'נרשם', 'אימונים', 'שיא (מילים לדקה)', 'פעילות אחרונה'], s.recentUsers.map(u => [
            `${u.name ? esc(u.name) + '<br>' : ''}<span class="num muted">${esc(u.email)}</span>`, fmtDate(u.createdAt), n(u.results), u.bestWpm != null ? n(u.bestWpm) : '-', u.lastActive ? fmtDate(u.lastActive) : '-',
          ]), 'עדיין אין משתמשים רשומים')}
        </div>`;

      lineChart($('#admin-chart'), s.daily, {
        value: d => d.activeUsers,
        label: d => fmtDay(d.day),
        tipTitle: d => `${n(d.activeUsers)} משתמשים פעילים`,
        tipSub: d => `${fmtDay(d.day)} · ${n(d.results)} אימונים · ${n(d.signups)} הרשמות`,
        aria: pts => `גרף משתמשים פעילים ב־${pts.length} הימים האחרונים`,
      });
    }

    renderRange();
    load();
  }

  // ---------- Privacy policy ----------
  function viewPrivacy() {
    document.title = 'מדיניות פרטיות | הקלדה עיוורת';
    const email = Account.config.contactEmail;
    view.innerHTML = `
      <article class="page content">
        <h1>מדיניות פרטיות</h1>
        <p class="muted">עודכן לאחרונה: ${new Date().toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}</p>

        <h2>איזה מידע נאסף</h2>
        <ul>
          <li><strong>חשבון משתמש</strong>: ההתחברות נעשית עם Google. אנו מקבלים מ־Google את כתובת האימייל, השם ומזהה החשבון בלבד, לא את הסיסמה שלכם.</li>
          <li><strong>תוצאות ותרגול</strong>: מהירות, דיוק, זמני הקשה לכל מקש ומילים שבהן טעיתם, כדי להציג לכם ניתוח ולבנות שיעורים מותאמים אישית. אורחים: הנתונים נשמרים רק בדפדפן שלכם.</li>
          <li><strong>סטטיסטיקות שימוש</strong>: אנו משתמשים ב־Google Analytics כדי להבין כמה אנשים מבקרים באתר, אילו דפים נצפים ומאיפה מגיעים. Google Analytics משתמש בקובצי Cookie ואוסף מידע כמו סוג המכשיר, הדפדפן, מיקום משוער וכתובת ה־IP (מקוצרת). אפשר לקרוא על <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">האופן שבו Google משתמשת במידע</a> ולהתקין את <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener">תוסף הביטול של Google Analytics</a>. אם הפעלתם בדפדפן Global Privacy Control, Google Analytics לא ייטען.</li>
        </ul>

        <h2>פרסומות</h2>
        <p>האתר עשוי להציג פרסומות של Google AdSense. ספקים חיצוניים, כולל Google, משתמשים בקובצי Cookie כדי להציג פרסומות על סמך ביקורים קודמים שלכם באתר זה או באתרים אחרים. השימוש של Google בקובצי Cookie לפרסום מאפשר לה ולשותפיה להציג לכם פרסומות על סמך ביקוריכם באתרים שונים באינטרנט.</p>
        <p>אפשר לבטל פרסום מותאם אישית ב<a href="https://adssettings.google.com" target="_blank" rel="noopener">הגדרות המודעות של Google</a>, ולקרוא עוד על <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">האופן שבו Google משתמשת במידע מאתרים שמשתמשים בשירותיה</a>.</p>

        <h2>שימוש במידע</h2>
        <p>המידע משמש להפעלת האתר, לשמירת ההתקדמות שלכם, לשיפור השיעורים ולהבנת השימוש באתר. איננו מוכרים מידע אישי.</p>

        <h2>מחיקת מידע</h2>
        <p>אפשר לאפס את נתוני המקשים בדף התרגול. לבקשה למחיקת החשבון וכל הנתונים הקשורים אליו${email ? ` כתבו אלינו: <a href="mailto:${esc(email)}">${esc(email)}</a>` : ' פנו אלינו'}.</p>
      </article>`;
  }

  // ---------- Theme ----------
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    Store.set('theme', next);
    $('meta[name="theme-color"]').content = next === 'light' ? '#e9e9e9' : '#22272e';
  });

  upgradeHashLink();
  Account.init().finally(() => {
    Analytics.init(Account.config.gaId);
    route();
  });
})();
