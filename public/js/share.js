'use strict';

// "Share my result": draws a result card image in the browser and offers the usual ways to
// share it. The shared link is a challenge ("X typed 52 WPM, can you beat it?").

const Share = {
  firstName() {
    const n = Account.user && Account.user.name ? Account.user.name.trim().split(/\s+/)[0] : '';
    return n.slice(0, 16);
  },

  // Link that opens the same activity with a challenge banner.
  challengeUrl(path, value, extra = {}) {
    const u = new URL(sitePath(path), location.origin);
    u.searchParams.set('c', String(value));
    const name = this.firstName();
    if (name) u.searchParams.set('n', name);
    Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  },

  // opts: { big, unit, title, chips: [], footer, url, message }
  async card(opts) {
    const S = 1080;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    try { await Promise.all(['800 200px Rubik', '600 60px Rubik', '400 40px Rubik'].map(f => document.fonts.load(f))); } catch { /* system font */ }

    const bg = ctx.createLinearGradient(0, 0, 0, S);
    bg.addColorStop(0, '#231c45');
    bg.addColorStop(1, '#15141f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, S, S);
    const glow = ctx.createRadialGradient(S / 2, 520, 40, S / 2, 520, 520);
    glow.addColorStop(0, 'rgba(157,133,255,.35)');
    glow.addColorStop(1, 'rgba(157,133,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, S, S);

    const logo = await new Promise(res => { const img = new Image(); img.onload = () => res(img); img.onerror = () => res(null); img.src = '/favicon.svg'; });
    if (logo) ctx.drawImage(logo, S / 2 - 70, 80, 140, 140);

    ctx.textAlign = 'center';
    ctx.direction = tr('rtl', 'ltr');
    ctx.fillStyle = '#eeecf7';
    ctx.font = '600 58px Rubik, sans-serif';
    ctx.fillText(opts.title, S / 2, 310);

    ctx.fillStyle = '#ffc94a';
    ctx.font = '800 250px Rubik, sans-serif';
    ctx.direction = 'ltr';
    ctx.fillText(String(opts.big), S / 2, 575);
    ctx.direction = 'rtl';
    ctx.fillStyle = '#c9bfff';
    ctx.font = '600 62px Rubik, sans-serif';
    ctx.fillText(opts.unit, S / 2, 665);

    // Chips: accuracy, mode, level…
    const chips = (opts.chips || []).filter(Boolean).slice(0, 3);
    ctx.font = '500 40px Rubik, sans-serif';
    const pad = 34, gap = 22, h = 76;
    const widths = chips.map(t => ctx.measureText(t).width + pad * 2);
    const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, chips.length - 1);
    let x = S / 2 + total / 2;   // right to left
    chips.forEach((t, i) => {
      const w = widths[i];
      ctx.fillStyle = 'rgba(255,255,255,.09)';
      ctx.beginPath();
      ctx.roundRect(x - w, 740, w, h, h / 2);
      ctx.fill();
      ctx.fillStyle = '#eeecf7';
      ctx.fillText(t, x - w / 2, 740 + h / 2 + 14);
      x -= w + gap;
    });

    ctx.fillStyle = '#eeecf7';
    ctx.font = '600 50px Rubik, sans-serif';
    ctx.fillText(opts.footer || tr('תצליחו לנצח אותי?', 'Can you beat me?'), S / 2, 925);
    ctx.fillStyle = '#ffc94a';
    ctx.direction = 'ltr';
    ctx.font = '600 42px Rubik, sans-serif';
    ctx.fillText('hakladaivrit.com', S / 2, 1000);

    return new Promise(res => c.toBlob(b => res({ blob: b, url: c.toDataURL('image/png') }), 'image/png'));
  },

  async open(opts) {
    const { blob, url: dataUrl } = await this.card(opts);
    const text = `${opts.message} ${opts.url}`;
    let dlg = $('#share-dlg');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'share-dlg';
      dlg.className = 'share-dlg';
      document.body.append(dlg);
      dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    }
    const enc = encodeURIComponent;
    const file = blob ? new File([blob], 'hakladaivrit.png', { type: 'image/png' }) : null;
    const canNative = !!(navigator.share && (!file || !navigator.canShare || navigator.canShare({ files: [file] })));
    dlg.innerHTML = `
      <div class="share-head"><h2>${tr('שיתוף התוצאה', 'Share result')}</h2>
        <button class="icon-btn" data-act="close" aria-label="${tr('סגירה', 'Close')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <img class="share-preview" src="${dataUrl}" alt="${tr('כרטיס התוצאה', 'Result card')}">
      <div class="share-actions">
        ${canNative ? `<button class="btn primary" data-act="native">${ICON.share} ${tr('שיתוף', 'Share')}</button>` : ''}
        <a class="btn share-wa" target="_blank" rel="noopener" href="https://wa.me/?text=${enc(text)}" data-act="whatsapp">${tr('וואטסאפ', 'WhatsApp')}</a>
        <a class="btn" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${enc(opts.url)}" data-act="facebook">${tr('פייסבוק', 'Facebook')}</a>
        <a class="btn" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${enc(opts.message)}&url=${enc(opts.url)}" data-act="x">X</a>
        <a class="btn" target="_blank" rel="noopener" href="https://t.me/share/url?url=${enc(opts.url)}&text=${enc(opts.message)}" data-act="telegram">${tr('טלגרם', 'Telegram')}</a>
        <button class="btn" data-act="copy">${tr('העתקת קישור', 'Copy link')}</button>
        <a class="btn ghost" href="${dataUrl}" download="hakladaivrit.png" data-act="download">${tr('הורדת התמונה', 'Download image')}</a>
      </div>
      <p class="share-note muted">${tr('בשיתוף בוואטסאפ, פייסבוק ו־X נשלח קישור. כדי לשתף את התמונה עצמה, הורידו אותה או השתמשו בכפתור השיתוף בטלפון.', 'Sharing on WhatsApp, Facebook and X sends a link. To share the image itself, download it or use your phone\'s share button.')}</p>`;
    dlg.onclick = async e => {
      const b = e.target.closest('[data-act]');
      if (!b) { if (e.target === dlg) dlg.close(); return; }
      const act = b.dataset.act;
      Analytics.event('share', { method: act });
      Track.event('share', { method: act });
      if (act === 'close') dlg.close();
      if (act === 'native') {
        try { await navigator.share(file ? { files: [file], text, title: tr('הקלדה עיוורת', 'Hakladaivrit') } : { text, url: opts.url }); } catch { /* cancelled */ }
      }
      if (act === 'copy') {
        try { await navigator.clipboard.writeText(opts.url); toast(tr('הקישור הועתק', 'Link copied')); } catch { toast(tr('לא הצלחנו להעתיק', 'Failed to copy'), true); }
      }
    };
    dlg.showModal();
  },

  // A share button for a results screen.
  button(getOpts) {
    const b = document.createElement('button');
    b.className = 'btn share-btn';
    b.innerHTML = `${ICON.share} ${tr('שיתוף התוצאה', 'Share result')}`;
    b.onclick = () => this.open(getOpts());
    return b;
  },

  // Banner shown when someone opens a challenge link.
  challenge(unit) {
    const p = new URLSearchParams(location.search);
    const value = Number(p.get('c'));
    if (!value || value <= 0 || value > 100000) return null;
    const name = (p.get('n') || '').replace(/[<>&"]/g, '').slice(0, 16);
    return { value, name, html: `<div class="challenge">💪 <b>${name ? esc(name) : tr('חבר/ה', 'Someone')}</b> ${tr('הגיע/ה ל־', 'reached ')}<b class="num">${value}</b> ${unit}. ${tr('תצליחו לנצח?', 'Can you beat them?')}</div>` };
  },
};
