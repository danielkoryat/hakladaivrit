'use strict';

// Leaderboard: weekly and all-time typing speed, the balloon game and XP.
// Practice bots (always labelled) keep it lively and give everyone a target to beat.

const BOARDS = {
  week: { name: 'מהירות השבוע', unit: 'מילים לדקה', note: 'המבחן הכי מהיר ב־7 הימים האחרונים (לפחות 90% דיוק)' },
  all: { name: 'מהירות כל הזמנים', unit: 'מילים לדקה', note: 'המבחן הכי מהיר אי פעם (לפחות 90% דיוק)' },
  game: { name: 'משחק הבלונים', unit: 'נקודות', note: 'התוצאה הכי גבוהה במשחק הבלונים ב־7 הימים האחרונים' },
  xp: { name: 'נקודות XP', unit: 'XP', note: 'סך כל הנקודות שנצברו בכל האימונים' },
};

function viewLeaderboard() {
  document.title = 'טבלת האלופים: המקלידים המהירים בעברית | הקלדה עיוורת';
  let board = Store.get('board', 'week');
  if (!BOARDS[board]) board = 'week';

  view.innerHTML = `
    <section class="page board-page">
      <div class="page-head">
        <h1>🏆 טבלת האלופים</h1>
        <p>מי מקליד הכי מהר בעברית? עשו מבחן הקלדה או שחקו בבלונים, והתוצאה הטובה שלכם תופיע כאן.</p>
      </div>
      <div class="config" id="tabs"></div>
      <p class="muted small board-note" id="note"></p>
      <div class="board" id="board"><p class="muted">טוען…</p></div>
      <div id="me-box"></div>
      <div id="page-info"></div>
    </section>`;
  fillInfo('leaderboard');

  function tabs() {
    $('#tabs').innerHTML = Object.entries(BOARDS).map(([k, b]) => `<button class="cfg-btn${k === board ? ' active' : ''}" data-b="${k}">${b.name}</button>`).join('');
    $('#note').textContent = BOARDS[board].note;
  }
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-b]');
    if (!b) return;
    board = b.dataset.b;
    Store.set('board', board);
    tabs();
    load();
  });

  async function load() {
    const token = Page.token;
    let data;
    try { data = await Api.req('GET', `/leaderboard?board=${board}`); } catch {
      if (token === Page.token) $('#board').innerHTML = '<p class="muted">הטבלה זמינה כשהאתר רץ עם השרת.</p>';
      return;
    }
    if (token !== Page.token) return;
    const medal = i => ['🥇', '🥈', '🥉'][i] || `<span class="num">${i + 1}</span>`;
    $('#board').innerHTML = `<ol class="board-list">${data.rows.map((r, i) => {
      const lvl = Gamify.levelOf(r.xp || 0);
      const rank = Gamify.rank(lvl);
      return `<li class="${r.isMe ? 'me' : ''}${r.isBot ? ' bot' : ''}">
        <span class="b-rank">${medal(i)}</span>
        <span class="b-avatar" title="${r.isBot ? 'בוט תרגול' : `רמה ${lvl}: ${esc(rank.name)}`}">${r.isBot ? r.emoji : rank.emoji}</span>
        <span class="b-name">${esc(r.name)}${r.isBot ? ' <span class="tag bot-tag">בוט</span>' : ''}${r.isMe ? ' <span class="tag me-tag">את/ה</span>' : ''}</span>
        <span class="b-value"><b class="num">${Number(r.value).toLocaleString('he-IL')}</b> <span class="muted small">${BOARDS[board].unit}</span></span>
      </li>`;
    }).join('')}</ol>
    <p class="muted small">🤖 הבוטים הם יריבי תרגול במהירויות שונות, כדי שתמיד יהיה את מי לנצח.</p>`;
  }

  function meBox() {
    const el = $('#me-box');
    if (!Account.user) {
      el.innerHTML = Account.online ? `<div class="panel cta-panel"><div><h2>רוצים להופיע בטבלה?</h2><p class="muted">התחברו עם Google, עשו מבחן הקלדה, והתוצאה שלכם תעלה לטבלה.</p></div><button class="btn primary" id="board-login">התחברות</button></div>` : '';
      const b = $('#board-login');
      if (b) b.onclick = () => $('#login-btn') && $('#login-btn').click();
      return;
    }
    const s = Account.board || { nickname: '', showOnBoard: true };
    el.innerHTML = `
      <div class="panel">
        <h2>איך אני מופיע/ה בטבלה</h2>
        <p class="muted small">כברירת מחדל מוצגים השם הפרטי והאות הראשונה של שם המשפחה. אפשר לבחור כינוי או להסתתר.</p>
        <div class="mine-row">
          <label class="field inline">כינוי<input id="nick" maxlength="20" value="${esc(s.nickname)}" placeholder="למשל: המקליד המהיר"></label>
          <label class="check"><input type="checkbox" id="show" ${s.showOnBoard ? 'checked' : ''}> להופיע בטבלה</label>
          <button class="btn" id="save-nick">שמירה</button>
        </div>
      </div>`;
    $('#save-nick').onclick = async () => {
      try {
        await Account.saveBoardSettings({ nickname: $('#nick').value.trim(), showOnBoard: $('#show').checked });
        toast('נשמר');
        load();
      } catch (e) { toast(e.message, true); }
    };
  }

  tabs();
  load();
  meBox();
}
