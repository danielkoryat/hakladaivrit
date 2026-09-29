'use strict';

// Texts to type: a library of short educational texts, and "my text" for practising on
// your own study material (kept only in this browser).

let textsPromise = null;
function loadTexts() {
  if (!textsPromise) textsPromise = fetch('/data/texts.json').then(r => r.json()).catch(() => ({ categories: {}, texts: [] }));
  return textsPromise;
}

// Makes any pasted text typeable: removes niqqud, unifies quotes and dashes, keeps one space.
function cleanForTyping(raw) {
  return String(raw)
    .replace(/[֑-ׇ]/g, m => (m === '־' ? ' ' : ''))   // niqqud and cantillation; maqaf becomes a space
    .replace(/[״“”„«»]/g, '"').replace(/[׳‘’‚`]/g, "'")
    .replace(/[‐-―−]/g, '-').replace(/…/g, '...')
    .replace(/[^א-ת -~\s]/g, '')   // Hebrew, English and everything else on the keyboard
    .replace(/\s+/g, ' ')
    .trim();
}

// Splits long text into practice sections of about `size` words, at sentence ends when possible.
function sections(text, size = 45) {
  const words = text.split(' ');
  const out = [];
  let cur = [];
  words.forEach(w => {
    cur.push(w);
    if ((cur.length >= size && /[.?!:]$/.test(w)) || cur.length >= size * 1.5) { out.push(cur.join(' ')); cur = []; }
  });
  if (cur.length) out.push(cur.join(' '));
  return out;
}

const MY_TEXTS_MAX = 30;
const MyTexts = {
  all() { return Store.get('myTexts', []); },
  save(list) { Store.set('myTexts', list.slice(0, MY_TEXTS_MAX)); },
  add(title, text) {
    const t = { id: Date.now().toString(36), title: title || text.split(' ').slice(0, 5).join(' '), text, at: Date.now(), part: 0 };
    this.save([t, ...this.all()]);
    return t;
  },
  update(id, patch) { this.save(this.all().map(t => (t.id === id ? { ...t, ...patch } : t))); },
  remove(id) { this.save(this.all().filter(t => t.id !== id)); },
  get(id) { return this.all().find(t => t.id === id); },
};

// ---------- Library ----------
async function viewTexts() {
  document.title = 'טקסטים להקלדה: היסטוריה, מדע וטבע | הקלדה עיוורת';
  const token = Page.token;
  const data = await loadTexts();
  if (token !== Page.token) return;
  let filter = 'all';
  const cats = data.categories;

  view.innerHTML = `
    <section class="page">
      <div class="page-head">
        <h1>טקסטים להקלדה</h1>
        <p>מתרגלים הקלדה עיוורת ולומדים משהו חדש בדרך: היסטוריה, מדע, טבע והשפה העברית. או מתרגלים על חומר הלימוד שלכם.</p>
      </div>
      <a class="mine-card" href="/texts/mine">
        <span class="mine-emoji">📝</span>
        <span><b>הטקסט שלי</b><br><span class="muted">מדביקים סיכום, מאמר או חומר למבחן, ומתרגלים עליו הקלדה עיוורת.</span></span>
        <span class="btn primary">להתחיל</span>
      </a>
      <div class="config" id="filters"></div>
      <div class="texts-grid" id="grid"></div>
      <div id="page-info"></div>
    </section>`;
  fillInfo('texts');

  const done = Gamify.state(Account.data).texts;
  function render() {
    const f = [['all', 'הכל'], ...Object.entries(cats)];
    $('#filters').innerHTML = f.map(([k, n]) => `<button class="cfg-btn${k === filter ? ' active' : ''}" data-f="${k}">${n}</button>`).join('');
    const list = data.texts.filter(t => filter === 'all' || t.category === filter);
    $('#grid').innerHTML = list.map(t => `
      <a class="text-card cat-${t.category}" href="/texts/${t.slug}">
        <span class="tc-top"><span class="tc-cat">${esc(cats[t.category] || '')}</span>${done[t.slug] ? `<span class="tc-done">✓ <span class="num">${done[t.slug]}</span> מ/ד</span>` : ''}</span>
        <b class="tc-title">${esc(t.title)}</b>
        <span class="tc-intro">${esc(t.intro)}</span>
        <span class="tc-meta"><span class="tag">${esc(t.level)}</span><span class="tag"><span class="num">${t.text.split(' ').length}</span> מילים</span></span>
      </a>`).join('');
  }
  $('#filters').addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if (b) { filter = b.dataset.f; render(); }
  });
  render();
}

// ---------- Typing one text (library or my own) ----------
function typingRun({ el, text, strict, onDone }) {
  let kb = null, typer = null;
  el.innerHTML = `
    <div class="live"><span class="live-main num" id="t-count"></span><span class="live-sub num" id="t-wpm"></span></div>
    <div class="typing-box idle long-text" id="tb"></div>
    <div class="under" id="t-tools"></div>
    <div class="kb-wrap" id="kbw"></div>`;
  function buildKeyboard() {
    kb = Keyboard($('#kbw', el), { hands: Prefs.hands });
    if (typer) kb.highlight(typer.nextChar());
  }
  $('#t-tools', el).append(handsButton(buildKeyboard));
  buildKeyboard();
  const live = tp => {
    $('#t-count', el).textContent = `${tp.wordsDone()}/${tp.wordCount}`;
    const s = tp.stats();
    $('#t-wpm', el).textContent = tp.startTime && s.secs > 1 ? `${Math.round(s.wpm)} wpm` : '';
  };
  typer = new Typer({
    el: $('#tb', el), text, strict,
    onUpdate: tp => { live(tp); kb.highlight(tp.nextChar()); },
    onTick: live,
    onPress: (code, ok) => kb.flash(code, ok),
    onFinish: (s, tp) => onDone(s, tp),
  });
  Page.onKey = e => {
    if (e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); typer.reset(text); return; }
    typer.handleKey(e);
  };
  Page.onLeave = () => typer.destroy();
  return typer;
}

function resultHtml(s, extra = '') {
  return `
    <div class="result-top">
      ${statBox('מילים לדקה', Math.round(s.wpm), true)}
      ${statBox('דיוק', Math.round(s.acc) + '%', true)}
    </div>
    <div class="result-grid">
      ${statBox('תווים לדקה', Math.round(s.cpm))}
      ${statBox('זמן', fmtTime(s.secs))}
      ${statBox('טעויות', s.errors)}
      ${statBox('תווים', s.correct)}
    </div>
    ${extra}
    ${missedHtml(s.charStats)}`;
}

async function viewText(slug) {
  const token = Page.token;
  const data = await loadTexts();
  if (token !== Page.token) return;
  const t = data.texts.find(x => x.slug === slug);
  if (!t) { Page.navigate('/texts'); return; }
  document.title = `${t.title}: טקסט להקלדה | הקלדה עיוורת`;
  const challenge = Share.challenge('מילים לדקה על הטקסט הזה');
  const idx = data.texts.indexOf(t);
  const next = data.texts[(idx + 1) % data.texts.length];

  view.innerHTML = `
    <section class="page">
      <div class="lesson-head">
        <a class="back" href="/texts">→ כל הטקסטים</a>
        <div class="lesson-meta">${esc(data.categories[t.category] || '')} · ${esc(t.level)}</div>
        <h1>${esc(t.title)}</h1>
        <p>${esc(t.intro)}</p>
      </div>
      ${challenge ? challenge.html : ''}
      <div class="stage" id="stage"></div>
      <div class="result" id="result" hidden></div>
      ${touchNote()}
    </section>`;

  function start() {
    $('#result').hidden = true;
    $('#stage').hidden = false;
    typingRun({ el: $('#stage'), text: t.text, strict: false, onDone: finish });
  }
  function finish(s, tp) {
    const { reward } = Account.record(tp.report({ kind: 'text', mode: `text-${t.slug}`, label: t.title, textId: t.slug }));
    const beat = challenge && Math.round(s.wpm) > challenge.value;
    $('#stage').hidden = true;
    const r = $('#result');
    r.hidden = false;
    r.innerHTML = `
      <h2 class="result-title">${beat ? 'ניצחתם את האתגר! 💪' : 'סיימתם את הטקסט'}</h2>
      ${resultHtml(s)}
      <div class="actions" id="r-actions">
        <a class="btn primary" href="/texts/${next.slug}">לטקסט הבא ${ICON.next}</a>
        <button class="btn" id="again">${ICON.restart} שוב</button>
      </div>`;
    $('#again').onclick = start;
    $('#r-actions').append(Share.button(() => ({
      title: `הקלדתי את "${t.title}"`, big: Math.round(s.wpm), unit: 'מילים לדקה',
      chips: [`דיוק ${Math.round(s.acc)}%`, data.categories[t.category]],
      url: Share.challengeUrl(`/texts/${t.slug}`, Math.round(s.wpm)),
      message: `הקלדתי את הטקסט "${t.title}" ב־${Math.round(s.wpm)} מילים לדקה ⌨️ תצליחו לנצח אותי?`,
    })));
    Celebrate.show(reward);
  }
  start();
}

// ---------- My own text ----------
function viewMyTexts() {
  document.title = 'תרגול הקלדה על טקסט משלכם | הקלדה עיוורת';
  const params = new URLSearchParams(location.search);
  const open = params.get('id') && MyTexts.get(params.get('id'));
  if (open) { practiseMine(open); return; }

  view.innerHTML = `
    <section class="page mine-page">
      <div class="lesson-head">
        <a class="back" href="/texts">→ כל הטקסטים</a>
        <h1>📝 הטקסט שלי</h1>
        <p>מתכוננים למבחן? הדביקו כאן סיכום, מאמר או כל טקסט אחר, ותרגלו עליו הקלדה עיוורת. כך לומדים את החומר ומשפרים את ההקלדה בבת אחת. הטקסטים נשמרים רק בדפדפן שלכם.</p>
      </div>
      <div class="panel">
        <label class="field">שם (לא חובה)<input id="m-title" maxlength="60" placeholder="למשל: סיכום היסטוריה, פרק 3"></label>
        <label class="field">הטקסט<textarea id="m-text" rows="8" dir="auto" placeholder="הדביקו כאן טקסט בעברית, באנגלית או בשתיהן..."></textarea></label>
        <div class="mine-row">
          <label class="btn ghost upload">${ICON.upload} טעינת קובץ טקסט<input type="file" id="m-file" accept=".txt,text/plain" hidden></label>
          <span class="muted small" id="m-count"></span>
          <button class="btn primary" id="m-go">שמירה ותרגול</button>
        </div>
        <p class="muted small">ניקוד, סימנים מיוחדים ורווחים כפולים מוסרים אוטומטית כדי שאפשר יהיה להקליד הכל. טקסט ארוך מתחלק לקטעים קצרים.</p>
      </div>
      <h2 class="section-title">הטקסטים השמורים שלי</h2>
      <div id="m-list"></div>
    </section>`;

  const count = () => {
    const words = cleanForTyping($('#m-text').value).split(' ').filter(Boolean).length;
    $('#m-count').textContent = words ? `${words} מילים · ${Math.max(1, sections(cleanForTyping($('#m-text').value)).length)} קטעים` : '';
  };
  $('#m-text').addEventListener('input', count);
  $('#m-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 500000) { toast('הקובץ גדול מדי (עד 500KB)', true); return; }
    const reader = new FileReader();
    reader.onload = () => {
      $('#m-text').value = String(reader.result);
      if (!$('#m-title').value) $('#m-title').value = f.name.replace(/\.[^.]+$/, '').slice(0, 60);
      count();
    };
    reader.readAsText(f, 'utf-8');
  });
  $('#m-go').onclick = () => {
    const text = cleanForTyping($('#m-text').value).slice(0, 50000);
    if (text.split(' ').length < 3) { toast('הדביקו טקסט של כמה מילים לפחות', true); return; }
    const t = MyTexts.add($('#m-title').value.trim().slice(0, 60), text);
    Page.navigate(`/texts/mine?id=${t.id}`);
  };

  function list() {
    const all = MyTexts.all();
    $('#m-list').innerHTML = all.length ? `<div class="mine-list">${all.map(t => {
      const parts = sections(t.text).length;
      return `<div class="mine-item">
        <a href="/texts/mine?id=${t.id}"><b>${esc(t.title)}</b><span class="muted small">${t.text.split(' ').length} מילים · קטע ${Math.min(parts, (t.part || 0) + 1)} מתוך ${parts}</span></a>
        <button class="icon-btn" data-del="${t.id}" title="מחיקה" aria-label="מחיקה">${ICON.trash}</button>
      </div>`;
    }).join('')}</div>` : '<p class="muted">עוד אין טקסטים שמורים.</p>';
  }
  $('#m-list').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (b) { MyTexts.remove(b.dataset.del); list(); }
  });
  list();
}

function practiseMine(t) {
  const parts = sections(t.text);
  let part = Math.min(t.part || 0, parts.length - 1);
  let strict = Store.get('mineStrict', false);
  document.title = `${t.title} | הקלדה עיוורת`;
  view.innerHTML = `
    <section class="page">
      <div class="lesson-head">
        <a class="back" href="/texts/mine">→ הטקסטים שלי</a>
        <h1>${esc(t.title)}</h1>
        <div class="mine-row">
          <span class="lesson-meta" id="p-part"></span>
          <span class="config" style="margin:0"><button class="cfg-btn" id="p-strict">ללא טעויות</button></span>
        </div>
      </div>
      <div class="progress"><div class="bar" id="p-bar"></div></div>
      <div class="stage" id="stage"></div>
      <div class="result" id="result" hidden></div>
    </section>`;
  const renderHead = () => {
    $('#p-part').textContent = `קטע ${part + 1} מתוך ${parts.length}`;
    $('#p-bar').style.width = (part / parts.length) * 100 + '%';
    $('#p-strict').classList.toggle('active', strict);
  };
  $('#p-strict').onclick = () => { strict = !strict; Store.set('mineStrict', strict); start(); };

  function start() {
    renderHead();
    $('#result').hidden = true;
    $('#stage').hidden = false;
    typingRun({ el: $('#stage'), text: parts[part], strict, onDone: finish });
  }
  function finish(s, tp) {
    const { reward } = Account.record(tp.report({ kind: 'text', mode: 'text-mine', label: t.title, textId: 'mine' }));
    const last = part >= parts.length - 1;
    MyTexts.update(t.id, { part: last ? 0 : part + 1 });
    $('#stage').hidden = true;
    const r = $('#result');
    r.hidden = false;
    r.innerHTML = `
      <h2 class="result-title">${last ? 'סיימתם את כל הטקסט! 🎉' : `קטע ${part + 1} מתוך ${parts.length} הושלם`}</h2>
      ${resultHtml(s)}
      <div class="actions">
        ${last ? '' : `<button class="btn primary" id="next-part">לקטע הבא (Enter) ${ICON.next}</button>`}
        <button class="btn" id="again">${ICON.restart} שוב את הקטע</button>
        <a class="btn ghost" href="/texts/mine">כל הטקסטים שלי</a>
      </div>`;
    $('#again').onclick = start;
    if (!last) $('#next-part').onclick = () => { part++; start(); };
    Page.onKey = e => { if (e.key === 'Enter' && !last) { e.preventDefault(); part++; start(); } };
    if (last) Celebrate.confetti();
    Celebrate.show(reward);
  }
  start();
}

