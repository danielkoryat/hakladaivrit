'use strict';

(() => {
  // ---------- Router ----------
  document.addEventListener('keydown', e => {
    if (!Page.onKey || $('dialog[open]')) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
    Page.onKey(e);
  });

  // Pages have real addresses (/test, /lesson/3 …) so search engines can index each one.
  function navigate(path) {
    path = sitePath(path);
    if (path !== location.pathname) history.pushState(null, '', path);
    route();
  }
  Page.navigate = navigate;

  // On the English site every internal link gets the /en prefix, wherever it was written:
  // page HTML here, content fragments, the header and the footer.
  if (SITE_BASE) {
    const localize = root => {
      const links = root.matches && root.matches('a[href^="/"]') ? [root] : root.querySelectorAll ? root.querySelectorAll('a[href^="/"]') : [];
      // data-site marks the link to the other version of the site; it keeps its address.
      links.forEach(a => { const h = a.getAttribute('href'); if (!a.hasAttribute('data-site') && sitePath(h) !== h) a.setAttribute('href', sitePath(h)); });
    };
    localize(document);
    new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) localize(n); })))
      .observe(document.body, { childList: true, subtree: true });
  }

  let renderedPath = null;
  function route() {
    if (Page.onLeave) Page.onLeave();
    Page.onLeave = null;
    Page.onKey = null;
    Page.token++;
    renderedPath = location.pathname;
    const [, page = '', arg] = location.pathname.replace(/^\/en(?=\/|$)/, '').replace(/\/+$/, '').split('/');
    const navKey = page === 'lesson' || page === 'custom' ? 'lessons' : page;
    document.body.dataset.page = page || 'home';
    $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey));
    if (page === 'test') viewTest();
    else if (page === 'lessons') viewLessons();
    else if (page === 'lesson') viewLesson(Number(arg));
    else if (page === 'custom') viewCustom(arg);
    else if (page === 'practice') viewPractice();
    else if (page === 'profile') viewProfile();
    else if (page === 'admin') viewAdmin();
    else if (page === 'privacy') viewPrivacy();
    else if (page === 'guide') viewGuide();
    else if (page === 'english' && SITE_LANG === 'he') viewEnglish();
    else if (page === 'game') viewGame();
    else if (page === 'leaderboard') viewLeaderboard();
    else if (page === 'texts' && arg === 'mine') viewMyTexts();
    else if (page === 'texts' && arg) viewText(arg);
    else if (page === 'texts') viewTexts();
    else viewHome();
    if (!location.hash) window.scrollTo(0, 0);
    Ads.fill();
    Analytics.page(location.pathname);
  }
  // Jumping to a section of the same page (#faq) shouldn't re-render it.
  window.addEventListener('popstate', () => { if (location.pathname !== renderedPath) route(); });
  // Internal links switch pages without reloading.
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="/"]');
    if (!a || a.target || a.hasAttribute('data-site') || /[?&]lang=/.test(a.getAttribute('href')) || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  // Old links such as /#/lesson/3 keep working.
  function upgradeHashLink() {
    if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1) || '/');
  }
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#/')) { upgradeHashLink(); route(); } });

  // Keep Space / Enter from activating a focused button while typing.
  view.addEventListener('click', e => { const b = e.target.closest('button'); if (b) b.blur(); });

  // ---------- Header: account area & login dialog ----------
  function renderUserArea() {
    const el = $('#user-area');
    if (Account.user) {
      el.innerHTML = (Account.user.isAdmin ? `<a class="user-chip admin" href="/admin" title="${tr('לוח ניהול', 'Admin')}">${tr('ניהול', 'Admin')}</a>` : '') +
        `<a class="user-chip" href="/profile" title="${tr('הפרופיל שלי', 'My Profile')}">${ICON.user}<span>${esc(displayName(Account.user))}</span></a>`;
    } else if (Account.online) {
      el.innerHTML = `<button class="btn small" id="login-btn">${tr('התחברות', 'Sign in')}</button>`;
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
      else $('#auth-error').textContent = tr('לא הצלחנו לטעון את ההתחברות עם Google. נסו לרענן את הדף.', 'Failed to load Google sign-in. Try refreshing the page.');
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

  // ---------- Home ----------
  async function viewHome() {
    document.title = tr('הקלדה עיוורת בעברית | מבחן הקלדה, שיעורים ותרגול', 'Free Touch Typing Lessons and Typing Test | Hakladaivrit');
    const token = Page.token;
    const html = await content('home');
    if (token !== Page.token) return;
    view.innerHTML = html;
    Ads.fill(view);

    // A little demo: the hands "type" a phrase on the home keyboard.
    const kb = Keyboard($('#home-kb'), { colored: true, hands: true });
    const demo = [...(SITE_LANG === 'en' ? 'hello world ' : 'שלום עולם ')];
    let i = 0;
    const timer = setInterval(() => {
      if (!document.hidden) { kb.highlight(demo[i]); i = (i + 1) % demo.length; }
    }, 700);
    Page.onLeave = () => clearInterval(timer);
  }

  // ---------- Test ----------
  function viewTest() {
    document.title = SITE_LANG === 'en' ? 'Typing Speed Test: Check Your WPM and Accuracy | Hakladaivrit' : `מבחן הקלדה ${IN_LANG}: בדקו את מהירות ההקלדה שלכם | הקלדה עיוורת`;
    const cfg = Object.assign({ mode: 'time', time: 30, words: 25, punct: false, nums: false, kb: true }, Store.get('testCfg', {}));
    const challenge = Share.challenge(tr('מילים לדקה', 'words per minute'));
    const words = n => randomWords(n, cfg);
    view.innerHTML = `
      <section class="page">
        ${challenge ? challenge.html : ''}
        <div class="config" id="config"></div>
        <div class="stage" id="stage">
          <div class="live"><span class="live-main num" id="live-main"></span><span class="live-sub num" id="live-wpm"></span></div>
          <div class="typing-box idle" id="tb"></div>
          <div class="under"><button class="icon-btn restart" id="restart" aria-label="${tr('התחלה מחדש', 'Restart')}" title="${tr('התחלה מחדש (Tab)', 'Restart (Tab)')}">${ICON.restart}</button></div>
          <div class="kb-wrap" id="kbw"></div>
        </div>
        <div class="result" id="result" hidden></div>
        ${touchNote()}
        <div id="page-info"></div>
      </section>`;
    fillInfo('test');

    let typer = null, kb = null, lastText = '', lastQuote = null;

    function renderConfig() {
      const b = (attr, val, label, active) => `<button class="cfg-btn${active ? ' active' : ''}" data-${attr}="${val}">${label}</button>`;
      const values = cfg.mode === 'time' ? [15, 30, 60, 120] : [10, 25, 50, 100];
      $('#config').innerHTML = `
        ${cfg.mode !== 'quote' ? `<div class="cfg-group">
          ${b('toggle', 'punct', `<span class="num">!?</span> ${tr('פיסוק', 'Punctuation')}`, cfg.punct)}
          ${b('toggle', 'nums', `<span class="num">#</span> ${tr('מספרים', 'Numbers')}`, cfg.nums)}
        </div><div class="cfg-sep"></div>` : ''}
        <div class="cfg-group">
          ${b('mode', 'time', tr('זמן', 'Time'), cfg.mode === 'time')}
          ${b('mode', 'words', tr('מילים', 'Words'), cfg.mode === 'words')}
          ${b('mode', 'quote', tr('ציטוט', 'Quote'), cfg.mode === 'quote')}
        </div>
        ${cfg.mode !== 'quote' ? `<div class="cfg-sep"></div><div class="cfg-group">
          ${values.map(v => b('value', v, `<span class="num">${v}</span>`, cfg[cfg.mode] === v)).join('')}
        </div>` : ''}
        <div class="cfg-sep"></div>
        <div class="cfg-group" id="view-group">${b('toggle', 'kb', tr('מקלדת', 'Keyboard'), cfg.kb)}</div>`;
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
      else if (cfg.mode === 'words') text = words(cfg.words);
      else text = words(80);
      lastText = text;
      if (typer) typer.destroy();
      typer = null;
      buildKeyboard();
      typer = new Typer({
        el: $('#tb'),
        text,
        timeLimit: cfg.mode === 'time' ? cfg.time : 0,
        more: cfg.mode === 'time' ? () => words(40) : null,
        onUpdate: tp => { live(tp); if (kb) kb.highlight(tp.nextChar()); },
        onTick: live,
        onPress: (code, ok) => kb && kb.flash(code, ok),
        onFinish: showResult,
      });
    }

    function showResult(s, tp) {
      const mode = (LANG === 'en' ? 'en-' : '') + (cfg.mode === 'quote' ? 'quote' : `${cfg.mode}-${cfg[cfg.mode]}${cfg.punct ? '-p' : ''}${cfg.nums ? '-n' : ''}`);
      const label = (cfg.mode === 'time' ? `${tr('זמן', 'Time')} ${cfg.time}` : cfg.mode === 'words' ? `${tr('מילים', 'Words')} ${cfg.words}` : tr('ציטוט', 'Quote'))
        + (SITE_LANG === 'he' && LANG === 'en' ? ' · אנגלית' : '');
      const { isPb, reward } = Account.record(tp.report({ kind: 'test', mode, label }));
      const wpm = Math.round(s.wpm);
      const beat = challenge && wpm > challenge.value;
      $('#stage').hidden = true;
      const r = $('#result');
      r.hidden = false;
      r.innerHTML = `
        ${beat ? `<div class="pb win-banner">${tr('ניצחתם את האתגר של', 'You beat the challenge by')} ${challenge.name ? esc(challenge.name) : (SITE_LANG === 'en' ? 'your friend' : 'החבר/ה')}! 💪</div>` : ''}
        ${isPb ? `<div class="pb">${tr('שיא אישי חדש!', 'New personal best!')}</div>` : ''}
        <div class="result-top">
          ${statBox(tr('מילים לדקה', 'Words per minute'), Math.round(s.wpm), true)}
          ${statBox(tr('דיוק', 'Accuracy'), Math.round(s.acc) + '%', true)}
        </div>
        ${lastQuote && cfg.mode === 'quote' ? `<p class="quote-src">${esc(lastQuote.source)}</p>` : ''}
        <div class="result-grid">
          ${statBox(tr('תווים לדקה', 'Characters per minute'), Math.round(s.cpm))}
          ${statBox(tr('זמן', 'Time'), fmtTime(s.secs))}
          ${statBox(tr('תווים (נכון/שגוי)', 'Characters (correct/wrong)'), `${s.correct}/${s.incorrect}`)}
          ${statBox(tr('סוג מבחן', 'Test type'), `<span dir="${tr('rtl', 'ltr')}" style="font-family:var(--font);font-size:1.2rem">${label}</span>`)}
        </div>
        ${missedHtml(s.charStats)}
        ${!Account.user && Account.online ? `<p class="save-note">${tr('רוצים לשמור את התוצאות ולקבל שיעורים מותאמים אישית? ', 'Want to save your results and get personalized lessons? ')}<button class="link-btn" id="save-login">${tr('התחברו עם Google', 'Sign in with Google')}</button></p>` : ''}
        <div class="actions">
          <button class="btn primary" id="again">${ICON.restart} ${tr('מבחן חדש', 'New test')}</button>
          <button class="btn" id="same">${tr('אותו טקסט שוב', 'Same text again')}</button>
          <a class="btn ghost" href="/profile">${tr('לניתוח הביצועים שלי', 'My performance analysis')}</a>
        </div>
        ${Ads.slot('results')}`;
      Ads.fill(r);
      $('#result .actions').append(Share.button(() => ({
        title: SITE_LANG === 'en' ? `I typed ${wpm} words per minute` : `הקלדתי ${wpm} ${IN_LANG}`,
        big: wpm,
        unit: tr('מילים לדקה', 'words per minute'),
        chips: [`${tr('דיוק', 'Accuracy')} ${Math.round(s.acc)}%`, label, `${reward.after.rank.emoji} ${tr('רמה', 'Level')} ${reward.after.level}`],
        url: Share.challengeUrl('/test', wpm, LANG === 'en' ? { lang: 'en' } : {}),
        message: SITE_LANG === 'en' ? `I typed ${wpm} words per minute! Can you beat me?` : `הקלדתי ${wpm} מילים לדקה ${IN_LANG} ⌨️ תצליחו לנצח אותי?`,
      })));
      $('#again').onclick = () => start();
      $('#same').onclick = () => start(true);
      Celebrate.show(reward);
      if ($('#save-login')) $('#save-login').onclick = () => openAuth();
    }

    $('#restart').onclick = () => start();
    Page.onKey = e => {
      if (e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); start(); return; }
      if (!$('#stage').hidden && typer) typer.handleKey(e);
    };
    Page.onLeave = () => typer && typer.destroy();
    renderConfig();
    start();
  }

  // ---------- Lessons list ----------
  function viewLessons() {
    document.title = SITE_LANG === 'en' ? `Touch Typing Lessons: ${LESSONS.length} Step-by-Step Lessons | Hakladaivrit` : `שיעורי הקלדה עיוורת ${IN_LANG}: ${LESSONS.length} שיעורים מדורגים | הקלדה עיוורת`;
    const prog = l => lessonProg(Account.data, l);
    const done = LESSONS.filter(l => prog(l)?.stars).length;
    const pct = Math.round((done / LESSONS.length) * 100);
    const groups = [...new Set(LESSONS.map(l => l.group))];
    const typeLabel = { words: tr('מילים נפוצות', 'Common words'), sentences: tr('משפטים שלמים', 'Full sentences'), quotes: tr('ציטוטים', 'Quotes'), prefixes: tr('תחיליות', 'Prefixes'), caps: 'Shift', review: tr('חזרה', 'Review') };
    const custom = customLessons(analyze(Account.data));
    view.innerHTML = `
      <section class="page">
        <div class="lessons-top page-head">
          <div>
            <h1>${tr('שיעורי הקלדה', 'Touch Typing Lessons')}</h1>
            <p>${tr('מתחילים בשורת הבית, ומשם כל שיעור מוסיף שני מקשים חדשים, מהאותיות הנפוצות אל הנדירות. כל קבוצה נגמרת בשיעור חזרה.', 'Start with the home row, then each lesson adds two new keys, from common letters to rare ones. Each group ends with a review lesson.')}</p>
          </div>
          <div class="overall">
            <span class="pct">${pct}%</span>
            <div><div class="progress"><div class="bar" style="width:${pct}%"></div></div><div style="font-size:.85rem">${done} ${tr('מתוך', 'of')} ${LESSONS.length} ${tr('שיעורים', 'lessons')}</div></div>
          </div>
        </div>
        ${Ads.slot('lessons')}
        ${custom.length ? `
          <h2 class="section-title">${ICON.sparkle} ${tr('השיעורים האישיים שלך', 'Your personalized lessons')}</h2>
          <div class="lesson-grid">${custom.map(customCard).join('')}</div>` : ''}
        <div class="kb-wrap" id="lkb"></div>
        ${fingerLegend()}
        ${groups.map(g => `
          <h2 class="section-title">${g}</h2>
          <div class="lesson-grid">
            ${LESSONS.filter(l => l.group === g).map(l => {
              const p = prog(l);
              const keys = l.newKeys.length
                ? `<div class="lc-keys">${l.newKeys.map(k => `<span class="kc">${esc(k)}</span>`).join('')}</div>`
                : `<div class="lc-type">${typeLabel[l.type] || typeLabel.review}</div>`;
              return `<a class="lesson-card${p && p.stars ? ' done' : ''}" href="/lesson/${l.id}">
                <div class="lc-top"><span class="lc-num">${String(l.id).padStart(2, '0')}</span>${starsHtml(p ? p.stars : 0)}</div>
                <div class="lc-title">${esc(l.title)}</div>
                ${keys}
                ${p ? `<div class="lc-best">${tr('שיא', 'Best')}: <span class="num">${p.wpm}</span> ${tr('מילים לדקה', 'words per minute')} · <span class="num">${p.acc}%</span> ${tr('דיוק', 'accuracy')}</div>` : ''}
              </a>`;
            }).join('')}
          </div>`).join('')}
        <div id="page-info"></div>
      </section>`;
    Keyboard($('#lkb'), { colored: true, hands: Prefs.hands });
    fillInfo('lessons');
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
  function runLesson({ docTitle, meta, title, desc, focusKeys, dimTo, makeText, target, save, next, strict = true, about = '' }) {
    document.title = docTitle;
    view.innerHTML = `
      <section class="page">
        <div class="lesson-head">
          <a class="back" href="/lessons">${tr('→ כל השיעורים', '← All lessons')}</a>
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
        ${about}
      </section>`;

    let kb = null, typer = null, hintTimer = 0;
    function buildKeyboard() {
      kb = Keyboard($('#kbw'), { colored: true, hands: Prefs.hands });
      if (dimTo) kb.dimExcept(dimTo);
      kb.mark(focusKeys, 'focus');
      $('#stage').classList.toggle('blind', Prefs.blind);
      if (typer) update(typer);
    }
    $('#tools').append(handsButton(buildKeyboard), blindButton(buildKeyboard));

    function update(tp) {
      const ch = tp.nextChar();
      const finger = kb.highlight(ch);
      $('#bar').style.width = (tp.pos / tp.chars.length) * 100 + '%';
      const hint = $('#hint');
      hint.innerHTML = ch == null ? '' :
        `${tr('הקישו', 'Press')} <span class="hint-key">${ch === ' ' ? tr('רווח', 'Space') : esc(ch)}</span> ${tr('עם', 'with')} <span class="hint-finger">${FINGER_NAMES[finger] || ''}</span>`;
      // In blind mode the hint waits: it shows only when the next key takes a while to find.
      clearTimeout(hintTimer);
      hint.classList.remove('reveal');
      if (Prefs.blind && ch != null) hintTimer = setTimeout(() => hint.classList.add('reveal'), 1500);
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
        strict,
        onUpdate: update,
        onPress: (code, ok) => kb.flash(code, ok),
        onFinish: finish,
      });
    }

    function finish(s, tp) {
      const wpm = Math.round(s.wpm);
      const acc = Math.round(s.acc);
      const stars = acc >= 97 && wpm >= target ? 3 : acc >= 92 ? 2 : 1;
      const { reward } = save(tp, stars);
      const note = stars === 3 ? tr('מעולה! עברתם את השיעור בהצטיינות.', 'Excellent! You completed the lesson perfectly.')
        : stars === 2 ? tr(`יפה מאוד. לשלושה כוכבים: דיוק של 97% ומעלה ולפחות ${target} מילים לדקה.`, `Very good. For three stars: 97% accuracy or higher and at least ${target} words per minute.`)
        : tr('סיימתם את השיעור! נסו שוב והתמקדו בדיוק, לאט ובטוח.', 'You completed the lesson! Try again and focus on accuracy—slow and steady.');
      $('#stage').hidden = true;
      const r = $('#result');
      r.hidden = false;
      r.innerHTML = `
        ${starsHtml(stars, 'big')}
        <h2 class="result-title">${tr('הושלם', 'Completed')}: ${esc(title)}</h2>
        <p class="result-note">${note}</p>
        <div class="result-top">
          ${statBox(tr('מילים לדקה', 'Words per minute'), wpm, true)}
          ${statBox(tr('דיוק', 'Accuracy'), acc + '%', true)}
        </div>
        <div class="result-grid">
          ${statBox(tr('תווים לדקה', 'Characters per minute'), Math.round(s.cpm))}
          ${statBox(tr('זמן', 'Time'), fmtTime(s.secs))}
          ${statBox(tr('טעויות', 'Errors'), s.errors)}
          ${statBox(tr('יעד מהירות', 'Speed target'), target)}
        </div>
        ${missedHtml(s.charStats)}
        <div class="actions">
          ${next ? `<a class="btn primary" href="${next.href}">${next.label} ${ICON.next}</a>` : ''}
          <button class="btn" id="again">${ICON.restart} ${tr('שוב', 'Again')}</button>
          <a class="btn ghost" href="/lessons">${tr('כל השיעורים', 'All lessons')}</a>
        </div>
        ${Ads.slot('results')}`;
      Ads.fill(r);
      $('#result .actions').append(Share.button(() => ({
        title,
        big: wpm,
        unit: tr('מילים לדקה', 'words per minute'),
        chips: ['⭐'.repeat(stars), `${tr('דיוק', 'Accuracy')} ${acc}%`],
        url: `${location.origin}${location.pathname}`,
        message: SITE_LANG === 'en' ? `I completed "${title}" in the touch typing course ${'⭐'.repeat(stars)}` : `סיימתי את "${title}" בקורס ההקלדה העיוורת בעברית ${'⭐'.repeat(stars)}`,
      })));
      $('#again').onclick = start;
      Celebrate.show(reward);
    }

    Page.onKey = e => {
      if (e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); start(); return; }
      if (!$('#stage').hidden && typer) typer.handleKey(e);
      else if (e.key === 'Enter' && next) navigate(next.href);
    };
    Page.onLeave = () => { clearTimeout(hintTimer); if (typer) typer.destroy(); };
    start();
  }

  // ---------- What a lesson teaches ----------
  // Shown under the exercise: the new keys and the fingers that press them, words from the
  // lesson and the lessons around it. It also gives every lesson page its own text for search engines.
  const ROW_OF_CODE = {};
  KEY_ROWS.forEach((row, ri) => row.forEach(([code]) => { ROW_OF_CODE[code] = ri; }));

  function lessonSamples(lesson, idx) {
    switch (lesson.type) {
      case 'words': return WORDS.slice(0, 30);
      case 'sentences': return SENTENCES.slice(0, 6);
      case 'quotes': return QUOTES.slice(0, 6).map(q => `${q.text} (${q.source})`);
      case 'shift': return SHIFT_PHRASES.slice(0, 12);
      case 'marks': return MARK_WORDS.slice(0, 16);
      case 'finals': return FINAL_PAIRS.slice(0, 12);
      case 'prefixes': return PREFIXED.slice(0, 24);
      case undefined: {
        const allowed = new Set(lessonLetters(idx));
        const focus = lesson.review ? groupLetters(idx) : lesson.newKeys.filter(isLangLetter);
        return LESSON_POOL.filter(w => [...w].every(c => allowed.has(c)) && [...w].some(c => focus.includes(c))).slice(0, 24);
      }
      default: return [];
    }
  }

  function lessonAbout(lesson, idx) {
    const keys = lesson.newKeys.filter(k => REVERSE[k]).map(k => {
      const { code, shift } = REVERSE[k];
      const enKey = `${shift ? 'Shift + ' : ''}${EN_KEYS[code][0].toUpperCase()}`;
      return `<tr><td>${esc(k)}</td><td>${FINGER_NAMES[FINGER[code]]}</td><td>${ROW_NAMES[ROW_OF_CODE[code]]}</td>${LANG === 'en' || SITE_LANG === 'en' ? '' : `<td dir="ltr">${esc(enKey)}</td>`}</tr>`;
    }).join('');
    const letters = lesson.type ? [] : lessonLetters(idx);
    const samples = lessonSamples(lesson, idx);
    const asList = ['sentences', 'quotes', 'shift'].includes(lesson.type);
    const prev = LESSONS[idx - 1], next = LESSONS[idx + 1];
    const link = l => `<a href="/lesson/${l.id}">${SITE_LANG === 'en' ? `Lesson ${l.id}: ${esc(l.title)}` : `שיעור ${l.id}: ${esc(l.title)}`}</a>`;
    return `
      <div class="page-info content">
        <h2>${tr(`מה לומדים בשיעור ${lesson.id}`, `What you learn in lesson ${lesson.id}`)}</h2>
        <p>${SITE_LANG === 'en' ? `This lesson is part of "${esc(lesson.group)}" in the course of ${LESSONS.length} lessons. For three stars, you need 97% accuracy or higher and at least ${lesson.target} words per minute.` : `השיעור שייך לפרק "${esc(lesson.group)}" בקורס של ${LESSONS.length} שיעורים. לשלושה כוכבים צריך דיוק של 97% ומעלה ולפחות ${lesson.target} מילים לדקה.`}</p>
        ${keys ? `<h3>${SITE_LANG === 'en' ? 'New keys' : 'המקשים החדשים'}</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>${SITE_LANG === 'en' ? 'Key' : 'מקש'}</th><th>${SITE_LANG === 'en' ? 'Finger' : 'אצבע'}</th><th>${SITE_LANG === 'en' ? 'Row' : 'שורה'}</th>${LANG === 'en' || SITE_LANG === 'en' ? '' : `<th>${tr('המקש באנגלית', 'English key')}</th>`}</tr></thead>
          <tbody>${keys}</tbody>
        </table></div>` : ''}
        ${letters.length ? `<p>${SITE_LANG === 'en' ? `Letters you've learned so far (${letters.length}): ${letters.map(esc).join(' ')}` : `האותיות שלמדתם עד עכשיו (${letters.length}): ${letters.map(esc).join(' ')}`}</p>` : ''}
        ${!samples.length ? '' : asList
          ? `<h3>${SITE_LANG === 'en' ? 'Examples from the lesson' : 'דוגמאות מהשיעור'}</h3><ul>${samples.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`
          : `<h3>${SITE_LANG === 'en' ? 'Words from the lesson' : 'מילים מהשיעור'}</h3><p>${samples.map(esc).join(' · ')}</p>`}
        <h3>${SITE_LANG === 'en' ? 'Nearby lessons' : 'השיעורים הסמוכים'}</h3>
        <ul>
          ${prev ? `<li>${SITE_LANG === 'en' ? 'Previous lesson: ' : 'השיעור הקודם: '}${link(prev)}</li>` : ''}
          ${next ? `<li>${SITE_LANG === 'en' ? 'Next lesson: ' : 'השיעור הבא: '}${link(next)}</li>` : ''}
          <li><a href="/lessons">${SITE_LANG === 'en' ? 'All lessons' : 'כל השיעורים'}</a> · <a href="/guide">${SITE_LANG === 'en' ? 'Touch Typing Guide' : 'מדריך הקלדה עיוורת'}</a> · <a href="/test">${SITE_LANG === 'en' ? 'Typing Test' : 'מבחן הקלדה'}</a></li>
        </ul>
      </div>`;
  }

  function viewLesson(id) {
    const idx = LESSONS.findIndex(l => l.id === id);
    if (idx < 0) { navigate('/lessons'); return; }
    const lesson = LESSONS[idx];
    const nextLesson = LESSONS[idx + 1];
    runLesson({
      docTitle: SITE_LANG === 'en' ? `Lesson ${id}: ${lesson.title} | Hakladaivrit` : `שיעור ${id}: ${lesson.title} | הקלדה עיוורת`,
      meta: `${SITE_LANG === 'en' ? 'Lesson' : 'שיעור'} ${id} ${tr('מתוך', 'of')} ${LESSONS.length} · ${esc(lesson.group)}`,
      title: lesson.title,
      desc: lesson.desc,
      focusKeys: lesson.review ? groupLetters(idx) : lesson.newKeys,
      dimTo: lesson.type ? null : [...lessonKeys(idx), ' '],
      makeText: () => lessonText(lesson, idx),
      target: lesson.target,
      save: (tp, stars) => Account.record(tp.report({ kind: 'lesson', mode: `lesson-${lesson.pid}`, label: SITE_LANG === 'en' ? `Lesson ${id}` : `שיעור ${id}${LANG === 'en' ? ' · אנגלית' : ''}`, lessonId: lesson.pid, stars })),
      next: nextLesson ? { href: `/lesson/${nextLesson.id}`, label: tr('לשיעור הבא', 'Next lesson') } : { href: '/profile', label: tr('לניתוח הביצועים', 'Performance analysis') },
      // The real-typing lessons let you type past a mistake and fix it, as in real typing.
      strict: !lesson.free,
      about: lessonAbout(lesson, idx),
    });
  }

  function viewCustom(id) {
    const lesson = customLessons(analyze(Account.data)).find(l => l.id === id);
    if (!lesson) { navigate('/profile'); return; }
    runLesson({
      docTitle: SITE_LANG === 'en' ? `${lesson.title} | Hakladaivrit` : `${lesson.title} | הקלדה עיוורת`,
      meta: `${ICON.sparkle} ${SITE_LANG === 'en' ? 'Personalized lesson built from your data' : 'שיעור מותאם אישית שנבנה מתוך הנתונים שלך'}`,
      title: lesson.title,
      desc: lesson.desc,
      focusKeys: lesson.keys,
      dimTo: null,
      makeText: () => customLessonText(lesson),
      target: lesson.target,
      save: tp => Account.record(tp.report({ kind: 'custom', mode: `custom-${id}`, label: lesson.title })),
      next: { href: '/profile', label: tr('לניתוח המעודכן', 'Updated analysis') },
    });
  }

  // ---------- Practice ----------
  function viewPractice() {
    document.title = SITE_LANG === 'en' ? 'Typing Practice That Targets Your Weak Keys | Hakladaivrit' : `תרגול הקלדה ${IN_LANG} שמתמקד במקשים החלשים שלכם | הקלדה עיוורת`;
    const cfg = Object.assign({ mode: 'weak', noMistakes: true }, Store.get('practiceCfg', {}));
    const MODE_NAMES = { weak: tr('מקשים חלשים', 'Weak keys'), adaptive: tr('פתיחת אותיות', 'Letter unlock'), common: tr('מילים נפוצות', 'Common words'), sentences: tr('משפטים', 'Sentences') };
    const adaptive = () => cfg.mode === 'adaptive';
    view.innerHTML = `
      <section class="page">
        <div class="config" id="config"></div>
        <div class="ad-panel" id="ad-panel" hidden></div>
        <div class="banner" id="banner" hidden></div>
        <div class="stage" id="stage">
          <div class="live"><span class="live-main num" id="live-main"></span><span class="live-sub" id="live-sub"></span></div>
          <div class="typing-box idle" id="tb"></div>
          <div class="under"><button class="icon-btn restart" id="restart" aria-label="${tr('סבב חדש', 'New round')}" title="${tr('סבב חדש (Tab)', 'New round (Tab)')}">${ICON.restart}</button></div>
          <div class="kb-wrap" id="kbw"></div>
        </div>
        <div class="result" id="result" hidden></div>
        ${touchNote()}

        <h2 class="section-title">${tr('מפת הטעויות שלכם', 'Your error map')}</h2>
        <div class="weak-row">
          <div id="weak"></div>
          <div><a class="btn ghost" href="/profile">${tr('לניתוח המלא', 'Full analysis')}</a><button class="btn ghost" id="reset-stats">${tr('איפוס נתונים', 'Reset data')}</button></div>
        </div>
        <div class="kb-wrap" id="heat" style="margin-top:0"></div>
        <div class="legend"><span>${tr('מדויק', 'Accurate')}</span><span class="heat-scale"></span><span>${tr('הרבה טעויות', 'Many errors')}</span></div>
        <div id="page-info"></div>
      </section>`;
    fillInfo('practice');

    let typer = null, kb = null, round = 1;
    const heatKb = Keyboard($('#heat'));
    const weakLetters = () => analyze(Account.data).weakKeys.map(k => k.ch).filter(isLangLetter);

    function refreshHeat() {
      heatKb.heat(Account.data.keyStats);
      const weak = weakLetters();
      $('#weak').innerHTML = weak.length
        ? `<span style="color:var(--c-sub-alt)">${tr('האותיות החלשות שלכם: ', 'Your weak keys: ')}</span><span class="chips" style="display:inline-flex">${weak.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</span>`
        : `<span style="color:var(--c-sub-alt)">${tr('עדיין אין מספיק נתונים. הקלידו קצת והמפה תתמלא.', 'Not enough data yet. Type a bit and the map will fill up.')}</span>`;
    }

    function renderConfig() {
      const b = (attr, val, label, active) => `<button class="cfg-btn${active ? ' active' : ''}" data-${attr}="${val}">${label}</button>`;
      $('#config').innerHTML = `
        <div class="cfg-group">
          ${Object.entries(MODE_NAMES).map(([k, n]) => b('mode', k, n, cfg.mode === k)).join('')}
        </div>
        <div class="cfg-sep"></div>
        ${adaptive() ? `<div class="cfg-sep"></div><div class="cfg-group">${[20, 25, 30, 40].map(wpmTarget => b('target', wpmTarget, `${wpmTarget} wpm`, Adaptive.state().target === wpmTarget)).join('')}</div>` : ''}
        <div class="cfg-sep"></div>
        <div class="cfg-group" id="view-group">${b('toggle', 'noMistakes', tr('ללא טעויות', 'No mistakes'), cfg.noMistakes)}</div>`;
      $('#view-group').append(handsButton(buildKeyboard));
    }
    $('#config').addEventListener('click', e => {
      const t = e.target.closest('button[data-mode], button[data-toggle], button[data-target]');
      if (!t) return;
      if (t.dataset.mode) cfg.mode = t.dataset.mode;
      if (t.dataset.toggle) cfg.noMistakes = !cfg.noMistakes;
      if (t.dataset.target) { const s = Adaptive.state(); s.target = Number(t.dataset.target); Adaptive.save(s); }
      Store.set('practiceCfg', cfg);
      renderConfig();
      start();
    });

    // The letter-unlocking panel: every letter in the order it opens, filled by its progress
    // toward the target. The letter the round concentrates on is outlined.
    function renderAdaptive() {
      const el = $('#ad-panel');
      el.hidden = !adaptive();
      if (!adaptive()) return;
      const s = Adaptive.state();
      const focus = Adaptive.focus(s);
      const noteText = SITE_LANG === 'en'
        ? `${s.n} of ${ADAPTIVE_ORDER.length} letters unlocked in order of frequency. The next letter unlocks when all open letters reach ${s.target} words per minute at 95% accuracy. Each round focuses on <b>${esc(focus)}</b>, the letter furthest from target. <button class="link-btn" id="ad-reset">Start over</button>`
        : `פתוחות ${s.n} מתוך ${ADAPTIVE_ORDER.length} אותיות, לפי סדר השכיחות. האות הבאה נפתחת כשכל האותיות הפתוחות מגיעות ל־${s.target} מילים לדקה בדיוק של 95%. בכל סבב מתמקדים באות <b>${esc(focus)}</b>, הרחוקה ביותר מהיעד. <button class="link-btn" id="ad-reset">להתחיל מחדש</button>`;
      el.innerHTML = `
        <div class="ad-letters">${ADAPTIVE_ORDER.map((ch, i) => {
          if (i >= s.n) return `<span class="ad-l locked">${esc(ch)}</span>`;
          const p = Math.round(Adaptive.progress(s, ch) * 100);
          return `<span class="ad-l${p >= 100 ? ' ready' : ''}${ch === focus ? ' focus' : ''}" style="--p:${p}%" title="${p}%">${esc(ch)}</span>`;
        }).join('')}</div>
        <p class="ad-note">${noteText}</p>`;
      $('#ad-reset').onclick = () => { Adaptive.reset(s.target); renderAdaptive(); start(); };
    }

    function buildKeyboard() {
      kb = Keyboard($('#kbw'), { hands: Prefs.hands });
      if (adaptive()) kb.dimExcept([...Adaptive.open(Adaptive.state()), ' ']);
      if (typer) kb.highlight(typer.nextChar());
    }

    function freshText(n = 25) {
      if (adaptive()) return Adaptive.text(Adaptive.state());
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
      $('#live-sub').textContent = cfg.noMistakes ? `${tr('סבב', 'Round')} ${round}` : (tp.startTime && s.secs > 1 ? `${Math.round(s.wpm)} wpm` : '');
    }

    function start(text, keepRound) {
      if (!keepRound) { round = 1; banner(''); }
      renderAdaptive();
      if (!text && cfg.mode === 'weak' && !weakLetters().length) {
        banner(tr('עוד אין מספיק נתונים על המקשים החלשים שלכם, אז בינתיים מתרגלים מילים נפוצות.', 'Not enough data on your weak keys yet, so for now practicing common words.'), true);
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
      const { reward } = Account.record(tp.report({ kind: 'practice', mode: `practice-${cfg.mode}`, label: SITE_LANG === 'en' ? `Practice: ${MODE_NAMES[cfg.mode]}` : `תרגול: ${MODE_NAMES[cfg.mode]}` }));
      Celebrate.show(reward);
      refreshHeat();
      // Letter unlocking runs round after round, like keybr: the next round starts at once.
      if (adaptive()) {
        const opened = Adaptive.update(Adaptive.state(), s.charStats);
        round++;
        banner(opened
          ? SITE_LANG === 'en' ? `New letter unlocked: <b>${esc(opened)}</b>! All previous letters reached target.` : `נפתחה אות חדשה: <b>${esc(opened)}</b>! כל האותיות הקודמות הגיעו ליעד.`
          : SITE_LANG === 'en' ? `Round ${round - 1}: ${Math.round(s.wpm)} words per minute, ${Math.round(s.acc)}% accuracy.` : `סבב ${round - 1}: ${Math.round(s.wpm)} מילים לדקה, דיוק ${Math.round(s.acc)}%.`, !!opened);
        start(null, true);
        return;
      }
      if (cfg.noMistakes && s.errors > 0) {
        const missedWords = [...new Set(tp.errorWords())];
        round++;
        const errorMsg = s.errors === 1 ? tr('טעות אחת', '1 mistake') : `${s.errors} ${tr('טעויות', 'mistakes')}`;
        const bannerMsg = SITE_LANG === 'en'
          ? `Round ${round - 1}: ${errorMsg} (${Math.round(s.wpm)} words per minute). Repeating words with mistakes. Continue until a round with no mistakes.`
          : `סבב ${round - 1}: ${errorMsg} (${Math.round(s.wpm)} מילים לדקה). המילים שבהן טעיתם חוזרות. ממשיכים עד סבב בלי אף טעות.`;
        banner(bannerMsg);
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
      const resultTitle = cfg.noMistakes
        ? (round > 1 ? (SITE_LANG === 'en' ? `Perfect round after ${round} rounds!` : `סבב מושלם אחרי ${round} סבבים!`) : (SITE_LANG === 'en' ? 'Perfect round on first try!' : 'סבב מושלם בניסיון הראשון!'))
        : (SITE_LANG === 'en' ? 'Practice complete' : 'התרגול הסתיים');
      r.innerHTML = `
        <h2 class="result-title">${resultTitle}</h2>
        <div class="result-top">
          ${statBox(tr('מילים לדקה', 'Words per minute'), Math.round(s.wpm), true)}
          ${statBox(tr('דיוק', 'Accuracy'), Math.round(s.acc) + '%', true)}
        </div>
        <div class="result-grid">
          ${statBox(tr('תווים לדקה', 'Characters per minute'), Math.round(s.cpm))}
          ${statBox(tr('זמן', 'Time'), fmtTime(s.secs))}
          ${statBox(tr('טעויות', 'Errors'), s.errors)}
          ${statBox(tr('מילים', 'Words'), tp.wordCount)}
        </div>
        ${missedHtml(s.charStats)}
        <div class="actions"><button class="btn primary" id="again">${ICON.restart} ${tr('תרגול נוסף', 'More practice')}</button><a class="btn ghost" href="/profile">${tr('לניתוח הביצועים', 'My performance')}</a></div>
        ${Ads.slot('results')}`;
      Ads.fill(r);
      $('#again').onclick = () => start();
    }

    $('#restart').onclick = () => start();
    $('#reset-stats').onclick = async () => {
      try { await Account.resetStats(); refreshHeat(); toast(tr('נתוני המקשים אופסו', 'Key stats reset')); } catch (e) { toast(e.message, true); }
    };
    Page.onKey = e => {
      if (e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); start(); return; }
      if (!$('#stage').hidden && typer) typer.handleKey(e);
    };
    Page.onLeave = () => typer && typer.destroy();
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
    const trend = a.trend;
    if (trend.prevWpm != null && trend.recentWpm != null) {
      const diff = Math.round(trend.recentWpm - trend.prevWpm);
      if (diff >= 1) good.push(SITE_LANG === 'en' ? `Your speed improved by ${diff} words per minute in the last 10 tests.` : `המהירות שלך עלתה ב־${diff} מילים לדקה ב־10 המבחנים האחרונים.`);
      else if (diff <= -2) bad.push(SITE_LANG === 'en' ? `Your average speed dropped by ${-diff} words per minute compared to the previous 10 tests.` : `המהירות הממוצעת ירדה ב־${-diff} מילים לדקה לעומת 10 המבחנים הקודמים.`);
    }
    if (a.overall.acc != null && a.overall.total >= 100) {
      if (a.overall.acc >= 0.96) good.push(SITE_LANG === 'en' ? `High overall accuracy: ${pct(a.overall.acc)} of all keypresses.` : `דיוק כללי גבוה: ${pct(a.overall.acc)} מכל ההקשות.`);
      else bad.push(SITE_LANG === 'en' ? `Your overall accuracy is ${pct(a.overall.acc)}. Try slowing down a bit—accuracy comes before speed.` : `הדיוק הכללי שלך ${pct(a.overall.acc)}. נסו להאט מעט, כי דיוק קודם למהירות.`);
    }
    if (a.strongestFinger) good.push(SITE_LANG === 'en' ? `Your strongest finger: ${a.strongestFinger.name} (${pct(a.strongestFinger.acc)} accuracy).` : `האצבע החזקה שלך: ${a.strongestFinger.name} (${pct(a.strongestFinger.acc)} דיוק).`);
    if (a.strongKeys.length) good.push(SITE_LANG === 'en' ? `Your accurate and fast keys: ${a.strongKeys.map(k => k.ch).join(' ')}.` : `המקשים המדויקים והמהירים שלך: ${a.strongKeys.map(k => k.ch).join(' ')}.`);
    const doneLessons = LESSONS.filter(l => lessonProg(d, l)?.stars).length;
    if (doneLessons) good.push(SITE_LANG === 'en' ? `You completed ${doneLessons} of ${LESSONS.length} lessons.` : `השלמת ${doneLessons} מתוך ${LESSONS.length} שיעורים.`);

    if (a.weakKeys.length) bad.push(SITE_LANG === 'en' ? `Low accuracy on keys: ${a.weakKeys.map(k => `${k.ch} (${pct(k.acc)})`).join(', ')}.` : `דיוק נמוך במקשים: ${a.weakKeys.map(k => `${k.ch} (${pct(k.acc)})`).join(', ')}.`);
    if (a.slowKeys.length) bad.push(SITE_LANG === 'en' ? `Slow keys: ${a.slowKeys.map(k => `${k.ch} (${Math.round(k.ms)}ms)`).join(', ')}, versus an average of ${Math.round(a.overall.ms)}ms.` : `מקשים איטיים: ${a.slowKeys.map(k => `${k.ch} (${Math.round(k.ms)}ms)`).join(', ')}, לעומת ממוצע של ${Math.round(a.overall.ms)}ms.`);
    if (a.weakestFinger) bad.push(SITE_LANG === 'en' ? `Your weakest finger: ${a.weakestFinger.name} (${pct(a.weakestFinger.acc)} accuracy).` : `האצבע החלשה ביותר: ${a.weakestFinger.name} (${pct(a.weakestFinger.acc)} דיוק).`);
    if (a.weakestRow) bad.push(SITE_LANG === 'en' ? `Your weakest row: ${a.weakestRow.name} (${pct(a.weakestRow.acc)} accuracy).` : `השורה החלשה ביותר: ${a.weakestRow.name} (${pct(a.weakestRow.acc)} דיוק).`);
    if (a.problemWords.length) bad.push(SITE_LANG === 'en' ? `Words with repeated mistakes: ${a.problemWords.slice(0, 6).join(', ')}.` : `מילים שחוזרות על טעויות: ${a.problemWords.slice(0, 6).join(', ')}.`);
    return { good, bad };
  }

  // Level, XP bar, streak and all badges (earned ones lit up).
  function levelCard(d) {
    const g = Gamify.summary(d);
    const earned = Gamify.state(d).badges;
    const got = Gamify.BADGES.filter(b => earned[b[0]]).length;
    return `
      <div class="level-card">
        <div class="lv-emoji">${g.rank.emoji}</div>
        <div class="lv-body">
          <div class="lv-title">${SITE_LANG === 'en' ? `Level ${g.level}` : `רמה ${g.level}`} · ${esc(g.rank.name)}</div>
          <div class="xp-bar" role="progressbar" aria-valuenow="${Math.round(g.levelProgress * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.round(g.levelProgress * 100)}%"></span></div>
          <div class="muted small">${SITE_LANG === 'en' ? `${g.toNext.toLocaleString('en-US')} XP more for level ${g.level + 1} · ${g.xp.toLocaleString('en-US')} XP total` : `עוד <b class="num">${g.toNext.toLocaleString('he-IL')}</b> XP לרמה ${g.level + 1} · סך הכל <span class="num">${g.xp.toLocaleString('he-IL')}</span> XP`}</div>
        </div>
        <div class="lv-side">
          <div class="lv-stat">${ICON.flame}<b class="num">${g.streak}</b><span>${SITE_LANG === 'en' ? 'days in a row' : 'ימים ברצף'}</span></div>
          <div class="lv-stat goal"><span class="gc-goal big" style="--p:${Math.round(g.goalProgress * 100)}"></span><span><b class="num">${g.today}/${g.goal}</b> XP ${SITE_LANG === 'en' ? 'today' : 'היום'}</span></div>
        </div>
      </div>
      <h2 class="section-title">🏅 ${SITE_LANG === 'en' ? 'Badges' : 'תגים'} <span class="muted small num">${got}/${Gamify.BADGES.length}</span></h2>
      <div class="badges">${Gamify.BADGES.map(([id, emoji, title, how]) => `
        <div class="badge${earned[id] ? ' on' : ''}" title="${esc(how)}">
          <span class="bd-emoji">${earned[id] ? emoji : '🔒'}</span>
          <b>${esc(title)}</b>
          <span class="muted small">${esc(how)}</span>
        </div>`).join('')}</div>`;
  }

  function viewProfile() {
    document.title = SITE_LANG === 'en' ? 'My Stats | Hakladaivrit' : 'הפרופיל שלי | הקלדה עיוורת';
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
    const lessonsDone = LESSONS.filter(l => lessonProg(d, l)?.stars).length;
    const recentRows = d.history.slice(-15).reverse();

    view.innerHTML = `
      <section class="page">
        <div class="page-head profile-head">
          <div>
            <h1>${user ? esc(displayName(user)) : (SITE_LANG === 'en' ? 'My profile' : 'הפרופיל שלי')}</h1>
            <p>${user ? `<span class="num">${esc(user.email)}</span> · ${SITE_LANG === 'en' ? 'Your progress is saved to your account and synced across devices.' : 'ההתקדמות שלך נשמרת בחשבון ומסונכרנת בין מכשירים.'}`
              : (SITE_LANG === 'en' ? 'You\'re practicing as a guest. Data is saved only in this browser.' : 'את/ה מתרגל/ת כאורח, והנתונים נשמרים רק בדפדפן הזה.')}</p>
          </div>
          <div class="profile-actions">
            ${user ? `<button class="btn ghost" id="logout">${tr('התנתקות', 'Sign out')}</button>`
              : Account.online ? `<button class="btn primary" id="login-cta">${tr('התחברות עם Google לשמירת ההתקדמות', 'Sign in with Google to save progress')}</button>`
              : `<span class="muted">${tr('כדי לשמור תוצאות בחשבון יש להריץ את האתר עם השרת (npm run dev).', 'To save results to an account, run the site with a server (npm run dev).')}</span>`}
          </div>
        </div>

        ${levelCard(d)}
        ${!d.history.length ? `
          <div class="panel empty">
            <h2>${SITE_LANG === 'en' ? 'No data yet' : 'עוד אין נתונים'}</h2>
            <p>${SITE_LANG === 'en' ? 'Take a typing test or complete your first lesson, and your personal analysis will appear here.' : 'עשו מבחן הקלדה או שיעור ראשון, והניתוח האישי שלכם יופיע כאן.'}</p>
            <div class="actions"><a class="btn primary" href="/test">${SITE_LANG === 'en' ? 'Typing test' : 'למבחן הקלדה'}</a><a class="btn" href="/lesson/1">${SITE_LANG === 'en' ? 'First lesson' : 'לשיעור הראשון'}</a></div>
          </div>` : `
        <div class="tiles">
          ${tile(SITE_LANG === 'en' ? 'Peak speed' : 'מהירות שיא', a.trend.best ? Math.round(a.trend.best) : '-', SITE_LANG === 'en' ? 'words per minute in test' : 'מילים לדקה במבחן')}
          ${tile(SITE_LANG === 'en' ? 'Average (last 10)' : 'ממוצע 10 מבחנים', a.trend.recentWpm != null ? Math.round(a.trend.recentWpm) : '-',
            delta != null ? `<span class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}</span> ${SITE_LANG === 'en' ? 'vs. previous 10' : 'לעומת 10 הקודמים'}` : (SITE_LANG === 'en' ? 'words per minute' : 'מילים לדקה'))}
          ${tile(SITE_LANG === 'en' ? 'Average accuracy' : 'דיוק ממוצע', recent.length ? Math.round(avgOf(recent, 'acc')) + '%' : a.overall.acc != null ? Math.round(a.overall.acc * 100) + '%' : '-', recent.length ? (SITE_LANG === 'en' ? 'last 10 tests' : '10 מבחנים אחרונים') : (SITE_LANG === 'en' ? 'all keystrokes' : 'כל ההקשות'))}
          ${tile(SITE_LANG === 'en' ? 'Typing time' : 'זמן הקלדה', fmtTime(d.totals.secs || 0), `${d.totals.count || d.history.length} ${SITE_LANG === 'en' ? 'sessions' : 'אימונים'}`)}
          ${tile(SITE_LANG === 'en' ? 'Lessons' : 'שיעורים', `${lessonsDone}/${LESSONS.length}`, SITE_LANG === 'en' ? 'completed' : 'הושלמו')}
        </div>

        ${progressSection()}

        <div class="two-col">
          <div class="panel">
            <h2>${SITE_LANG === 'en' ? 'Strengths' : 'חוזקות'}</h2>
            ${good.length ? `<ul class="insights good">${good.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : `<p class="muted">${SITE_LANG === 'en' ? 'Keep practicing, and strengths will appear here.' : 'המשיכו להתאמן, והחוזקות יופיעו כאן.'}</p>`}
          </div>
          <div class="panel">
            <h2>${SITE_LANG === 'en' ? 'To improve' : 'לשיפור'}</h2>
            ${bad.length ? `<ul class="insights bad">${bad.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`
              : `<p class="muted">${a.enough ? (SITE_LANG === 'en' ? 'No significant weaknesses—great job!' : 'אין חולשות בולטות, כל הכבוד!') : (SITE_LANG === 'en' ? 'Need a bit more data (at least 150 keystrokes) to identify weaknesses.' : 'צריך עוד קצת נתונים (לפחות 150 הקשות) כדי לזהות חולשות.')}</p>`}
          </div>
        </div>

        <h2 class="section-title">${ICON.sparkle} ${SITE_LANG === 'en' ? 'Personalized lessons' : 'שיעורים מותאמים אישית'}</h2>
        ${custom.length ? `<div class="lesson-grid">${custom.map(customCard).join('')}</div>`
          : `<p class="muted">${a.enough ? (SITE_LANG === 'en' ? 'No significant weaknesses found. Try a longer test to challenge yourself.' : 'לא נמצאו חולשות משמעותיות. נסו מבחן ארוך יותר כדי לאתגר את עצמכם.') : (SITE_LANG === 'en' ? 'Personalized lessons will build after we collect enough data. Keep practicing!' : 'השיעורים האישיים ייבנו אחרי שנאסוף מספיק נתונים. המשיכו לתרגל!')}</p>`}

        <h2 class="section-title">${SITE_LANG === 'en' ? 'Accuracy map: keys and fingers' : 'מפת דיוק: מקשים ואצבעות'}</h2>
        <div class="kb-wrap" id="pkb" style="margin-top:0"></div>
        <div class="legend"><span>${SITE_LANG === 'en' ? 'Accurate' : 'מדויק'}</span><span class="heat-scale"></span><span>${SITE_LANG === 'en' ? 'Many errors' : 'הרבה טעויות'}</span></div>

        <div class="two-col" style="margin-top:2rem">
          <div class="panel">
            <h2>${SITE_LANG === 'en' ? 'By finger' : 'לפי אצבע'}</h2>
            <table class="table">
              <thead><tr><th>${SITE_LANG === 'en' ? 'Finger' : 'אצבע'}</th><th>${SITE_LANG === 'en' ? 'Accuracy' : 'דיוק'}</th><th>${SITE_LANG === 'en' ? 'Time per key' : 'זמן להקשה'}</th><th>${SITE_LANG === 'en' ? 'Presses' : 'הקשות'}</th></tr></thead>
              <tbody>${a.fingers.map(f => `<tr><td>${f.name}</td><td class="num">${f.acc != null ? Math.round(f.acc * 100) + '%' : '-'}</td><td class="num">${f.ms ? Math.round(f.ms) + 'ms' : '-'}</td><td class="num">${f.total}</td></tr>`).join('')}</tbody>
            </table>
          </div>
          <div class="panel">
            <h2>${SITE_LANG === 'en' ? 'By row' : 'לפי שורה'}</h2>
            <table class="table">
              <thead><tr><th>${SITE_LANG === 'en' ? 'Row' : 'שורה'}</th><th>${SITE_LANG === 'en' ? 'Accuracy' : 'דיוק'}</th><th>${SITE_LANG === 'en' ? 'Time per key' : 'זמן להקשה'}</th><th>${SITE_LANG === 'en' ? 'Presses' : 'הקשות'}</th></tr></thead>
              <tbody>${a.rows.map(r => `<tr><td>${r.name}</td><td class="num">${r.acc != null ? Math.round(r.acc * 100) + '%' : '-'}</td><td class="num">${r.ms ? Math.round(r.ms) + 'ms' : '-'}</td><td class="num">${r.total}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <h2>${SITE_LANG === 'en' ? 'Recent sessions' : 'אימונים אחרונים'}</h2>
          <table class="table">
            <thead><tr><th>${SITE_LANG === 'en' ? 'Date' : 'תאריך'}</th><th>${SITE_LANG === 'en' ? 'Type' : 'סוג'}</th><th>${SITE_LANG === 'en' ? 'Words per minute' : 'מילים לדקה'}</th><th>${SITE_LANG === 'en' ? 'Accuracy' : 'דיוק'}</th><th>${SITE_LANG === 'en' ? 'Time' : 'זמן'}</th></tr></thead>
            <tbody>${recentRows.map(h => `<tr>
              <td class="num">${fmtDate(h.at)}</td>
              <td>${esc(h.label && !(SITE_LANG === 'en' && /[א-ת]/.test(h.label)) ? h.label : KIND_NAMES[h.kind] || '')}${h.stars ? ' ' + starsHtml(h.stars) : ''}</td>
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
    mountProgress(d);
    const kb = Keyboard($('#pkb'), { hands: true });
    kb.heat(d.keyStats);
    const rates = {};
    a.fingers.forEach(f => { if (f.total >= 20) rates[f.f] = 1 - f.acc; });
    kb.hands.heat(rates);
  }

  // ---------- Admin dashboard (registered users; visitor stats are in Google Analytics) ----------
  function viewAdmin() {
    document.title = SITE_LANG === 'en' ? 'Admin | Hakladaivrit' : 'לוח ניהול | הקלדה עיוורת';
    if (!Account.user || !Account.user.isAdmin) {
      view.innerHTML = `<section class="page"><div class="panel empty"><h2>${SITE_LANG === 'en' ? 'No access' : 'אין הרשאה'}</h2>
        <p>${!Account.user ? (SITE_LANG === 'en' ? 'This page is only for site admins. Sign in with an admin account.' : 'הדף זמין רק למנהלי האתר. התחברו עם חשבון מנהל.')
          : (SITE_LANG === 'en' ? 'This account is not an admin. Add this email to ADMIN_EMAILS (in wrangler.jsonc, or .dev.vars locally) and redeploy.' : 'החשבון הזה אינו מנהל. הוסיפו את כתובת האימייל שלו ל־ADMIN_EMAILS (בקובץ wrangler.jsonc, או ‎.dev.vars במחשב) ופרסמו מחדש.')}</p></div></section>`;
      return;
    }
    let days = Store.get('adminDays', 30);
    view.innerHTML = `
      <section class="page">
        <div class="page-head profile-head">
          <div><h1>${SITE_LANG === 'en' ? 'Admin' : 'לוח ניהול'}</h1><p>${SITE_LANG === 'en' ? 'Registered users and site activity' : 'משתמשים רשומים ופעילות באתר'}</p></div>
          <div class="config" id="range" style="margin:0"></div>
        </div>
        <div id="admin-body"><p class="muted">${SITE_LANG === 'en' ? 'Loading…' : 'טוען…'}</p></div>
      </section>`;

    const renderRange = () => {
      const labels = SITE_LANG === 'en'
        ? [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']]
        : [[7, '7 ימים'], [30, '30 יום'], [90, '90 יום'], [365, 'שנה']];
      $('#range').innerHTML = labels
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
      const n = v => Number(v || 0).toLocaleString(SITE_LANG === 'en' ? 'en-US' : 'he-IL');
      const tile = (label, value, sub) => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value num">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
      const emptyMsg = SITE_LANG === 'en' ? 'No data yet' : 'אין נתונים עדיין';
      const table = (heads, rows, empty = emptyMsg) => rows.length
        ? `<table class="table"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        : `<p class="muted">${empty}</p>`;
      const finishes = Object.values(s.finishes).reduce((a, b) => a + b, 0);
      const fmtDay = d => { const [, m, dd] = d.split('-'); return SITE_LANG === 'en' ? `${Number(m)}/${Number(dd)}` : `${Number(dd)}.${Number(m)}`; };

      $('#admin-body').innerHTML = `
        <div class="panel ga-panel">
          <div>
            <h2>${SITE_LANG === 'en' ? 'Visitors, pageviews & traffic sources' : 'מבקרים, צפיות ומקורות תנועה'}</h2>
            <p class="panel-sub" style="margin:0">${s.gaId
              ? (SITE_LANG === 'en' ? `All visitor data is in Google Analytics (ID <span class="num">${esc(s.gaId)}</span>).` : `הנתונים על כל המבקרים באתר נמצאים ב־Google Analytics (מזהה <span class="num">${esc(s.gaId)}</span>).`)
              : (SITE_LANG === 'en' ? 'Google Analytics is not yet connected. Add GA_MEASUREMENT_ID to wrangler.jsonc and redeploy.' : 'Google Analytics עדיין לא מחובר. הוסיפו GA_MEASUREMENT_ID לקובץ wrangler.jsonc ופרסמו מחדש.')}</p>
          </div>
          <a class="btn primary" href="https://analytics.google.com/" target="_blank" rel="noopener">${SITE_LANG === 'en' ? 'Open Google Analytics' : 'פתיחת Google Analytics'}</a>
        </div>

        <div class="tiles">
          ${tile(SITE_LANG === 'en' ? 'Registered users' : 'משתמשים רשומים', n(s.users.total), SITE_LANG === 'en' ? 'Total' : 'סך הכול')}
          ${tile(SITE_LANG === 'en' ? 'New signups' : 'הרשמות חדשות', n(s.users.new), SITE_LANG === 'en' ? `last ${days} days` : `ב־${days} הימים האחרונים`)}
          ${tile(SITE_LANG === 'en' ? 'Active users' : 'משתמשים פעילים', n(s.users.active), SITE_LANG === 'en' ? 'Completed at least one session' : 'השלימו לפחות אימון אחד')}
          ${tile(SITE_LANG === 'en' ? 'Sessions completed' : 'אימונים שהושלמו', n(finishes), SITE_LANG === 'en' ? 'By registered users' : 'של משתמשים רשומים')}
          ${tile(SITE_LANG === 'en' ? 'Sessions per active user' : 'אימונים למשתמש פעיל', s.users.active ? (finishes / s.users.active).toFixed(1) : '0', SITE_LANG === 'en' ? 'Average' : 'ממוצע בתקופה')}
        </div>

        <div class="panel">
          <h2>${SITE_LANG === 'en' ? 'Active users per day' : 'משתמשים פעילים ליום'}</h2>
          <p class="panel-sub">${SITE_LANG === 'en' ? `Registered users who completed a session · last ${days} days` : `משתמשים רשומים שהשלימו אימון · ${days} הימים האחרונים`}</p>
          <div class="chart" id="admin-chart"></div>
        </div>

        <div class="two-col">
          <div class="panel">
            <h2>${SITE_LANG === 'en' ? 'Sessions by type' : 'אימונים לפי סוג'}</h2>
            ${table([SITE_LANG === 'en' ? 'Type' : 'סוג', SITE_LANG === 'en' ? 'Count' : 'כמות'], ['test', 'lesson', 'practice', 'custom'].map(k => [KIND_NAMES[k], n(s.finishes[k])]))}
          </div>
          <div class="panel">
            <h2>${SITE_LANG === 'en' ? 'Daily breakdown' : 'פירוט יומי'}</h2>
            ${table([SITE_LANG === 'en' ? 'Date' : 'תאריך', SITE_LANG === 'en' ? 'Active' : 'פעילים', SITE_LANG === 'en' ? 'Sessions' : 'אימונים', SITE_LANG === 'en' ? 'Signups' : 'הרשמות'], s.daily.slice().reverse().slice(0, 14).map(d => [
              fmtDay(d.day), n(d.activeUsers), n(d.results), n(d.signups),
            ]))}
          </div>
        </div>

        <div class="panel">
          <h2>${SITE_LANG === 'en' ? 'Recently signed up' : 'משתמשים אחרונים שנרשמו'}</h2>
          ${table([SITE_LANG === 'en' ? 'User' : 'משתמש', SITE_LANG === 'en' ? 'Joined' : 'נרשם', SITE_LANG === 'en' ? 'Sessions' : 'אימונים', SITE_LANG === 'en' ? 'Best (WPM)' : 'שיא (מילים לדקה)', SITE_LANG === 'en' ? 'Last active' : 'פעילות אחרונה'], s.recentUsers.map(u => [
            `${u.name ? esc(u.name) + '<br>' : ''}<span class="num muted">${esc(u.email)}</span>`, fmtDate(u.createdAt), n(u.results), u.bestWpm != null ? n(u.bestWpm) : '-', u.lastActive ? fmtDate(u.lastActive) : '-',
          ]), SITE_LANG === 'en' ? 'No registered users yet' : 'עדיין אין משתמשים רשומים')}
        </div>`;

      lineChart($('#admin-chart'), s.daily, {
        value: d => d.activeUsers,
        label: d => fmtDay(d.day),
        tipTitle: d => SITE_LANG === 'en' ? `${n(d.activeUsers)} active users` : `${n(d.activeUsers)} משתמשים פעילים`,
        tipSub: d => SITE_LANG === 'en' ? `${fmtDay(d.day)} · ${n(d.results)} sessions · ${n(d.signups)} signups` : `${fmtDay(d.day)} · ${n(d.results)} אימונים · ${n(d.signups)} הרשמות`,
        aria: pts => SITE_LANG === 'en' ? `Active users chart for the last ${pts.length} days` : `גרף משתמשים פעילים ב־${pts.length} הימים האחרונים`,
      });
    }

    renderRange();
    load();
  }

  // ---------- Guide ----------
  async function viewGuide() {
    document.title = SITE_LANG === 'en' ? 'Touch Typing Guide: Finger Placement, Home Row and a Practice Plan | Hakladaivrit' : 'מדריך הקלדה עיוורת בעברית: אצבעות, שורת הבית ותוכנית לימוד | הקלדה עיוורת';
    const token = Page.token;
    const html = await content('guide');
    if (token !== Page.token) return;
    view.innerHTML = html;
    Ads.fill(view);
    if (location.hash.length > 1) { const el = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (el) el.scrollIntoView(); }
  }

  // ---------- English typing (landing page) ----------
  async function viewEnglish() {
    document.title = 'הקלדה עיוורת באנגלית: מבחן, שיעורים ותרגול בחינם | הקלדה עיוורת';
    const token = Page.token;
    const html = await content('english');
    if (token !== Page.token) return;
    view.innerHTML = html;
    Ads.fill(view);
  }

  // ---------- Privacy policy ----------
  function viewPrivacy() {
    document.title = SITE_LANG === 'en' ? 'Privacy Policy | Hakladaivrit' : 'מדיניות פרטיות | הקלדה עיוורת';
    const email = Account.config.contactEmail;
    const lastUpdated = new Date().toLocaleDateString(SITE_LANG === 'en' ? 'en-US' : 'he-IL', { month: 'long', year: 'numeric' });
    const privacyContent = SITE_LANG === 'en' ? `
      <article class="page content">
        <h1>Privacy Policy</h1>
        <p class="muted">Last updated: ${lastUpdated}</p>

        <h2>What information we collect</h2>
        <ul>
          <li><strong>User account</strong>: Sign-in is through Google. We receive your email, name, and account ID only—not your password.</li>
          <li><strong>Results and practice</strong>: Speed, accuracy, time per keystroke for each key, and words you misspelled, so we can show you analysis and build personalized lessons. Guests: data stays in your browser only.</li>
          <li><strong>Usage statistics</strong>: We use Google Analytics to understand how many people visit the site, which pages are viewed, and where visitors come from. Google Analytics uses cookies and collects information like device type, browser, approximate location, and IP address (shortened). You can read about <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">how Google uses information</a> and install the <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener">Google Analytics opt-out browser extension</a>. If you enable Global Privacy Control in your browser, Google Analytics won't load.</li>
        </ul>

        <h2>Ads</h2>
        <p>The site may display Google AdSense ads. External vendors, including Google, use cookies to show ads based on your previous visits to this site or other sites. Google's use of cookies for advertising lets them and their partners show you ads based on your visits across the web.</p>
        <p>You can opt out of personalized ads in <a href="https://adssettings.google.com" target="_blank" rel="noopener">Google's ad settings</a>, and learn more about <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">how Google uses information from sites that use their services</a>.</p>

        <h2>How we use information</h2>
        <p>Information is used to run the site, save your progress, improve lessons, and understand how the site is used. We don't sell personal data.</p>

        <h2>Deleting information</h2>
        <p>You can reset your key statistics in the practice page. To request account deletion and all associated data${email ? `, write to us: <a href="mailto:${esc(email)}">${esc(email)}</a>` : ', contact us'}.</p>
      </article>` : `
      <article class="page content">
        <h1>מדיניות פרטיות</h1>
        <p class="muted">עודכן לאחרונה: ${lastUpdated}</p>

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
    view.innerHTML = privacyContent;
  }

  // ---------- Header: level, streak and daily goal ----------
  function renderGameChip() {
    const g = Gamify.summary(Account.data);
    const el = $('#game-chip');
    el.innerHTML = `
      <span class="gc-streak${g.streak ? ' on' : ''}" title="${tr('ימים ברצף', 'days in a row')}">${ICON.flame}<b class="num">${g.streak}</b></span>
      <span class="gc-level" title="${SITE_LANG === 'en' ? `Level ${g.level}: ${esc(g.rank.name)}` : `רמה ${g.level}: ${esc(g.rank.name)}`}">${g.rank.emoji}<b class="num">${g.level}</b></span>
      <span class="gc-goal" title="${SITE_LANG === 'en' ? `Daily goal: ${g.today} of ${g.goal} XP` : `יעד יומי: ${g.today} מתוך ${g.goal} XP`}" style="--p:${Math.round(g.goalProgress * 100)}"></span>`;
    el.setAttribute('aria-label', SITE_LANG === 'en' ? `Level ${g.level}, ${g.streak} days in a row, ${g.today} of ${g.goal} points today` : `רמה ${g.level}, ${g.streak} ימים ברצף, ${g.today} מתוך ${g.goal} נקודות היום`);
  }
  Account.on(renderGameChip);

  // ---------- Typing language (Hebrew site only; the English site types English) ----------
  if ($('#lang-toggle')) $('#lang-toggle').addEventListener('click', () => {
    Store.set('lang', LANG === 'en' ? 'he' : 'en');
    const u = new URL(location.href);
    u.searchParams.delete('lang');
    location.replace(u);
  });

  // ---------- Theme ----------
  const THEME_COLORS = { light: '#fbf8f3', dark: '#15141f' };
  $('meta[name="theme-color"]').content = THEME_COLORS[document.documentElement.dataset.theme] || THEME_COLORS.dark;
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    Store.set('theme', next);
    $('meta[name="theme-color"]').content = THEME_COLORS[next];
  });

  upgradeHashLink();
  Account.init().finally(() => {
    Analytics.init(Account.config.gaId);
    route();
  });
})();
