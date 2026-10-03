'use strict';

// Texts to type: a library of short educational texts, and "my text" for practising on
// your own study material (kept only in this browser).

let textsPromise = null;
function loadTexts() {
  if (!textsPromise) textsPromise = fetch(tr('/data/texts.json', '/data/texts-en.json')).then(r => r.json()).catch(() => ({ categories: {}, texts: [] }));
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
  document.title = tr('טקסטים להקלדה: היסטוריה, מדע וטבע | הקלדה עיוורת', 'Typing Practice Texts: History, Science and Nature | Hakladaivrit');
  const token = Page.token;
  const data = await loadTexts();
  if (token !== Page.token) return;
  let filter = 'all';
  const cats = data.categories;

  view.innerHTML = `
    <section class="page">
      <div class="page-head">
        <h1>${tr('טקסטים להקלדה', 'Typing Practice Texts')}</h1>
        <p>${tr('מתרגלים הקלדה עיוורת ולומדים משהו חדש בדרך: היסטוריה, מדע, טבע והשפה העברית. או מתרגלים על חומר הלימוד שלכם.', 'Practice touch typing and learn something new: history, science, nature and the Hebrew language. Or practice on your own study material.')}</p>
      </div>
      <a class="mine-card" href="${sitePath('/texts/mine')}">
        <span class="mine-emoji">📝</span>
        <span><b>${tr('הטקסט שלי', 'My text')}</b><br><span class="muted">${tr('מדביקים סיכום, מאמר או חומר למבחן, ומתרגלים עליו הקלדה עיוורת.', 'Paste a summary, article or test material, and practice touch typing on it.')}</span></span>
        <span class="btn primary">${tr('להתחיל', 'Get started')}</span>
      </a>
      <div class="config" id="filters"></div>
      <div class="texts-grid" id="grid"></div>
      <div id="page-info"></div>
    </section>`;
  fillInfo('texts');

  const done = Gamify.state(Account.data).texts;
  function render() {
    const f = [['all', tr('הכל', 'All')], ...Object.entries(cats)];
    $('#filters').innerHTML = f.map(([k, n]) => `<button class="cfg-btn${k === filter ? ' active' : ''}" data-f="${k}">${n}</button>`).join('');
    const list = data.texts.filter(t => filter === 'all' || t.category === filter);
    $('#grid').innerHTML = list.map(t => `
      <a class="text-card cat-${t.category}" href="${sitePath(`/texts/${t.slug}`)}">
        <span class="tc-top"><span class="tc-cat">${esc(cats[t.category] || '')}</span>${done[t.slug] ? `<span class="tc-done">✓ <span class="num">${done[t.slug]}</span> ${tr('מ/ד', 'wpm')}</span>` : ''}</span>
        <b class="tc-title">${esc(t.title)}</b>
        <span class="tc-intro">${esc(t.intro)}</span>
        <span class="tc-meta"><span class="tag">${esc(t.level)}</span><span class="tag"><span class="num">${t.text.split(' ').length}</span> ${tr('מילים', 'words')}</span></span>
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
      ${statBox(tr('מילים לדקה', 'Words per minute'), Math.round(s.wpm), true)}
      ${statBox(tr('דיוק', 'Accuracy'), Math.round(s.acc) + '%', true)}
    </div>
    <div class="result-grid">
      ${statBox(tr('תווים לדקה', 'Characters per minute'), Math.round(s.cpm))}
      ${statBox(tr('זמן', 'Time'), fmtTime(s.secs))}
      ${statBox(tr('טעויות', 'Errors'), s.errors)}
      ${statBox(tr('תווים', 'Characters'), s.correct)}
    </div>
    ${extra}
    ${missedHtml(s.charStats)}`;
}

async function viewText(slug) {
  const token = Page.token;
  const data = await loadTexts();
  if (token !== Page.token) return;
  const text = data.texts.find(x => x.slug === slug);
  if (!text) { Page.navigate(sitePath('/texts')); return; }
  document.title = tr(`${text.title}: טקסט להקלדה | הקלדה עיוורת`, `${text.title}: Typing Text | Hakladaivrit`);
  const challenge = Share.challenge(tr('מילים לדקה על הטקסט הזה', 'words per minute on this text'));
  const idx = data.texts.indexOf(text);
  const next = data.texts[(idx + 1) % data.texts.length];
  const cat = data.categories[text.category] || '';
  const related = data.texts.filter(x => x.category === text.category && x !== text);
  const words = text.text.split(' ').length;
  const mins = Math.max(1, Math.round(words / 30));

  view.innerHTML = `
    <section class="page">
      <div class="lesson-head">
        <a class="back" href="${sitePath('/texts')}">${tr('→ כל הטקסטים', '← All texts')}</a>
        <div class="lesson-meta">${esc(cat)} · ${esc(text.level)}</div>
        <h1>${esc(text.title)}</h1>
        <p>${esc(text.intro)}</p>
      </div>
      ${challenge ? challenge.html : ''}
      <div class="stage" id="stage"></div>
      <div class="result" id="result" hidden></div>
      ${touchNote()}
      <div class="page-info content">
        <h2>${tr('על הטקסט', 'About this text')}</h2>
        <p>${tr(`${words} מילים ו־${text.text.length} תווים. בקצב של 30 מילים לדקה מקלידים אותו ${mins === 1 ? 'בדקה אחת בערך' : `בערך ב־${mins} דקות`}.`,
          `${words} words and ${text.text.length} characters. At 30 words per minute it takes about ${mins === 1 ? 'one minute' : `${mins} minutes`} to type.`)}</p>
        ${related.length ? `<h3>${tr('עוד טקסטים', 'More texts')}: ${esc(cat)}</h3>
        <ul>${related.map(x => `<li><a href="${sitePath(`/texts/${x.slug}`)}">${esc(x.title)}</a> – ${esc(x.intro)}</li>`).join('')}</ul>` : ''}
        <p><a href="${sitePath('/texts')}">${tr('כל הטקסטים', 'All texts')}</a> · <a href="${sitePath('/texts/mine')}">${tr('תרגול על טקסט משלכם', 'Practice on your own text')}</a> · <a href="${sitePath('/test')}">${tr('מבחן הקלדה', 'Typing test')}</a></p>
      </div>
    </section>`;

  function start() {
    $('#result').hidden = true;
    $('#stage').hidden = false;
    typingRun({ el: $('#stage'), text: text.text, strict: false, onDone: finish });
  }
  function finish(s, tp) {
    const { reward } = Account.record(tp.report({ kind: 'text', mode: `text-${text.slug}`, label: text.title, textId: text.slug }));
    const beat = challenge && Math.round(s.wpm) > challenge.value;
    $('#stage').hidden = true;
    const r = $('#result');
    r.hidden = false;
    r.innerHTML = `
      <h2 class="result-title">${beat ? tr('ניצחתם את האתגר! 💪', 'You beat the challenge! 💪') : tr('סיימתם את הטקסט', 'You finished the text')}</h2>
      ${resultHtml(s)}
      <div class="actions" id="r-actions">
        <a class="btn primary" href="${sitePath(`/texts/${next.slug}`)}">${tr('לטקסט הבא', 'Next text')} ${ICON.next}</a>
        <button class="btn" id="again">${ICON.restart} ${tr('שוב', 'Again')}</button>
      </div>`;
    $('#again').onclick = start;
    $('#r-actions').append(Share.button(() => ({
      title: tr(`הקלדתי את "${text.title}"`, `I typed "${text.title}"`), big: Math.round(s.wpm), unit: tr('מילים לדקה', 'words per minute'),
      chips: [tr(`דיוק ${Math.round(s.acc)}%`, `Accuracy ${Math.round(s.acc)}%`), data.categories[text.category]],
      url: Share.challengeUrl(`/texts/${text.slug}`, Math.round(s.wpm)),
      message: tr(`הקלדתי את הטקסט "${text.title}" ב־${Math.round(s.wpm)} מילים לדקה ⌨️ תצליחו לנצח אותי?`, `I typed "${text.title}" at ${Math.round(s.wpm)} words per minute ⌨️ Can you beat me?`),
    })));
    Celebrate.show(reward);
  }
  start();
}

// ---------- My own text ----------
function viewMyTexts() {
  document.title = tr('תרגול הקלדה על טקסט משלכם | הקלדה עיוורת', 'Type Your Own Text | Hakladaivrit');
  const params = new URLSearchParams(location.search);
  const open = params.get('id') && MyTexts.get(params.get('id'));
  if (open) { practiseMine(open); return; }

  view.innerHTML = `
    <section class="page mine-page">
      <div class="lesson-head">
        <a class="back" href="${sitePath('/texts')}">${tr('→ כל הטקסטים', '← All texts')}</a>
        <h1>📝 ${tr('הטקסט שלי', 'My Text')}</h1>
        <p>${tr('מתכוננים למבחן? הדביקו כאן סיכום, מאמר או כל טקסט אחר, ותרגלו עליו הקלדה עיוורת. כך לומדים את החומר ומשפרים את ההקלדה בבת אחת. הטקסטים נשמרים רק בדפדפן שלכם.', 'Preparing for a test? Paste a summary, article or any other text here, and practice touch typing on it. Learn the material and improve your typing at the same time. Your texts are saved only in your browser.')}</p>
      </div>
      <div class="panel">
        <label class="field">${tr('שם (לא חובה)', 'Name (optional)')}<input id="m-title" maxlength="60" placeholder="${tr('למשל: סיכום היסטוריה, פרק 3', 'e.g.: History summary, chapter 3')}"></label>
        <label class="field">${tr('הטקסט', 'Text')}<textarea id="m-text" rows="8" dir="auto" placeholder="${tr('הדביקו כאן טקסט בעברית, באנגלית או בשתיהן...', 'Paste text in Hebrew, English or both here...')}"></textarea></label>
        <div class="mine-row">
          <label class="btn ghost upload">${ICON.upload} ${tr('טעינת קובץ טקסט', 'Load text file')}<input type="file" id="m-file" accept=".txt,text/plain" hidden></label>
          <span class="muted small" id="m-count"></span>
          <button class="btn primary" id="m-go">${tr('שמירה ותרגול', 'Save and practice')}</button>
        </div>
        <p class="muted small">${tr('ניקוד, סימנים מיוחדים ורווחים כפולים מוסרים אוטומטית כדי שאפשר יהיה להקליד הכל. טקסט ארוך מתחלק לקטעים קצרים.', 'Diacritics, special characters and extra spaces are removed automatically so you can type everything. Long text is split into short sections.')}</p>
      </div>
      <h2 class="section-title">${tr('הטקסטים השמורים שלי', 'My saved texts')}</h2>
      <div id="m-list"></div>
    </section>`;

  const count = () => {
    const words = cleanForTyping($('#m-text').value).split(' ').filter(Boolean).length;
    $('#m-count').textContent = words ? `${words} ${tr('מילים', 'words')} · ${Math.max(1, sections(cleanForTyping($('#m-text').value)).length)} ${tr('קטעים', 'sections')}` : '';
  };
  $('#m-text').addEventListener('input', count);
  $('#m-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 500000) { toast(tr('הקובץ גדול מדי (עד 500KB)', 'File too large (up to 500KB)'), true); return; }
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
    if (text.split(' ').length < 3) { toast(tr('הדביקו טקסט של כמה מילים לפחות', 'Paste at least a few words'), true); return; }
    const t = MyTexts.add($('#m-title').value.trim().slice(0, 60), text);
    Page.navigate(`/texts/mine?id=${t.id}`);
  };

  function list() {
    const all = MyTexts.all();
    $('#m-list').innerHTML = all.length ? `<div class="mine-list">${all.map(t => {
      const parts = sections(t.text).length;
      return `<div class="mine-item">
        <a href="${sitePath(`/texts/mine?id=${t.id}`)}"><b>${esc(t.title)}</b><span class="muted small">${t.text.split(' ').length} ${tr('מילים', 'words')} · ${tr('קטע', 'Section')} ${Math.min(parts, (t.part || 0) + 1)} ${tr('מתוך', 'of')} ${parts}</span></a>
        <button class="icon-btn" data-del="${t.id}" title="${tr('מחיקה', 'Delete')}" aria-label="${tr('מחיקה', 'Delete')}">${ICON.trash}</button>
      </div>`;
    }).join('')}</div>` : `<p class="muted">${tr('עוד אין טקסטים שמורים.', 'No saved texts yet.')}</p>`;
  }
  $('#m-list').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (b) { MyTexts.remove(b.dataset.del); list(); }
  });
  list();
}

function practiseMine(txt) {
  const parts = sections(txt.text);
  let part = Math.min(txt.part || 0, parts.length - 1);
  let strict = Store.get('mineStrict', false);
  document.title = `${txt.title} | ${tr('הקלדה עיוורת', 'Hakladaivrit')}`;
  view.innerHTML = `
    <section class="page">
      <div class="lesson-head">
        <a class="back" href="${sitePath('/texts/mine')}">${tr('→ הטקסטים שלי', '← My texts')}</a>
        <h1>${esc(txt.title)}</h1>
        <div class="mine-row">
          <span class="lesson-meta" id="p-part"></span>
          <span class="config" style="margin:0"><button class="cfg-btn" id="p-strict">${tr('ללא טעויות', 'No errors')}</button></span>
        </div>
      </div>
      <div class="progress"><div class="bar" id="p-bar"></div></div>
      <div class="stage" id="stage"></div>
      <div class="result" id="result" hidden></div>
    </section>`;
  const renderHead = () => {
    $('#p-part').textContent = `${tr('קטע', 'Section')} ${part + 1} ${tr('מתוך', 'of')} ${parts.length}`;
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
    const { reward } = Account.record(tp.report({ kind: 'text', mode: 'text-mine', label: txt.title, textId: 'mine' }));
    const last = part >= parts.length - 1;
    MyTexts.update(txt.id, { part: last ? 0 : part + 1 });
    $('#stage').hidden = true;
    const r = $('#result');
    r.hidden = false;
    r.innerHTML = `
      <h2 class="result-title">${last ? tr('סיימתם את כל הטקסט! 🎉', 'You finished the whole text! 🎉') : tr(`קטע ${part + 1} מתוך ${parts.length} הושלם`, `Section ${part + 1} of ${parts.length} completed`)}</h2>
      ${resultHtml(s)}
      <div class="actions">
        ${last ? '' : `<button class="btn primary" id="next-part">${tr('לקטע הבא (Enter)', 'Next section (Enter)')} ${ICON.next}</button>`}
        <button class="btn" id="again">${ICON.restart} ${tr('שוב את הקטע', 'Again')}</button>
        <a class="btn ghost" href="${sitePath('/texts/mine')}">${tr('כל הטקסטים שלי', 'All my texts')}</a>
      </div>`;
    $('#again').onclick = start;
    if (!last) $('#next-part').onclick = () => { part++; start(); };
    Page.onKey = e => { if (e.key === 'Enter' && !last) { e.preventDefault(); part++; start(); } };
    if (last) Celebrate.confetti();
    Celebrate.show(reward);
  }
  start();
}

