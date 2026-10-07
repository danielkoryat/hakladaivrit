// Hebrew blind-typing site on Cloudflare Workers.
// Static files come from ./public (Workers Static Assets); this worker handles the JSON API,
// the HTML page (security headers, AdSense injection), ads.txt and the www → apex redirect.
// Accounts: "Sign in with Google" only. Data: Cloudflare D1 (binding DB).
//
// Free-plan limits shape the code: ≤ 50 D1 queries per request, so multi-row writes use
// json_each() in a few statements, and work per request stays small (10 ms CPU).

import { verifyGoogleIdToken, GoogleAuthError } from '../lib/google-auth.js';

const SESSION_DAYS = 30;
const MAX_BODY = 512 * 1024;
const KINDS = new Set(['test', 'lesson', 'practice', 'custom', 'text']);
const GAME_MODES = new Set(['home', 'letters', 'words']);

// ---------- Settings (wrangler.jsonc "vars", or .dev.vars locally) ----------
function settings(env) {
  const list = v => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const slots = {};
  ['home', 'results', 'lessons', 'profile'].forEach(name => {
    const v = env[`ADSENSE_SLOT_${name.toUpperCase()}`];
    if (/^\d{5,20}$/.test(v || '')) slots[name] = v;
  });
  return {
    admins: new Set(list(env.ADMIN_EMAILS)),
    googleClientId: /^[\w-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID || '') ? env.GOOGLE_CLIENT_ID : null,
    gaId: /^G-[A-Z0-9]{4,15}$/.test(env.GA_MEASUREMENT_ID || '') ? env.GA_MEASUREMENT_ID : null,
    adsClient: /^ca-pub-\d{10,20}$/.test(env.ADSENSE_CLIENT || '') ? env.ADSENSE_CLIENT : null,
    adSlots: slots,
    adsPreview: env.ADS_PREVIEW === '1',
    contactEmail: env.CONTACT_EMAIL || '',
    tz: env.REPORT_TZ || 'Asia/Jerusalem',
  };
}

// ---------- Helpers ----------
const json = (status, body, headers = {}) => new Response(status === 204 ? null : JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});
const httpError = (status, message) => Object.assign(new Error(message), { status });

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw httpError(413, 'הבקשה גדולה מדי');
  try { return text ? JSON.parse(text) : {}; } catch { throw httpError(400, 'JSON לא תקין'); }
}

const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async s => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function cookies(request) {
  const out = {};
  (request.headers.get('Cookie') || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const sessionCookie = (request, token, maxAge) =>
  `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;

async function currentUser(request, env) {
  const token = cookies(request).sid;
  if (!token) return null;
  return env.DB.prepare(`SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
                         WHERE s.token = ?1 AND s.expires_at > ?2`).bind(await sha256(token), Date.now()).first();
}
const publicUser = (u, cfg) => ({ id: u.id, email: u.email, name: u.name || '', isAdmin: cfg.admins.has(String(u.email).toLowerCase()) });

// Best-effort limit on sign-in attempts per IP (per worker instance).
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  if (attempts.size > 5000) attempts.clear();
  const a = attempts.get(ip);
  if (!a || a.reset < now) { attempts.set(ip, { count: 1, reset: now + 15 * 60000 }); return false; }
  return ++a.count > 30;
}

// ---------- Validation ----------
const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; };
const int = (v, min, max) => Math.round(num(v, min, max));
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const isChar = k => typeof k === 'string' && [...k].length === 1;

function cleanKeyStats(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).slice(0, 200)
    .filter(([ch, v]) => isChar(ch) && Array.isArray(v))
    .map(([ch, v]) => [ch, int(v[0], 0, 1e7), int(v[1], 0, 1e7), int(v[2], 0, 1e9), int(v[3], 0, 1e7)]);
}
const cleanWords = arr => (Array.isArray(arr) ? arr.slice(0, 300).filter(w => typeof w === 'string' && w.length > 0 && w.length <= 30) : []);
function cleanResult(r) {
  if (!r || typeof r !== 'object' || !KINDS.has(r.kind)) return null;
  return {
    at: int(r.at || Date.now(), 0, Date.now() + 60000),
    kind: r.kind, mode: str(r.mode, 40), label: str(r.label, 80),
    wpm: num(r.wpm, 0, 400), acc: num(r.acc, 0, 100), cpm: num(r.cpm, 0, 2000), secs: num(r.secs, 0, 36000),
    errors: int(r.errors, 0, 1e6), chars: int(r.chars, 0, 1e6),
    lessonId: r.lessonId == null ? null : int(r.lessonId, 0, 1000),
    stars: r.stars == null ? null : int(r.stars, 0, 3),
  };
}

// ---------- Bulk statements (one query each, whatever the number of rows) ----------
const SQL = {
  insertResult: `INSERT INTO results (user_id, at, kind, mode, label, wpm, acc, cpm, secs, errors, chars, lesson_id, stars)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
  importResults: `INSERT INTO results (user_id, at, kind, mode, label, wpm, acc, cpm, secs, errors, chars, lesson_id, stars)
                  SELECT ?1, json_extract(value, '$.at'), json_extract(value, '$.kind'), json_extract(value, '$.mode'),
                         json_extract(value, '$.label'), json_extract(value, '$.wpm'), json_extract(value, '$.acc'),
                         json_extract(value, '$.cpm'), json_extract(value, '$.secs'), json_extract(value, '$.errors'),
                         json_extract(value, '$.chars'), json_extract(value, '$.lessonId'), json_extract(value, '$.stars')
                  FROM json_each(?2)`,
  keyStats: `INSERT INTO key_stats (user_id, ch, hits, misses, time_ms, timed)
             SELECT ?1, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
                    json_extract(value, '$[3]'), json_extract(value, '$[4]')
             FROM json_each(?2) WHERE true
             ON CONFLICT (user_id, ch) DO UPDATE SET hits = hits + excluded.hits, misses = misses + excluded.misses,
               time_ms = time_ms + excluded.time_ms, timed = timed + excluded.timed`,
  addWords: `INSERT INTO word_errors (user_id, word, count)
             SELECT ?1, json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?2) WHERE true
             ON CONFLICT (user_id, word) DO UPDATE SET count = count + excluded.count`,
  healWords: `UPDATE word_errors SET count = count - 1 WHERE user_id = ?1 AND word IN (SELECT value FROM json_each(?2))`,
  purgeWords: 'DELETE FROM word_errors WHERE user_id = ?1 AND count <= 0',
  lessons: `INSERT INTO lessons (user_id, lesson_id, stars, wpm, acc)
            SELECT ?1, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]')
            FROM json_each(?2) WHERE true
            ON CONFLICT (user_id, lesson_id) DO UPDATE SET stars = MAX(stars, excluded.stars),
              wpm = MAX(wpm, excluded.wpm), acc = MAX(acc, excluded.acc)`,
  pbs: `INSERT INTO pbs (user_id, mode, wpm)
        SELECT ?1, json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?2) WHERE true
        ON CONFLICT (user_id, mode) DO UPDATE SET wpm = MAX(wpm, excluded.wpm)`,
};

async function profile(env, user, cfg) {
  const [keys, words, lessons, pbs, history, totals, state] = await env.DB.batch([
    env.DB.prepare('SELECT ch, hits, misses, time_ms, timed FROM key_stats WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('SELECT word, count FROM word_errors WHERE user_id = ?1 ORDER BY count DESC LIMIT 200').bind(user.id),
    env.DB.prepare('SELECT lesson_id, stars, wpm, acc FROM lessons WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('SELECT mode, wpm FROM pbs WHERE user_id = ?1').bind(user.id),
    env.DB.prepare(`SELECT at, kind, mode, label, wpm, acc, cpm, secs, errors, chars, lesson_id, stars
                    FROM results WHERE user_id = ?1 ORDER BY at DESC LIMIT 1000`).bind(user.id),
    env.DB.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(secs), 0) AS secs FROM results WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('SELECT data, nickname, show_on_board FROM user_state WHERE user_id = ?1').bind(user.id),
  ]);
  const st = state.results[0];
  let game = {};
  try { game = st ? JSON.parse(st.data) : {}; } catch { game = {}; }
  const keyStats = {}, wordErrors = {}, lessonMap = {}, pbMap = {};
  keys.results.forEach(r => { keyStats[r.ch] = [r.hits, r.misses, r.time_ms, r.timed]; });
  words.results.forEach(r => { wordErrors[r.word] = r.count; });
  lessons.results.forEach(r => { lessonMap[r.lesson_id] = { stars: r.stars, wpm: r.wpm, acc: r.acc }; });
  pbs.results.forEach(r => { pbMap[r.mode] = r.wpm; });
  return {
    user: publicUser(user, cfg), keyStats, wordErrors, lessons: lessonMap, pbs: pbMap,
    history: history.results.reverse().map(r => ({
      at: r.at, kind: r.kind, mode: r.mode, label: r.label, wpm: r.wpm, acc: r.acc, cpm: r.cpm, secs: r.secs,
      errors: r.errors, chars: r.chars, lessonId: r.lesson_id, stars: r.stars,
    })),
    totals: { count: totals.results[0].count, secs: totals.results[0].secs },
    state: { game, nickname: st ? st.nickname || '' : '', showOnBoard: st ? st.show_on_board === 1 : true },
  };
}

// ---------- Game progress & leaderboard ----------
const NICK_RE = /^[\p{L}\p{N} ._'״׳-]{2,20}$/u;

// Keeps only the known shape of the game state, with sane bounds.
function cleanGame(g) {
  if (!g || typeof g !== 'object') return null;
  const obj = (o, max, keyOk, val) => {
    const out = {};
    if (!o || typeof o !== 'object') return out;
    Object.entries(o).slice(0, max).forEach(([k, v]) => { if (keyOk(k)) { const c = val(v); if (c != null) out[k] = c; } });
    return out;
  };
  return {
    xp: int(g.xp, 0, 1e7),
    chars: int(g.chars, 0, 1e9),
    bestStreak: int(g.bestStreak, 0, 3650),
    days: obj(g.days, 150, k => /^\d{4}-\d{2}-\d{2}$/.test(k), v => (v && typeof v === 'object' ? { xp: int(v.xp, 0, 1e5), n: int(v.n, 0, 1e4) } : null)),
    badges: obj(g.badges, 60, k => /^[\w-]{1,30}$/.test(k), v => int(v, 0, 1e14)),
    best: obj(g.best, 10, k => GAME_MODES.has(k), v => int(v, 0, 1e6)),
    texts: obj(g.texts, 300, k => /^[\w-]{1,60}$/.test(k), v => int(v, 0, 400)),
  };
}

// First name and the first letter of the family name, unless the user picked a nickname.
function boardName(row) {
  if (row.nickname) return row.nickname;
  const parts = String(row.name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'משתמש אנונימי';
  return parts.length > 1 ? `${parts[0]} ${[...parts[parts.length - 1]][0]}.` : parts[0];
}

// Practice bots keep the board lively and give everyone a target. They are always labelled as bots.
const BOTS = [
  { name: 'בוט צב', emoji: '🐢', speed: 18, game: 240, xp: 350 },
  { name: 'בוט ארנב', emoji: '🐇', speed: 30, game: 520, xp: 950 },
  { name: 'בוט שועל', emoji: '🦊', speed: 42, game: 860, xp: 2200 },
  { name: 'בוט צ׳יטה', emoji: '🐆', speed: 58, game: 1300, xp: 4300 },
  { name: 'בוט נשר', emoji: '🦅', speed: 72, game: 1900, xp: 7600 },
  { name: 'בוט טיל', emoji: '🚀', speed: 90, game: 2700, xp: 12500 },
];

// Speed boards count tests in one typing language: Hebrew on the Hebrew site, English on the English one.
async function leaderboard(env, board, me, lang = 'he') {
  const week = Date.now() - 7 * 86400000;
  const cols = 'u.name AS name, s.nickname AS nickname, COALESCE(s.xp, 0) AS xp';
  let sql, bind = [];
  if (board === 'game') {
    sql = `SELECT g.user_id AS uid, MAX(g.score) AS value, ${cols} FROM game_scores g JOIN users u ON u.id = g.user_id
           LEFT JOIN user_state s ON s.user_id = g.user_id
           WHERE g.at >= ?1 AND COALESCE(s.show_on_board, 1) = 1 GROUP BY g.user_id ORDER BY value DESC LIMIT 25`;
    bind = [week];
  } else if (board === 'xp') {
    sql = `SELECT s.user_id AS uid, s.xp AS value, ${cols} FROM user_state s JOIN users u ON u.id = s.user_id
           WHERE s.show_on_board = 1 AND s.xp > 0 ORDER BY s.xp DESC LIMIT 25`;
  } else {
    sql = `SELECT r.user_id AS uid, ROUND(MAX(r.wpm)) AS value, ${cols} FROM results r JOIN users u ON u.id = r.user_id
           LEFT JOIN user_state s ON s.user_id = r.user_id
           WHERE r.kind = 'test' AND r.mode ${lang === 'en' ? '' : 'NOT '}LIKE 'en-%' AND r.chars >= 50 AND r.acc >= 90 AND r.at >= ?1 AND COALESCE(s.show_on_board, 1) = 1
           GROUP BY r.user_id ORDER BY value DESC LIMIT 25`;
    bind = [board === 'all' ? 0 : week];
  }
  const rows = (await env.DB.prepare(sql).bind(...bind).all()).results.map(r => ({
    name: boardName(r), value: r.value, xp: r.xp, isMe: !!me && r.uid === me.id,
  }));
  const key = board === 'game' ? 'game' : board === 'xp' ? 'xp' : 'speed';
  BOTS.forEach(b => rows.push({ name: b.name, emoji: b.emoji, value: b[key], xp: b.xp, isBot: true }));
  rows.sort((a, b) => b.value - a.value || (a.isBot ? 1 : -1));
  return { board, rows: rows.slice(0, 30) };
}

// ---------- Admin statistics (accounts & activity; visitor stats live in Google Analytics) ----------
async function adminStats(env, days, cfg) {
  const dayOf = ts => new Date(ts).toLocaleDateString('en-CA', { timeZone: cfg.tz });
  const dayStart = ts => { // start (to the hour) of the report-timezone day containing ts
    const d = dayOf(ts);
    let t = Math.floor(ts / 3600000) * 3600000;
    while (dayOf(t - 3600000) === d) t -= 3600000;
    return t;
  };
  const now = Date.now();
  const since = dayStart(now - (days - 1) * 86400000);
  const [kinds, signupRows, activityRows, total, fresh, active, recent] = await env.DB.batch([
    env.DB.prepare('SELECT kind, COUNT(*) AS n FROM results WHERE at >= ?1 GROUP BY kind').bind(since),
    env.DB.prepare('SELECT created_at FROM users WHERE created_at >= ?1').bind(since),
    env.DB.prepare('SELECT at, user_id FROM results WHERE at >= ?1 ORDER BY at DESC LIMIT 20000').bind(since),
    env.DB.prepare('SELECT COUNT(*) AS n FROM users'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?1').bind(since),
    env.DB.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM results WHERE at >= ?1').bind(since),
    env.DB.prepare(`SELECT u.email, u.name, u.created_at AS createdAt,
                      (SELECT COUNT(*) FROM results r WHERE r.user_id = u.id) AS results,
                      (SELECT MAX(r.at) FROM results r WHERE r.user_id = u.id) AS lastActive,
                      (SELECT ROUND(MAX(r.wpm)) FROM results r WHERE r.user_id = u.id AND r.kind = 'test') AS bestWpm
                    FROM users u ORDER BY u.created_at DESC LIMIT 25`),
  ]);
  const finishes = {};
  kinds.results.forEach(r => { finishes[r.kind] = r.n; });
  const signups = {}, activity = {}, perDay = {};
  signupRows.results.forEach(r => { const d = dayOf(r.created_at); signups[d] = (signups[d] || 0) + 1; });
  activityRows.results.forEach(r => {
    const d = dayOf(r.at);
    activity[d] = (activity[d] || 0) + 1;
    (perDay[d] = perDay[d] || new Set()).add(r.user_id);
  });
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayOf(now - i * 86400000);
    daily.push({ day: d, signups: signups[d] || 0, results: activity[d] || 0, activeUsers: perDay[d] ? perDay[d].size : 0 });
  }
  return {
    days, gaId: cfg.gaId, finishes, daily,
    users: { total: total.results[0].n, new: fresh.results[0].n, active: active.results[0].n },
    recentUsers: recent.results,
  };
}

// ---------- Activity log (admin page: who did what, day by day) ----------
// Each browser has a random id in the "vid" cookie (set by Track in account.js). Bots and
// admins are not logged.
const EVENT_TYPES = new Set(['view', 'start', 'finish', 'abandon', 'sign_up', 'login', 'logout', 'share', 'site']);
const VID = /^[a-z0-9]{16,32}$/;
const clip = (s, n) => (s == null || s === '' ? null : String(s).slice(0, n));

function visitorInfo(request) {
  const ua = request.headers.get('User-Agent') || '';
  const cf = request.cf || {};
  return {
    device: /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ? 'tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'mobile' : 'desktop',
    browser: /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
      : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Other',
    os: /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Other',
    country: cf.country || null,
    city: clip(cf.city, 80),
    lang: clip((request.headers.get('Accept-Language') || '').split(/[,;]/)[0].trim(), 20),
  };
}

// events: [{ at, type, path, data (JSON string or null) }]
async function logEvents(request, env, cfg, events, referrer) {
  const vid = cookies(request).vid || '';
  const ua = request.headers.get('User-Agent') || '';
  if (!events.length || !VID.test(vid) || !ua || CRAWLER_UA.test(ua)) return;
  const user = await currentUser(request, env);
  if (user && cfg.admins.has(String(user.email).toLowerCase())) return;
  const v = visitorInfo(request);
  const uid = user ? user.id : null;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO visitors (id, user_id, first_seen, last_seen, referrer, country, city, device, browser, os, lang)
                    VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                    ON CONFLICT(id) DO UPDATE SET user_id = COALESCE(excluded.user_id, visitors.user_id), last_seen = excluded.last_seen,
                      country = excluded.country, city = excluded.city, device = excluded.device, browser = excluded.browser,
                      os = excluded.os, lang = excluded.lang`)
      .bind(vid, uid, now, clip(referrer, 300), v.country, v.city, v.device, v.browser, v.os, v.lang),
    env.DB.prepare(`INSERT INTO events (visitor_id, user_id, at, type, path, data)
                    SELECT ?1, ?2, json_extract(value, '$.at'), json_extract(value, '$.type'), json_extract(value, '$.path'), json_extract(value, '$.data')
                    FROM json_each(?3)`).bind(vid, uid, JSON.stringify(events)),
  ]);
}

// Calendar days in the report time zone.
const dayOf = (ts, tz) => new Date(ts).toLocaleDateString('en-CA', { timeZone: tz });
const tzFormats = {};
function tzOffset(ts, tz) { // how far the zone's clock is ahead of UTC at ts, in ms
  const f = tzFormats[tz] || (tzFormats[tz] = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }));
  const p = Object.fromEntries(f.formatToParts(ts).map(x => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}
const dayStartAt = (day, tz) => { const utc = Date.parse(`${day}T00:00:00Z`); return utc - tzOffset(utc - tzOffset(utc, tz), tz); };
const nextDay = day => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

// Groups event rows into people: an account (all its browsers) or an anonymous browser.
async function people(env, rows) {
  const uids = [...new Set(rows.map(r => r.uid).filter(Boolean))];
  const vids = [...new Set(rows.map(r => r.vid))];
  const [users, visitors] = await env.DB.batch([
    env.DB.prepare('SELECT id, email, name, created_at AS createdAt FROM users WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(uids)),
    env.DB.prepare(`SELECT id, first_seen AS firstSeen, referrer, country, city, device, browser, os, lang
                    FROM visitors WHERE id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(vids)),
  ]);
  const userById = new Map(users.results.map(u => [u.id, u]));
  const visitorById = new Map(visitors.results.map(v => [v.id, v]));
  const byKey = new Map();
  for (const r of rows) {
    const key = r.uid ? `u${r.uid}` : `v${r.vid}`;
    let p = byKey.get(key);
    if (!p) {
      const u = r.uid ? userById.get(r.uid) : null;
      p = { key, name: u ? u.name : '', email: u ? u.email : '', joined: u ? u.createdAt : null, visitors: [], events: [] };
      byKey.set(key, p);
    }
    if (!p.visitors.some(v => v.id === r.vid) && visitorById.has(r.vid)) p.visitors.push(visitorById.get(r.vid));
    let data = null;
    try { data = r.data ? JSON.parse(r.data) : null; } catch { /* kept as null */ }
    p.events.push({ at: r.at, type: r.type, path: r.path, data, vid: r.vid });
  }
  return [...byKey.values()];
}

const EVENT_ROWS = `SELECT e.visitor_id AS vid, COALESCE(e.user_id, v.user_id) AS uid, e.at, e.type, e.path, e.data
                    FROM events e LEFT JOIN visitors v ON v.id = e.visitor_id`;

// Everyone who did something on one day, with their actions in order.
async function activityDay(env, cfg, day) {
  const { results } = await env.DB.prepare(`${EVENT_ROWS} WHERE e.at >= ?1 AND e.at < ?2 ORDER BY e.at, e.id LIMIT 20000`)
    .bind(dayStartAt(day, cfg.tz), dayStartAt(nextDay(day), cfg.tz)).all();
  const list = await people(env, results);
  list.sort((a, b) => b.events[b.events.length - 1].at - a.events[a.events.length - 1].at);
  return { day, today: dayOf(Date.now(), cfg.tz), tz: cfg.tz, people: list };
}

// Everything one person did (newest 5000 actions), for the person's full history.
async function activityPerson(env, cfg, key) {
  const uid = /^u(\d+)$/.exec(key), vid = /^v([a-z0-9]{16,32})$/.exec(key);
  if (!uid && !vid) return null;
  const { results } = uid
    ? await env.DB.prepare(`${EVENT_ROWS} WHERE e.user_id = ?1 OR e.visitor_id IN (SELECT id FROM visitors WHERE user_id = ?1) ORDER BY e.at DESC, e.id DESC LIMIT 5000`).bind(Number(uid[1])).all()
    : await env.DB.prepare(`${EVENT_ROWS} WHERE e.visitor_id = ?1 ORDER BY e.at DESC, e.id DESC LIMIT 5000`).bind(vid[1]).all();
  results.reverse();
  return { tz: cfg.tz, person: (await people(env, results)).find(p => p.key === key) || null };
}

// ---------- API ----------
async function api(request, env, route, cfg) {
  const method = request.method;
  const url = new URL(request.url);
  if (method !== 'GET') {
    // CSRF protection: require a JSON body and a same-origin Origin header when present.
    if (!String(request.headers.get('Content-Type') || '').startsWith('application/json')) return json(415, { error: 'נדרש JSON' });
    const origin = request.headers.get('Origin');
    let originHost = null;
    try { originHost = origin ? new URL(origin).host : null; } catch { /* malformed origin */ }
    if (origin && originHost !== url.host) return json(403, { error: 'מקור לא מורשה' });
  }

  if (route === '/me' && method === 'GET') {
    const user = await currentUser(request, env);
    return json(200, { user: user ? publicUser(user, cfg) : null });
  }

  if (route === '/config' && method === 'GET') {
    return json(200, {
      ads: cfg.adsClient ? { client: cfg.adsClient, slots: cfg.adSlots } : null,
      adsPreview: cfg.adsPreview, contactEmail: cfg.contactEmail, gaId: cfg.gaId, googleClientId: cfg.googleClientId,
    });
  }

  if (route === '/auth/google' && method === 'POST') {
    if (!cfg.googleClientId) return json(404, { error: 'התחברות עם Google אינה מופעלת' });
    if (rateLimited(request.headers.get('CF-Connecting-IP') || 'local')) return json(429, { error: 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.' });
    const body = await readJson(request);
    let g;
    try {
      g = await verifyGoogleIdToken(body.credential, cfg.googleClientId);
    } catch (e) {
      if (!(e instanceof GoogleAuthError)) console.error(e);
      return json(401, { error: 'ההתחברות עם Google נכשלה. נסו שוב.' });
    }
    const name = g.name.slice(0, 80);
    let user = await env.DB.prepare('SELECT id, email, name FROM users WHERE google_sub = ?1').bind(g.sub).first();
    let created = false;
    if (!user) {
      const byEmail = await env.DB.prepare('SELECT id, email, name FROM users WHERE email = ?1').bind(g.email).first();
      if (byEmail) {
        // Same verified email under a new Google account id: keep the existing progress.
        await env.DB.prepare('UPDATE users SET google_sub = ?1 WHERE id = ?2').bind(g.sub, byEmail.id).run();
        user = byEmail;
      } else {
        user = await env.DB.prepare('INSERT INTO users (email, name, google_sub, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id, email, name')
          .bind(g.email, name, g.sub, Date.now()).first();
        created = true;
      }
    }
    const token = randomToken();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(Date.now()),
      env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)').bind(await sha256(token), user.id, Date.now() + SESSION_DAYS * 86400000),
    ]);
    return json(created ? 201 : 200, { user: publicUser(user, cfg), created }, { 'Set-Cookie': sessionCookie(request, token, SESSION_DAYS * 86400) });
  }

  if (route === '/logout' && method === 'POST') {
    const token = cookies(request).sid;
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(await sha256(token)).run();
    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(request, '', 0) });
  }

  if (route === '/leaderboard' && method === 'GET') {
    const board = ['week', 'all', 'game', 'xp'].includes(url.searchParams.get('board')) ? url.searchParams.get('board') : 'week';
    const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'he';
    return json(200, await leaderboard(env, board, await currentUser(request, env), lang));
  }

  // Activity log batches from Track (account.js). Times are moved onto the server's clock.
  if (route === '/track' && method === 'POST') {
    const body = await readJson(request);
    const now = Date.now();
    const sent = Number(body.now) || now;
    const events = (Array.isArray(body.events) ? body.events : []).slice(0, 50)
      .filter(e => e && EVENT_TYPES.has(e.type))
      .map(e => {
        const data = e.data && typeof e.data === 'object' ? JSON.stringify(e.data) : null;
        const at = now - (sent - (Number(e.at) || sent));
        return { at: Math.min(now, Math.max(now - 86400000, at)), type: e.type, path: clip(e.path, 200), data: data && data.length <= 2000 ? data : null };
      });
    await logEvents(request, env, cfg, events, body.ref);
    return json(204, null);
  }

  const user = await currentUser(request, env);
  if (!user) return json(401, { error: 'יש להתחבר' });

  if (route === '/profile' && method === 'GET') return json(200, await profile(env, user, cfg));

  if (route === '/results' && method === 'POST') {
    const body = await readJson(request);
    const r = cleanResult(body);
    if (!r) return json(400, { error: 'תוצאה לא תקינה' });
    const keys = cleanKeyStats(body.keyStats);
    const missed = cleanWords(body.missedWords).map(w => [w, 1]);
    const clean = cleanWords(body.cleanWords);
    let pb = false;
    const isTest = r.kind === 'test' && r.mode && r.chars > 0;
    if (isTest) {
      const prev = await env.DB.prepare('SELECT wpm FROM pbs WHERE user_id = ?1 AND mode = ?2').bind(user.id, r.mode).first();
      pb = !prev || Math.round(r.wpm) > prev.wpm;
    }
    const stmts = [env.DB.prepare(SQL.insertResult).bind(user.id, r.at, r.kind, r.mode, r.label, r.wpm, r.acc, r.cpm, r.secs, r.errors, r.chars, r.lessonId, r.stars)];
    if (keys.length) stmts.push(env.DB.prepare(SQL.keyStats).bind(user.id, JSON.stringify(keys)));
    if (missed.length) stmts.push(env.DB.prepare(SQL.addWords).bind(user.id, JSON.stringify(missed)));
    if (clean.length) {
      stmts.push(env.DB.prepare(SQL.healWords).bind(user.id, JSON.stringify(clean)));
      stmts.push(env.DB.prepare(SQL.purgeWords).bind(user.id));
    }
    if (r.kind === 'lesson' && r.lessonId != null && r.stars) {
      stmts.push(env.DB.prepare(SQL.lessons).bind(user.id, JSON.stringify([[r.lessonId, r.stars, Math.round(r.wpm), Math.round(r.acc)]])));
    }
    if (isTest) stmts.push(env.DB.prepare(SQL.pbs).bind(user.id, JSON.stringify([[r.mode, Math.round(r.wpm)]])));
    await env.DB.batch(stmts);
    return json(201, { ok: true, pb });
  }

  if (route === '/import' && method === 'POST') {
    // Merge progress a guest collected in the browser into their account.
    const body = await readJson(request);
    const keys = cleanKeyStats(body.keyStats);
    const history = Array.isArray(body.history) ? body.history.slice(-1000).map(cleanResult).filter(Boolean) : [];
    const words = body.wordErrors && typeof body.wordErrors === 'object'
      ? Object.entries(body.wordErrors).slice(0, 300).filter(([w]) => w.length <= 30).map(([w, c]) => [w, int(c, 1, 1000)]) : [];
    const lessons = body.lessons && typeof body.lessons === 'object'
      ? Object.entries(body.lessons).slice(0, 100).filter(([, l]) => l && l.stars)
        .map(([id, l]) => [int(id, 0, 1000), int(l.stars, 0, 3), int(l.wpm, 0, 400), int(l.acc, 0, 100)]) : [];
    const pbs = body.pbs && typeof body.pbs === 'object'
      ? Object.entries(body.pbs).slice(0, 100).map(([mode, wpm]) => [str(mode, 40), int(wpm, 0, 400)]) : [];
    const stmts = [];
    if (keys.length) stmts.push(env.DB.prepare(SQL.keyStats).bind(user.id, JSON.stringify(keys)));
    if (words.length) stmts.push(env.DB.prepare(SQL.addWords).bind(user.id, JSON.stringify(words)));
    if (lessons.length) stmts.push(env.DB.prepare(SQL.lessons).bind(user.id, JSON.stringify(lessons)));
    if (pbs.length) stmts.push(env.DB.prepare(SQL.pbs).bind(user.id, JSON.stringify(pbs)));
    if (history.length) stmts.push(env.DB.prepare(SQL.importResults).bind(user.id, JSON.stringify(history)));
    if (stmts.length) await env.DB.batch(stmts);
    return json(200, await profile(env, user, cfg));
  }

  if (route === '/state' && method === 'POST') {
    const body = await readJson(request);
    const cur = await env.DB.prepare('SELECT data, nickname, show_on_board FROM user_state WHERE user_id = ?1').bind(user.id).first();
    let game = cur ? JSON.parse(cur.data || '{}') : {};
    if (body.game !== undefined) {
      const g = cleanGame(body.game);
      if (!g) return json(400, { error: 'נתוני משחק לא תקינים' });
      game = g;
    }
    let nickname = cur ? cur.nickname : null;
    if (body.nickname !== undefined) {
      const n = str(body.nickname, 40).trim();
      if (n && !NICK_RE.test(n)) return json(400, { error: 'כינוי: 2 עד 20 אותיות, ספרות או רווחים.' });
      nickname = n || null;
    }
    const show = body.showOnBoard !== undefined ? (body.showOnBoard ? 1 : 0) : (cur ? cur.show_on_board : 1);
    await env.DB.prepare(`INSERT INTO user_state (user_id, data, xp, nickname, show_on_board, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                          ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, xp = excluded.xp, nickname = excluded.nickname,
                          show_on_board = excluded.show_on_board, updated_at = excluded.updated_at`)
      .bind(user.id, JSON.stringify(game), int(game.xp, 0, 1e7), nickname, show, Date.now()).run();
    return json(200, { ok: true, nickname: nickname || '', showOnBoard: show === 1 });
  }

  if (route === '/game' && method === 'POST') {
    const body = await readJson(request);
    if (!GAME_MODES.has(body.mode)) return json(400, { error: 'משחק לא תקין' });
    await env.DB.prepare('INSERT INTO game_scores (user_id, at, mode, score) VALUES (?1, ?2, ?3, ?4)')
      .bind(user.id, Date.now(), body.mode, int(body.score, 0, 100000)).run();
    return json(201, { ok: true });
  }

  if (route === '/stats/reset' && method === 'POST') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM key_stats WHERE user_id = ?1').bind(user.id),
      env.DB.prepare('DELETE FROM word_errors WHERE user_id = ?1').bind(user.id),
    ]);
    return json(200, { ok: true });
  }

  if (route === '/admin/stats' && method === 'GET') {
    if (!cfg.admins.has(String(user.email).toLowerCase())) return json(403, { error: 'אין הרשאה' });
    const days = [7, 30, 90, 365].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
    return json(200, await adminStats(env, days, cfg));
  }

  if (route === '/admin/activity' && method === 'GET') {
    if (!cfg.admins.has(String(user.email).toLowerCase())) return json(403, { error: 'אין הרשאה' });
    const day = url.searchParams.get('day') || '';
    return json(200, await activityDay(env, cfg, /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) ? day : dayOf(Date.now(), cfg.tz)));
  }

  if (route === '/admin/person' && method === 'GET') {
    if (!cfg.admins.has(String(user.email).toLowerCase())) return json(403, { error: 'אין הרשאה' });
    const r = await activityPerson(env, cfg, url.searchParams.get('key') || '');
    return r && r.person ? json(200, r) : json(404, { error: 'לא נמצא' });
  }

  return json(404, { error: 'לא נמצא' });
}

// ---------- Search engines: per-page titles, descriptions, sitemap ----------
const SITE = 'הקלדה עיוורת';
// Other names people search for the site by: the domain, in Latin letters and in Hebrew.
const SITE_ALT_NAMES = ['Hakladaivrit', 'Haklada Ivrit', 'hakladaivrit.com', 'הקלדה עברית', 'הקלדה עיוורת בעברית'];
const HOME_DESC = 'למדו להקליד בעברית מהר ומדויק בעשר אצבעות: מבחן מהירות, 25 שיעורים מדורגים ותרגול חכם, בחינם.';
const PAGES = {
  '/': { title: 'הקלדה עיוורת בעברית | מבחן הקלדה, שיעורים ותרגול', desc: HOME_DESC, priority: '1.0', content: 'home' },
  '/guide': { title: 'מדריך הקלדה עיוורת בעברית: אצבעות, שורת הבית ותוכנית לימוד | הקלדה עיוורת', priority: '0.9', crumb: 'מדריך',
    content: 'guide', desc: 'מדריך מלא ללימוד הקלדה עיוורת בעברית: איזו אצבע לוחצת על כל מקש, שורת הבית, אותיות סופיות, תנוחה נכונה, תוכנית לימוד ושאלות נפוצות.' },
  '/test': { title: 'מבחן הקלדה בעברית: בדקו את מהירות ההקלדה שלכם | הקלדה עיוורת', priority: '0.9', crumb: 'מבחן הקלדה', info: 'test',
    desc: 'מבחן מהירות הקלדה חינמי בעברית לפי זמן, מספר מילים או ציטוט. קבלו מילים לדקה, תווים לדקה, דיוק ורשימה של המקשים שכדאי לשפר.' },
  '/lessons': { title: 'שיעורי הקלדה עיוורת בעברית: 25 שיעורים מדורגים | הקלדה עיוורת', priority: '0.9', crumb: 'שיעורים', info: 'lessons',
    desc: 'למדו הקלדה עיוורת בעברית צעד אחר צעד: שורת הבית, השורה העליונה והתחתונה, פיסוק ומספרים, עם ידיים וירטואליות שמראות איזו אצבע ללחוץ.' },
  '/practice': { title: 'תרגול הקלדה בעברית שמתמקד במקשים החלשים שלכם | הקלדה עיוורת', priority: '0.8', crumb: 'תרגול', info: 'practice',
    desc: 'תרגול הקלדה חכם בעברית: האתר מזהה את המקשים והמילים שבהם אתם טועים ובונה תרגילים שמחזקים בדיוק אותם.' },
  '/game': { title: 'משחק הקלדה לילדים: פוצצו את הבלונים | הקלדה עיוורת', priority: '0.9', crumb: 'משחק הבלונים', info: 'game',
    desc: 'משחק הקלדה חינמי בעברית לילדים: מפוצצים בלונים עם אותיות ומילים ולומדים איפה כל אות במקלדת, עם ידיים שמראות איזו אצבע ללחוץ.' },
  '/texts': { title: 'טקסטים להקלדה: היסטוריה, מדע וטבע | הקלדה עיוורת', priority: '0.8', crumb: 'טקסטים', info: 'texts',
    desc: 'טקסטים קצרים ומעניינים לתרגול הקלדה עיוורת בעברית: היסטוריה, מדע וחלל, בעלי חיים והשפה העברית. אפשר גם לתרגל על חומר הלימוד שלכם.' },
  '/leaderboard': { title: 'טבלת האלופים: המקלידים המהירים בעברית | הקלדה עיוורת', priority: '0.6', crumb: 'טבלת האלופים', info: 'leaderboard',
    desc: 'מי מקליד הכי מהר בעברית? טבלת המהירות השבועית, טבלת כל הזמנים, משחק הבלונים ונקודות XP.' },
  '/english': { title: 'הקלדה עיוורת באנגלית: מבחן, שיעורים ותרגול בחינם | הקלדה עיוורת', priority: '0.8', crumb: 'הקלדה באנגלית', content: 'english',
    desc: 'לומדים הקלדה עיוורת באנגלית בחינם: 24 שיעורים מדורגים, מבחן מהירות, תרגול חכם ומשחק, עם הסברים בעברית וידיים שמראות איזו אצבע ללחוץ.' },
  '/texts/mine': { title: 'תרגול הקלדה על טקסט משלכם | הקלדה עיוורת', desc: HOME_DESC, noindex: true },
  '/privacy': { title: 'מדיניות פרטיות | הקלדה עיוורת', priority: '0.3', crumb: 'מדיניות פרטיות',
    desc: 'איזה מידע האתר הקלדה עיוורת אוסף, איך הוא משמש ואיך אפשר למחוק אותו.' },
  '/profile': { title: 'הפרופיל שלי | הקלדה עיוורת', desc: HOME_DESC, noindex: true },
  '/admin': { title: 'לוח ניהול | הקלדה עיוורת', desc: HOME_DESC, noindex: true },
};

// The English site (/en): the same pages, in English, teaching English typing. The keys are
// the addresses without /en. Pages that exist on both sites point to each other (hreflang).
const SITE_EN = 'Hakladaivrit';
const HOME_DESC_EN = 'Learn to type fast and accurately with all ten fingers: a typing speed test, 24 step-by-step lessons and smart practice, free.';
const PAGES_EN = {
  '/': { title: 'Free Touch Typing Lessons and Typing Test | Hakladaivrit', desc: HOME_DESC_EN, priority: '1.0', content: 'home' },
  '/guide': { title: 'Touch Typing Guide: Finger Placement, Home Row and a Practice Plan | Hakladaivrit', priority: '0.9', crumb: 'Guide',
    content: 'guide', desc: 'A complete guide to touch typing: which finger presses each key, the home row, posture, a practice plan and answers to common questions.' },
  '/test': { title: 'Typing Speed Test: Check Your WPM and Accuracy | Hakladaivrit', priority: '0.9', crumb: 'Typing test', info: 'test',
    desc: 'A free typing speed test by time, word count or quote. Get your words per minute, characters per minute, accuracy and the keys worth improving.' },
  '/lessons': { title: 'Touch Typing Lessons: 24 Step-by-Step Lessons | Hakladaivrit', priority: '0.9', crumb: 'Lessons', info: 'lessons',
    desc: 'Learn touch typing step by step: the home row, the top and bottom rows, capitals, punctuation and numbers, with virtual hands that show which finger to use.' },
  '/practice': { title: 'Typing Practice That Targets Your Weak Keys | Hakladaivrit', priority: '0.8', crumb: 'Practice', info: 'practice',
    desc: 'Smart typing practice: the site finds the keys and words you get wrong and builds exercises that strengthen exactly those.' },
  '/game': { title: 'Typing Game for Kids: Pop the Balloons | Hakladaivrit', priority: '0.9', crumb: 'Balloon game', info: 'game',
    desc: 'A free typing game for kids: pop balloons with letters and words and learn where every letter is on the keyboard, with hands that show which finger to use.' },
  '/texts': { title: 'Typing Practice Texts: History, Science and Nature | Hakladaivrit', priority: '0.8', crumb: 'Texts', info: 'texts',
    desc: 'Short, interesting texts for touch typing practice: history, science and space, animals and the English language. You can also practice on your own text.' },
  '/leaderboard': { title: 'Leaderboard: The Fastest Typists | Hakladaivrit', priority: '0.6', crumb: 'Leaderboard', info: 'leaderboard',
    desc: 'Who types the fastest? The weekly speed table, the all-time table, the balloon game and XP points.' },
  '/texts/mine': { title: 'Type Your Own Text | Hakladaivrit', desc: HOME_DESC_EN, noindex: true },
  '/privacy': { title: 'Privacy Policy | Hakladaivrit', priority: '0.3', crumb: 'Privacy policy',
    desc: 'What information Hakladaivrit collects, how it is used and how you can delete it.' },
  '/profile': { title: 'My Stats | Hakladaivrit', desc: HOME_DESC_EN, noindex: true },
  '/admin': { title: 'Admin | Hakladaivrit', desc: HOME_DESC_EN, noindex: true },
};
const EN_PREFIX = /^\/en(?=\/|$)/;

// Lesson titles and descriptions come from public/js/data.js (Hebrew course) and
// public/js/data-en.js (English course, EN_LESSONS_EN for its English text), the files the site uses.
const sourceCache = {};
async function source(env, origin, file) {
  if (!sourceCache[file]) sourceCache[file] = await (await env.ASSETS.fetch(new Request(origin + file))).text();
  return sourceCache[file];
}
const unq = s => s.replace(/\\'/g, "'");
const field = (s, name) => { const f = new RegExp(`${name}:\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(s); return f ? unq(f[1]) : null; };
const strings = s => [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"([^"]*)"/g)].map(x => (x[2] != null ? x[2] : unq(x[1])));
const block = (src, name) => (new RegExp(`const ${name} = [\\[{]([\\s\\S]*?)\\n[\\]}];`).exec(src) || [, ''])[1];

const lessonCache = {}, keyCache = {};
async function lessons(env, origin, lang = 'he') {
  if (lessonCache[lang]) return lessonCache[lang];
  const he = await source(env, origin, '/js/data.js');
  const en = lang === 'en' ? await source(env, origin, '/js/data-en.js') : '';
  const own = lang === 'en' ? {} : null;
  if (own) {
    for (const m of `${block(en, 'EN_LESSONS_EN')}\n`.matchAll(/(\d+):\s*\{([\s\S]*?)\},?\n/g)) {
      own[m[1]] = { group: field(m[2], 'group'), title: field(m[2], 'title'), desc: field(m[2], 'desc') };
    }
  }
  const list = [];
  const re = /\{\s*id:\s*(\d+),([\s\S]*?)desc:\s*'((?:[^'\\]|\\.)*)'\s*\}/g;
  for (const m of block(lang === 'en' ? en : he, lang === 'en' ? 'EN_LESSONS' : 'LESSONS').matchAll(re)) {
    const keys = /newKeys:\s*\[([^\]]*)\]/.exec(m[2]);
    const target = /target:\s*(\d+)/.exec(m[2]);
    const tr = own ? own[m[1]] || {} : {};
    list.push({
      id: Number(m[1]), title: tr.title || field(m[2], 'title') || m[1], desc: tr.desc || unq(m[3]),
      group: (own ? tr.group : field(m[2], 'group')) || (list.length ? list[list.length - 1].group : ''),
      type: field(m[2], 'type'), newKeys: keys ? strings(keys[1]) : [], target: target ? Number(target[1]) : 0,
    });
  }
  keyCache[lang] = keyboard(he, en, lang);
  lessonCache[lang] = list;
  return list;
}

// Each key's finger, row and (on the Hebrew site) English label, from KEY_ROWS, SHIFT_CHARS
// and FINGER_NAMES in data.js, and EN_KEYS and FINGER_NAMES_EN in data-en.js.
function keyboard(he, en, lang) {
  const names = src => Object.fromEntries([...src.matchAll(/(\w+):\s*'([^']*)'/g)].map(x => [x[1], x[2]]));
  const fingers = names(block(lang === 'en' ? en : he, lang === 'en' ? 'FINGER_NAMES_EN' : 'FINGER_NAMES'));
  const rows = lang === 'en' ? ['number row', 'top row', 'home row', 'bottom row'] : ['שורת המספרים', 'השורה העליונה', 'שורת הבית', 'השורה התחתונה'];
  const keys = {}, byCode = {};
  block(he, 'KEY_ROWS').split(/\n\s*\],\s*\n\s*\[/).forEach((row, ri) => {
    for (const k of row.matchAll(/\[\s*'(\w+)',\s*((?:'(?:[^'\\]|\\.)*'|"[^"]*"),\s*(?:'(?:[^'\\]|\\.)*'|"[^"]*")),\s*'(\w+)'/g)) {
      const [heCh, enCh] = strings(k[2]);
      byCode[k[1]] = { en: enCh || heCh, finger: fingers[k[3]], row: rows[ri] };
      const ch = lang === 'en' ? (enCh || heCh).toLowerCase() : heCh;
      if (k[3] !== 'mod' && !keys[ch]) keys[ch] = { ...byCode[k[1]], label: (enCh || heCh).toUpperCase() };
    }
  });
  const shifted = lang === 'en'
    ? [...block(en, 'EN_KEYS').matchAll(/(\w+):\s*\[[^,\]]+,\s*('(?:[^'\\]|\\.)*'|"[^"]*")\]/g)]
    : [...block(he, 'SHIFT_CHARS').matchAll(/(\w+):\s*('(?:[^'\\]|\\.)*'|"[^"]*")/g)];
  for (const x of shifted) {
    const ch = strings(x[2])[0], k = byCode[x[1]];
    if (k && !keys[ch]) keys[ch] = { ...k, label: `Shift + ${k.en.toUpperCase()}` };
  }
  return keys;
}

const textsCache = {};
async function textsData(env, origin, lang = 'he') {
  if (textsCache[lang]) return textsCache[lang];
  const r = await env.ASSETS.fetch(new Request(origin + (lang === 'en' ? '/data/texts-en.json' : '/data/texts.json')));
  textsCache[lang] = r.ok ? await r.json() : { categories: {}, texts: [] };
  return textsCache[lang];
}

// What to serve for an address: its language (/en is the English site), title, description and
// what goes in the page. `path` is the full address, `local` the same page without /en.
async function pageMeta(env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const lang = EN_PREFIX.test(path) ? 'en' : 'he';
  const local = path.replace(EN_PREFIX, '') || '/';
  const base = lang === 'en' ? '/en' : '';
  const L = (heText, enText) => (lang === 'en' ? enText : heText);
  const site = { path, local, lang, base, L };
  const pages = lang === 'en' ? PAGES_EN : PAGES;
  if (pages[local]) return { ...site, ...pages[local] };
  const lesson = /^\/lesson\/(\d+)$/.exec(local);
  if (lesson) {
    const all = await lessons(env, url.origin, lang);
    const l = all.find(x => x.id === Number(lesson[1]));
    if (!l) return null;
    return {
      ...site, lesson: l, total: all.length, crumb: L(`שיעור ${l.id}`, `Lesson ${l.id}`),
      title: L(`שיעור ${l.id}: ${l.title} | הקלדה עיוורת`, `Lesson ${l.id}: ${l.title} | Hakladaivrit`),
      desc: L(`שיעור ${l.id} מתוך ${all.length} בקורס ההקלדה העיוורת בעברית. ${l.desc}`, `Lesson ${l.id} of ${all.length} in the free touch typing course. ${l.desc}`),
    };
  }
  const text = /^\/texts\/([\w-]+)$/.exec(local);
  if (text) {
    const data = await textsData(env, url.origin, lang);
    const t = data.texts.find(x => x.slug === text[1]);
    if (!t) return null;
    const cat = data.categories[t.category] || '';
    return {
      ...site, text: t, category: cat, crumb: t.title,
      title: L(`${t.title}: טקסט להקלדה | הקלדה עיוורת`, `${t.title}: Typing Text | Hakladaivrit`),
      desc: L(`${t.intro} טקסט קצר על ${cat || 'נושא מעניין'} לתרגול הקלדה עיוורת בעברית.`, `${t.intro} A short text about ${(cat || 'an interesting topic').toLowerCase()} for touch typing practice.`),
    };
  }
  if (/^\/custom\/[\w-]+$/.test(local)) return { ...site, title: L('שיעור אישי | הקלדה עיוורת', 'Personal Lesson | Hakladaivrit'), desc: L(HOME_DESC, HOME_DESC_EN), noindex: true };
  return null;
}

// Public address for canonical links and the sitemap: always https except on this computer.
const siteOrigin = url => (/^(localhost|127\.|\[::1\])/.test(url.hostname) ? url.origin : `https://${url.host}`);

const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function structuredData(meta, origin, body) {
  const { L, base, local } = meta;
  const lang = meta.lang;
  const home = `${origin}${base || ''}/`.replace(/\/en\/$/, '/en');
  const name = L(SITE, SITE_EN);
  const org = { '@type': 'Organization', '@id': `${origin}/#organization`, name: SITE, alternateName: SITE_ALT_NAMES, url: `${origin}/`, logo: `${origin}/icon-512.png` };
  const page = `${origin}${meta.path}`;
  const faq = body.faq && body.faq.length ? {
    '@type': 'FAQPage', '@id': `${local === '/' ? home : page}#faq`,
    mainEntity: body.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  } : null;
  const trail = [{ name, item: home }];
  if (meta.lesson) trail.push({ name: L('שיעורים', 'Lessons'), item: `${origin}${base}/lessons` });
  if (meta.text) trail.push({ name: L('טקסטים', 'Texts'), item: `${origin}${base}/texts` });
  if (meta.crumb) trail.push({ name: meta.crumb, item: page });
  const crumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: t.item })),
  };
  const price = { '@type': 'Offer', price: '0', priceCurrency: L('ILS', 'USD') };
  const graph = [];
  if (local === '/') {
    graph.push(
      { '@type': 'WebSite', '@id': `${home}#website`, url: home, name, alternateName: L(SITE_ALT_NAMES, ['Hakladaivrit touch typing', 'hakladaivrit.com']), inLanguage: lang, publisher: { '@id': org['@id'] } },
      org,
      {
        '@type': 'WebApplication', name: L('הקלדה עיוורת בעברית', 'Hakladaivrit touch typing'), url: home, inLanguage: lang,
        applicationCategory: 'EducationalApplication', operatingSystem: 'Any', browserRequirements: L('דפדפן מודרני ומקלדת פיזית', 'A modern browser and a physical keyboard'),
        isAccessibleForFree: true, description: L(HOME_DESC, HOME_DESC_EN), image: `${origin}/og-image.png`, offers: price,
        featureList: L(
          ['מבחן מהירות הקלדה בעברית', `${body.lessonCount} שיעורי הקלדה עיוורת מדורגים`, 'ידיים וירטואליות שמראות איזו אצבע ללחוץ', 'תרגול חכם של מקשים חלשים', 'ניתוח דיוק ומהירות לכל מקש ואצבע'],
          ['Typing speed test', `${body.lessonCount} step-by-step touch typing lessons`, 'Virtual hands that show which finger to use', 'Smart practice of weak keys', 'Speed and accuracy analysis for every key and finger']),
      },
    );
  } else {
    graph.push(crumbs);
  }
  if (local === '/guide') {
    graph.push({
      '@type': 'Article', headline: L('מדריך הקלדה עיוורת בעברית', 'Touch typing guide'), description: meta.desc, inLanguage: lang,
      url: page, mainEntityOfPage: page, image: `${origin}/og-image.png`,
      author: { '@id': org['@id'] }, publisher: org, datePublished: L('2026-09-29', '2026-10-03'), dateModified: L('2026-09-29', '2026-10-03'),
    });
  }
  if (local === '/lessons' && body.lessons) {
    graph.push({
      '@type': 'Course', name: L('קורס הקלדה עיוורת בעברית', 'Touch typing course'), description: meta.desc, url: page, inLanguage: lang,
      isAccessibleForFree: true, provider: org, educationalLevel: L('מתחילים', 'Beginner'),
      offers: { ...price, category: 'Free' },
      hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'online', courseWorkload: 'PT4H' },
      syllabusSections: body.lessons.map(l => ({ '@type': 'Syllabus', name: `${L('שיעור', 'Lesson')} ${l.id}: ${l.title}`, description: l.desc, url: `${origin}${base}/lesson/${l.id}` })),
    });
  }
  if (meta.text) {
    graph.push({
      '@type': 'Article', headline: meta.text.title, description: meta.text.intro, inLanguage: lang,
      articleSection: meta.category, url: page, mainEntityOfPage: page,
      image: `${origin}/og-image.png`, author: { '@id': org['@id'] }, publisher: org, isAccessibleForFree: true,
      audience: { '@type': 'Audience', audienceType: meta.text.audience === 'kids' ? L('ילדים', 'Children') : L('כל הגילים', 'All ages') },
    });
  }
  if (local === '/game') {
    graph.push({
      '@type': 'VideoGame', name: L('משחק הבלונים', 'Balloon typing game'), description: meta.desc, url: page, inLanguage: lang,
      genre: L('משחק חינוכי', 'Educational game'), gamePlatform: L('דפדפן', 'Web browser'), applicationCategory: 'Game', isAccessibleForFree: true,
      audience: { '@type': 'PeopleAudience', suggestedMinAge: 6 }, offers: price,
    });
  }
  if (faq) graph.push(faq);
  return { '@context': 'https://schema.org', '@graph': graph };
}

// ---------- Page text in the HTML (for crawlers that don't run JavaScript) ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripTags = h => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function fragment(env, url, name, lang) {
  const r = await env.ASSETS.fetch(new Request(`${url.origin}/content/${lang === 'en' ? 'en/' : ''}${name}.html`));
  return r.ok ? r.text() : '';
}
function faqFrom(html) {
  const out = [];
  const re = /<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g;
  let m;
  while ((m = re.exec(html))) out.push({ q: stripTags(m[1]), a: stripTags(m[2]) });
  return out;
}
// Links in the English site's HTML point inside /en (the page's JS does the same in the browser).
const localLinks = (html, base) => (!base ? html : html.replace(/href="\/([^"]*)"/g, (m, p) => (/^en($|[/?#])/.test(p) ? m : `href="${base}${p && !/^[?#]/.test(p) ? '/' : ''}${p}"`)));

async function pageBody(env, url, meta) {
  const body = await pageContent(env, url, meta);
  body.html = localLinks(body.html, meta.base);
  return body;
}

async function pageContent(env, url, meta) {
  const { L, lang, local } = meta;
  if (meta.content) {
    const html = await fragment(env, url, meta.content, lang);
    const lessonCount = local === '/' ? (await lessons(env, url.origin, lang)).length : 0;
    return { html, ssr: meta.content, faq: faqFrom(html), lessonCount };
  }
  if (local === '/lessons') {
    const all = await lessons(env, url.origin, lang);
    const list = `<section class="page"><h1>${L('שיעורי הקלדה עיוורת בעברית', 'Touch typing lessons')}</h1>
<p>${L(`${all.length} שיעורים מדורגים: מתחילים בשורת הבית, ומשם כל שיעור מוסיף שני מקשים חדשים, מהאותיות הנפוצות אל הנדירות.`,
    `${all.length} step-by-step lessons: start on the home row, then each lesson adds two new keys, from the most common letters to the rarest.`)}</p>
<ol>${all.map(l => `<li><a href="/lesson/${l.id}">${L('שיעור', 'Lesson')} ${l.id}: ${esc(l.title)}</a>. ${esc(l.desc)}</li>`).join('')}</ol></section>`;
    return { html: list + await fragment(env, url, 'lessons', lang), lessons: all };
  }
  if (local === '/texts') {
    const data = await textsData(env, url.origin, lang);
    const list = `<section class="page"><h1>${L('טקסטים להקלדה', 'Texts to type')}</h1>
<p>${L('מתרגלים הקלדה עיוורת ולומדים משהו חדש בדרך: היסטוריה, מדע, טבע והשפה העברית.', 'Practice touch typing and learn something new on the way: history, science, nature and the English language.')}</p>
${Object.entries(data.categories).map(([k, name]) => `<h2>${esc(name)}</h2><ul>${data.texts.filter(t => t.category === k)
    .map(t => `<li><a href="/texts/${t.slug}">${esc(t.title)}</a>. ${esc(t.intro)}</li>`).join('')}</ul>`).join('\n')}
<p><a href="/texts/mine">${L('תרגול על טקסט משלכם', 'Practice on your own text')}</a></p></section>`;
    return { html: list + await fragment(env, url, 'texts', lang) };
  }
  if (meta.info) {
    const html = await fragment(env, url, meta.info, lang);
    return { html, ssr: meta.info };
  }
  if (meta.text) {
    // The same "about this text" box the page shows under the typing area (texts.js, viewText).
    const t = meta.text;
    const data = await textsData(env, url.origin, lang);
    const related = data.texts.filter(x => x.category === t.category && x !== t);
    const words = t.text.split(' ').length;
    const mins = Math.max(1, Math.round(words / 30));
    return {
      html: `<article class="page"><div class="lesson-head"><a class="back" href="/texts">${L('כל הטקסטים', 'All texts')}</a>
<div class="lesson-meta">${esc(meta.category)} · ${esc(t.level)}</div><h1>${esc(t.title)}</h1><p>${esc(t.intro)}</p></div>
<p>${esc(t.text)}</p>
<div class="page-info content"><h2>${L('על הטקסט', 'About this text')}</h2>
<p>${L(`${words} מילים ו־${t.text.length} תווים. בקצב של 30 מילים לדקה מקלידים אותו ${mins === 1 ? 'בדקה אחת בערך' : `בערך ב־${mins} דקות`}.`,
    `${words} words and ${t.text.length} characters. At 30 words per minute it takes about ${mins === 1 ? 'one minute' : `${mins} minutes`} to type.`)}</p>
${related.length ? `<h3>${L('עוד טקסטים', 'More texts')}: ${esc(meta.category)}</h3><ul>${related.map(x => `<li><a href="/texts/${x.slug}">${esc(x.title)}</a> – ${esc(x.intro)}</li>`).join('')}</ul>` : ''}
<p><a href="/texts">${L('כל הטקסטים', 'All texts')}</a> · <a href="/texts/mine">${L('תרגול על טקסט משלכם', 'Practice on your own text')}</a> · <a href="/test">${L('מבחן הקלדה', 'Typing test')}</a></p></div></article>`,
    };
  }
  if (meta.lesson) {
    // The same "what this lesson teaches" box the page shows under the exercise (app.js, lessonAbout).
    const l = meta.lesson;
    const all = await lessons(env, url.origin, lang);
    const keyInfo = keyCache[lang];
    const idx = all.indexOf(l);
    const keys = l.newKeys.filter(k => keyInfo[k]).map(k => {
      const info = keyInfo[k];
      return `<tr><td>${esc(k)}</td><td>${esc(info.finger)}</td><td>${esc(info.row)}</td>${L(`<td dir="ltr">${esc(info.label)}</td>`, '')}</tr>`;
    }).join('');
    const letter = L(/^[א-ת]$/, /^[a-z]$/);
    const letters = l.type ? [] : [...new Set(all.slice(0, idx + 1).filter(x => !x.type).flatMap(x => x.newKeys).filter(k => letter.test(k)))];
    const link = x => `<a href="/lesson/${x.id}">${L('שיעור', 'Lesson')} ${x.id}: ${esc(x.title)}</a>`;
    const prev = all[idx - 1], next = all[idx + 1];
    return {
      html: `<section class="page"><div class="lesson-head"><a class="back" href="/lessons">${L('כל השיעורים', 'All lessons')}</a>
<div class="lesson-meta">${L(`שיעור ${l.id} מתוך ${meta.total}`, `Lesson ${l.id} of ${meta.total}`)} · ${esc(l.group)}</div><h1>${esc(l.title)}</h1><p>${esc(l.desc)}</p></div>
<div class="page-info content"><h2>${L(`מה לומדים בשיעור ${l.id}`, `What you learn in lesson ${l.id}`)}</h2>
<p>${L(`השיעור שייך לפרק "${esc(l.group)}" בקורס של ${meta.total} שיעורים. לשלושה כוכבים צריך דיוק של 97% ומעלה ולפחות ${l.target} מילים לדקה.`,
    `This lesson is part of "${esc(l.group)}" in a course of ${meta.total} lessons. For three stars you need at least 97% accuracy and ${l.target} words per minute.`)}</p>
${keys ? `<h3>${L('המקשים החדשים', 'New keys')}</h3><div class="table-wrap"><table><thead><tr><th>${L('מקש', 'Key')}</th><th>${L('אצבע', 'Finger')}</th><th>${L('שורה', 'Row')}</th>${L('<th>המקש באנגלית</th>', '')}</tr></thead><tbody>${keys}</tbody></table></div>` : ''}
${letters.length ? `<p>${L('האותיות שלמדתם עד עכשיו', 'Letters you know so far')} (${letters.length}): ${letters.map(esc).join(' ')}</p>` : ''}
<h3>${L('השיעורים הסמוכים', 'Nearby lessons')}</h3><ul>${prev ? `<li>${L('השיעור הקודם', 'Previous lesson')}: ${link(prev)}</li>` : ''}${next ? `<li>${L('השיעור הבא', 'Next lesson')}: ${link(next)}</li>` : ''}
<li><a href="/lessons">${L('כל השיעורים', 'All lessons')}</a> · <a href="/guide">${L('מדריך הקלדה עיוורת', 'Touch typing guide')}</a> · <a href="/test">${L('מבחן הקלדה', 'Typing test')}</a></li></ul></div></section>`,
    };
  }
  return { html: '' };
}

// The same page on the other site, for pages that exist on both (hreflang).
function alternates(meta, origin) {
  if (meta.noindex || !PAGES[meta.local] || !PAGES_EN[meta.local]) return '';
  const he = `${origin}${meta.local}`;
  const en = `${origin}/en${meta.local === '/' ? '' : meta.local}`;
  return `  <link rel="alternate" hreflang="he" href="${attr(he)}">\n  <link rel="alternate" hreflang="en" href="${attr(en)}">\n` +
    `  <link rel="alternate" hreflang="x-default" href="${attr(en)}">\n`;
}

function withMeta(html, meta, origin, body) {
  const url = `${origin}${meta.path}`;
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${attr(meta.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(meta.desc)}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(meta.title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(meta.desc)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${attr(url)}">`);
  let head = `  <link rel="canonical" href="${attr(url)}">\n${alternates(meta, origin)}`;
  if (meta.noindex) head += '  <meta name="robots" content="noindex">\n';
  else if (meta.crumb || meta.local === '/') {
    head += `  <script type="application/ld+json">${JSON.stringify(structuredData(meta, origin, body)).replace(/</g, '\\u003c')}</script>\n`;
  }
  html = html.replace('</head>', `${head}</head>`);
  if (body.html) {
    html = html.replace('<main id="view"></main>', `<main id="view"${body.ssr ? ` data-ssr="${body.ssr}"` : ''}>${body.html}</main>`);
  }
  return html;
}

async function sitemap(env, origin) {
  const paths = [];
  for (const [lang, pages, base] of [['he', PAGES, ''], ['en', PAGES_EN, '/en']]) {
    Object.entries(pages).filter(([, p]) => !p.noindex).forEach(([path, p]) => paths.push([path === '/' ? base || '/' : base + path, p.priority]));
    (await lessons(env, origin, lang)).forEach(l => paths.push([`${base}/lesson/${l.id}`, '0.7']));
    (await textsData(env, origin, lang)).texts.forEach(t => paths.push([`${base}/texts/${t.slug}`, '0.6']));
  }
  const urls = paths.map(([p, pr]) => `  <url><loc>${origin}${p}</loc><priority>${pr}</priority></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// Search engines and AI assistants (ChatGPT, Gemini, Claude, Perplexity, Copilot…) are all welcome.
const CRAWLERS = ['Googlebot', 'Google-Extended', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'ClaudeBot', 'Claude-SearchBot',
  'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Applebot', 'Applebot-Extended', 'DuckDuckBot', 'CCBot'];
const RULES = 'Allow: /\nDisallow: /api/\nDisallow: /profile\nDisallow: /admin\nDisallow: /custom/\nDisallow: /en/profile\nDisallow: /en/admin\nDisallow: /en/custom/\n';
const robots = origin => `${CRAWLERS.map(c => `User-agent: ${c}`).join('\n')}\n${RULES}\nUser-agent: *\n${RULES}\nSitemap: ${origin}/sitemap.xml\n`;

// A plain-language summary for AI assistants (https://llmstxt.org).
async function llmsTxt(env, url, origin) {
  const all = await lessons(env, url.origin);
  return `# הקלדה עיוורת בעברית (hakladaivrit.com)

> אתר חינמי ללימוד הקלדה עיוורת בעברית, בעשר אצבעות ובלי להסתכל על המקלדת. יש בו מבחן מהירות הקלדה, קורס של ${all.length} שיעורים מדורגים עם מקלדת וידיים וירטואליות שמראות איזו אצבע ללחוץ, ותרגול חכם שמתמקד במקשים שבהם כל משתמש טועה. אין צורך בהרשמה. התחברות עם Google שומרת את ההתקדמות ובונה שיעורים אישיים.

עובדות:
- חינם לגמרי, בעברית, עובד בכל דפדפן במחשב עם מקלדת פיזית.
- פריסת המקלדת העברית התקנית. עובד גם כשהמחשב מוגדר לאנגלית, כי האתר מזהה את המיקום הפיזי של המקש.
- מודד מילים לדקה (WPM), תווים לדקה (CPM) ודיוק, ומנתח דיוק ומהירות לכל מקש, אצבע ושורה.

## עמודים עיקריים
- [דף הבית](${origin}/): מה זו הקלדה עיוורת ולמה כדאי ללמוד אותה.
- [מדריך הקלדה עיוורת בעברית](${origin}/guide): איזו אצבע לוחצת על כל מקש, שורת הבית, אותיות סופיות, תנוחה נכונה, תוכנית לימוד ושאלות נפוצות.
- [מבחן הקלדה בעברית](${origin}/test): מבחן מהירות לפי זמן, מספר מילים או ציטוט.
- [שיעורי הקלדה](${origin}/lessons): קורס של ${all.length} שיעורים מדורגים.
- [תרגול חכם](${origin}/practice): תרגול שמתמקד במקשים החלשים של המשתמש.
- [משחק הבלונים](${origin}/game): משחק הקלדה לילדים. מפוצצים בלונים עם אותיות ומילים.
- [הקלדה עיוורת באנגלית](${origin}/english): אותם שיעורים, מבחן, תרגול ומשחק באנגלית, עם הסברים בעברית.
- [טקסטים להקלדה](${origin}/texts): טקסטים קצרים על היסטוריה, מדע, טבע והשפה העברית, ותרגול על חומר לימוד אישי.
- [טבלת האלופים](${origin}/leaderboard): טבלת מהירות שבועית, משחק ונקודות XP.

## השיעורים
${all.map(l => `- [שיעור ${l.id}: ${l.title}](${origin}/lesson/${l.id}): ${l.desc}`).join('\n')}

## טקסטים
${(await textsData(env, url.origin)).texts.map(t => `- [${t.title}](${origin}/texts/${t.slug}): ${t.intro}`).join('\n')}

## English site (${origin}/en)
> The same site in English, teaching English touch typing on the US QWERTY layout: a typing speed test, ${(await lessons(env, url.origin, 'en')).length} step-by-step lessons, smart practice of weak keys, a typing game for kids and texts to type. Free, no sign-up needed.

${Object.entries(PAGES_EN).filter(([, p]) => !p.noindex).map(([p, m]) => `- [${m.title.replace(/ \| Hakladaivrit$/, '')}](${origin}/en${p === '/' ? '' : p}): ${m.desc}`).join('\n')}
`;
}

// ---------- HTML page ----------
// With ads on, Google's ad scripts load other scripts and frames from many domains, so scripts
// are trusted by a per-request nonce ('strict-dynamic') instead of by host.
function csp(cfg, nonce) {
  if (nonce) {
    return `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'; ` +
      "style-src 'self' 'unsafe-inline' https:; font-src https: data:; img-src 'self' data: https:; frame-src https:; " +
      "connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
  }
  const ga = cfg.gaId ? ' https://*.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com' : '';
  const gsi = cfg.googleClientId ? ' https://accounts.google.com/gsi/' : '';
  return `default-src 'self'; script-src 'self'${cfg.gaId ? ' https://www.googletagmanager.com' : ''}${gsi ? ' https://accounts.google.com/gsi/client' : ''}; ` +
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${gsi}; font-src https://fonts.gstatic.com; ` +
    `img-src 'self' data:${ga}${cfg.googleClientId ? ' https://*.googleusercontent.com' : ''}; ` +
    `connect-src 'self'${ga}${gsi}; frame-src${gsi || " 'none'"}; frame-ancestors 'none'`;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// ---------- Which site a visitor sees ----------
// Visitors outside Israel who open a Hebrew page go to the same page on the English site, unless
// they chose Hebrew (the "site" cookie, set by the language link in the footer), their browser
// asks for Hebrew, or they are signed in as an admin. Search engines and link previews are never redirected, so they keep seeing
// both sites, and hreflang tells them the pages are translations of each other.
const CRAWLER_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|lighthouse|pagespeed|inspectiontool|headless/i;
const cookie = (request, name) => (new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(request.headers.get('Cookie') || '') || [])[1];
const redirect = (location, headers = {}) => new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } });

function englishFor(meta) {
  if (PAGES_EN[meta.local]) return meta.local === '/' ? '/en' : `/en${meta.local}`;
  if (meta.lesson) return '/en/lessons';
  if (meta.text) return '/en/texts';
  return '/en';
}

async function siteRedirect(request, env, cfg, url, meta) {
  if (meta.lang !== 'he' || request.method !== 'GET') return null;
  const chosen = cookie(request, 'site');
  const ua = request.headers.get('User-Agent') || '';
  if (chosen === 'he' || !ua || CRAWLER_UA.test(ua)) return null;
  if (chosen !== 'en') {
    const country = request.cf && request.cf.country;
    if (!country || country === 'IL' || /^(he|iw)\b/i.test(request.headers.get('Accept-Language') || '')) return null;
    const user = await currentUser(request, env);
    if (user && cfg.admins.has(String(user.email).toLowerCase())) return null;
  }
  return redirect(englishFor(meta) + url.search);
}

async function servePage(request, env, cfg, meta) {
  const url = new URL(request.url);
  const asset = await env.ASSETS.fetch(new Request(url.origin + (meta.lang === 'en' ? '/en/' : '/'), { headers: request.headers }));
  if (!asset.ok) return asset;
  let html = withMeta(await asset.text(), meta, siteOrigin(url), await pageBody(env, url, meta));
  let nonce = null;
  if (cfg.adsClient) {
    nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    html = html
      .replace(/<script /g, `<script nonce="${nonce}" `)
      .replace('</head>', `  <meta name="google-adsense-account" content="${cfg.adsClient}">\n` +
        `  <script nonce="${nonce}" async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cfg.adsClient}" crossorigin="anonymous"></script>\n</head>`);
  }
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': csp(cfg, nonce), ...SECURITY_HEADERS },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // One address per page: https, without www. Cloudflare's CF-Visitor header carries the
    // scheme the visitor used; it is missing in local development, which stays on http.
    let scheme = '';
    try { scheme = JSON.parse(request.headers.get('cf-visitor') || '{}').scheme || ''; } catch { /* malformed header */ }
    if (url.hostname.startsWith('www.') || scheme === 'http') {
      url.hostname = url.hostname.replace(/^www\./, '');
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    const cfg = settings(env);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request, env, url.pathname.slice(4), cfg);
      if (url.pathname === '/ads.txt') {
        // Declares this site's authorised ad seller; AdSense checks it.
        if (!cfg.adsClient) return new Response('Not found', { status: 404 });
        return new Response(`google.com, ${cfg.adsClient.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`, { headers: { 'Content-Type': 'text/plain' } });
      }
      if (url.pathname === '/robots.txt') return new Response(robots(siteOrigin(url)), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      if (url.pathname === '/llms.txt') {
        return new Response(await llmsTxt(env, url, siteOrigin(url)), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
      }
      if (url.pathname === '/sitemap.xml') {
        return new Response(await sitemap(env, siteOrigin(url)), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
      }
      // One canonical address per page: no trailing slash.
      if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
        url.pathname = url.pathname.replace(/\/+$/, '');
        return Response.redirect(url.toString(), 301);
      }
      // The language links in the footer (?site=he / ?site=en) remember the visitor's choice.
      const choice = url.searchParams.get('site');
      if (choice === 'he' || choice === 'en') {
        url.searchParams.delete('site');
        ctx.waitUntil(logEvents(request, env, cfg, [{ at: Date.now(), type: 'site', path: url.pathname, data: JSON.stringify({ to: choice }) }])
          .catch(e => console.error(e)));
        return redirect(url.pathname + url.search, {
          'Set-Cookie': `site=${choice}; Path=/; Max-Age=31536000; SameSite=Lax${url.protocol === 'https:' ? '; Secure' : ''}`,
        });
      }
      // The Hebrew page about learning English typing has no English twin.
      if (url.pathname === '/en/english') return Response.redirect(`${url.origin}/en`, 301);
      const meta = await pageMeta(env, url);
      if (meta) return await siteRedirect(request, env, cfg, url, meta) || await servePage(request, env, cfg, meta);
      return env.ASSETS.fetch(request); // unknown pages get public/404.html with status 404
    } catch (e) {
      if (!e.status) console.error(e);
      return json(e.status || 500, { error: e.status ? e.message : 'שגיאת שרת' });
    }
  },

  // Daily clean-up (cron trigger in wrangler.jsonc): expired sessions, and activity older than a year.
  async scheduled(_event, env) {
    const yearAgo = Date.now() - 365 * 86400000;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(Date.now()),
      env.DB.prepare('DELETE FROM events WHERE at < ?1').bind(yearAgo),
      env.DB.prepare('DELETE FROM visitors WHERE last_seen < ?1').bind(yearAgo),
    ]);
  },
};
