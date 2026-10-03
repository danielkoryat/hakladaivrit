'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const Store = {
  get(k, d) {
    try { const v = localStorage.getItem('hebtype.' + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('hebtype.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ }
  },
  remove(k) {
    try { localStorage.removeItem('hebtype.' + k); } catch { /* storage unavailable */ }
  },
};

const rand = n => Math.floor(Math.random() * n);
const pick = a => a[rand(a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isHebrew = c => /^[א-ת]$/.test(c);
// A letter of the language being practised (Hebrew by default, English when switched).
const isLangLetter = c => (LANG === 'en' ? /^[a-z]$/i.test(c) : isHebrew(c));
const IN_LANG = SITE_LANG === 'en' ? '' : LANG === 'en' ? 'באנגלית' : 'בעברית';
const fmtTime = secs => secs >= 3600
  ? `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}h`
  : secs >= 60 ? `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}` : `${Math.round(secs)}s`;
const fmtDate = ts => new Date(ts).toLocaleDateString(tr('he-IL', 'en-US'), { day: 'numeric', month: 'numeric' });

// Addresses on this version of the site: the English site lives under /en, so there
// sitePath('/test') is '/en/test'. Links in page HTML get the prefix automatically (app.js).
const SITE_BASE = SITE_LANG === 'en' ? '/en' : '';
const sitePath = p => (!SITE_BASE || /^\/en(\/|$|[?#])/.test(p) ? p : SITE_BASE + (p === '/' ? '' : p.replace(/^\/(?=[?#])/, '')));

// Runs fn on window resize while el stays in the document.
function onResizeWhile(el, fn) {
  let raf = 0;
  const h = () => {
    if (!el.isConnected) { window.removeEventListener('resize', h); return; }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(fn);
  };
  window.addEventListener('resize', h);
}

function toast(msg, bad) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.append(el); }
  el.textContent = msg;
  el.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast' + (bad ? ' bad' : ''); }, 3200);
}
