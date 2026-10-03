'use strict';

// Leaderboard: weekly and all-time typing speed, the balloon game and XP.
// Practice bots (always labelled) keep it lively and give everyone a target to beat.

const BOARDS = {
  week: { name: tr('מהירות השבוע', 'This week\'s speed'), unit: tr('מילים לדקה', 'words per minute'), note: tr('המבחן הכי מהיר בעברית ב־7 הימים האחרונים (לפחות 90% דיוק)', 'Fastest test in the last 7 days (at least 90% accuracy)') },
  all: { name: tr('מהירות כל הזמנים', 'All-time speed'), unit: tr('מילים לדקה', 'words per minute'), note: tr('המבחן הכי מהיר בעברית אי פעם (לפחות 90% דיוק)', 'Fastest test ever (at least 90% accuracy)') },
  game: { name: tr('משחק הבלונים', 'Balloon Game'), unit: tr('נקודות', 'points'), note: tr('התוצאה הכי גבוהה במשחק הבלונים ב־7 הימים האחרונים', 'Highest score in the balloon game in the last 7 days') },
  xp: { name: tr('נקודות XP', 'XP Points'), unit: 'XP', note: tr('סך כל הנקודות שנצברו בכל האימונים', 'Total points earned in all training') },
};

function viewLeaderboard() {
  document.title = tr('טבלת האלופים: המקלידים המהירים בעברית | הקלדה עיוורת', 'Leaderboard: The Fastest Typists | Hakladaivrit');
  let board = Store.get('board', 'week');
  if (!BOARDS[board]) board = 'week';

  view.innerHTML = `
    <section class="page board-page">
      <div class="page-head">
        <h1>🏆 ${tr('טבלת האלופים', 'Leaderboard')}</h1>
        <p>${tr('מי מקליד הכי מהר בעברית? עשו מבחן הקלדה או שחקו בבלונים, והתוצאה הטובה שלכם תופיע כאן.', 'Who\'s the fastest typist? Take a typing test or play the balloon game, and your best score will appear here.')}</p>
      </div>
      <div class="config" id="tabs"></div>
      <p class="muted small board-note" id="note"></p>
      <div class="board" id="board"><p class="muted">${tr('טוען…', 'Loading...')}</p></div>
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
    try { data = await Api.req('GET', `/leaderboard?board=${board}${tr('', '&lang=en')}`); } catch {
      if (token === Page.token) $('#board').innerHTML = `<p class="muted">${tr('הטבלה זמינה כשהאתר רץ עם השרת.', 'The leaderboard is available when the site runs with a server.')}</p>`;
      return;
    }
    if (token !== Page.token) return;
    const medal = i => ['🥇', '🥈', '🥉'][i] || `<span class="num">${i + 1}</span>`;
    const botNames = {
      'משתמש אנונימי': 'Anonymous typist',
      'בוט צב': 'Turtle bot',
      'בוט ארנב': 'Rabbit bot',
      'בוט שועל': 'Fox bot',
      'בוט צ׳יטה': 'Cheetah bot',
      'בוט נשר': 'Eagle bot',
      'בוט טיל': 'Rocket bot',
    };
    const displayName = n => SITE_LANG === 'en' && botNames[n] ? botNames[n] : n;
    $('#board').innerHTML = `<ol class="board-list">${data.rows.map((r, i) => {
      const lvl = Gamify.levelOf(r.xp || 0);
      const rank = Gamify.rank(lvl);
      return `<li class="${r.isMe ? 'me' : ''}${r.isBot ? ' bot' : ''}">
        <span class="b-rank">${medal(i)}</span>
        <span class="b-avatar" title="${r.isBot ? tr('בוט תרגול', 'Practice bot') : `${tr('רמה', 'Level')} ${lvl}: ${esc(rank.name)}`}">${r.isBot ? r.emoji : rank.emoji}</span>
        <span class="b-name">${esc(displayName(r.name))}${r.isBot ? ` <span class="tag bot-tag">${tr('בוט', 'bot')}</span>` : ''}${r.isMe ? ` <span class="tag me-tag">${tr('את/ה', 'you')}</span>` : ''}</span>
        <span class="b-value"><b class="num">${Number(r.value).toLocaleString(tr('he-IL', 'en-US'))}</b> <span class="muted small">${BOARDS[board].unit}</span></span>
      </li>`;
    }).join('')}</ol>
    <p class="muted small">🤖 ${tr('הבוטים הם יריבי תרגול במהירויות שונות, כדי שתמיד יהיה את מי לנצח.', 'The bots are practice rivals at different speeds, so there\'s always someone to beat.')}</p>`;
  }

  function meBox() {
    const el = $('#me-box');
    if (!Account.user) {
      el.innerHTML = Account.online ? `<div class="panel cta-panel"><div><h2>${tr('רוצים להופיע בטבלה?', 'Want to appear on the leaderboard?')}</h2><p class="muted">${tr('התחברו עם Google, עשו מבחן הקלדה, והתוצאה שלכם תעלה לטבלה.', 'Sign in with Google, take a typing test, and your score will appear on the leaderboard.')}</p></div><button class="btn primary" id="board-login">${tr('התחברות', 'Sign in')}</button></div>` : '';
      const b = $('#board-login');
      if (b) b.onclick = () => $('#login-btn') && $('#login-btn').click();
      return;
    }
    const s = Account.board || { nickname: '', showOnBoard: true };
    el.innerHTML = `
      <div class="panel">
        <h2>${tr('איך אני מופיע/ה בטבלה', 'How I appear on the leaderboard')}</h2>
        <p class="muted small">${tr('כברירת מחדל מוצגים השם הפרטי והאות הראשונה של שם המשפחה. אפשר לבחור כינוי או להסתתר.', 'By default, your first name and first initial of your last name are shown. You can choose a nickname or hide yourself.')}</p>
        <div class="mine-row">
          <label class="field inline">${tr('כינוי', 'Nickname')}<input id="nick" maxlength="20" value="${esc(s.nickname)}" placeholder="${tr('למשל: המקליד המהיר', 'e.g.: The Fast Typer')}"></label>
          <label class="check"><input type="checkbox" id="show" ${s.showOnBoard ? 'checked' : ''}> ${tr('להופיע בטבלה', 'Show on leaderboard')}</label>
          <button class="btn" id="save-nick">${tr('שמירה', 'Save')}</button>
        </div>
      </div>`;
    $('#save-nick').onclick = async () => {
      try {
        await Account.saveBoardSettings({ nickname: $('#nick').value.trim(), showOnBoard: $('#show').checked });
        toast(tr('נשמר', 'Saved'));
        load();
      } catch (e) { toast(e.message, true); }
    };
  }

  tabs();
  load();
  meBox();
}
