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
const KINDS = new Set(['test', 'lesson', 'practice', 'custom']);

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
  const [keys, words, lessons, pbs, history, totals] = await env.DB.batch([
    env.DB.prepare('SELECT ch, hits, misses, time_ms, timed FROM key_stats WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('SELECT word, count FROM word_errors WHERE user_id = ?1 ORDER BY count DESC LIMIT 200').bind(user.id),
    env.DB.prepare('SELECT lesson_id, stars, wpm, acc FROM lessons WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('SELECT mode, wpm FROM pbs WHERE user_id = ?1').bind(user.id),
    env.DB.prepare(`SELECT at, kind, mode, label, wpm, acc, cpm, secs, errors, chars, lesson_id, stars
                    FROM results WHERE user_id = ?1 ORDER BY at DESC LIMIT 300`).bind(user.id),
    env.DB.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(secs), 0) AS secs FROM results WHERE user_id = ?1').bind(user.id),
  ]);
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
  };
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
    const history = Array.isArray(body.history) ? body.history.slice(-500).map(cleanResult).filter(Boolean) : [];
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

  return json(404, { error: 'לא נמצא' });
}

// ---------- Search engines: per-page titles, descriptions, sitemap ----------
const SITE = 'הקלדה עיוורת';
const HOME_DESC = 'למדו להקליד בעברית מהר ומדויק בעשר אצבעות: מבחן מהירות, 16 שיעורים מדורגים ותרגול חכם, בחינם.';
const PAGES = {
  '/': { title: 'הקלדה עיוורת בעברית | מבחן הקלדה, שיעורים ותרגול', desc: HOME_DESC, priority: '1.0' },
  '/test': { title: 'מבחן הקלדה בעברית: בדקו את מהירות ההקלדה שלכם | הקלדה עיוורת', priority: '0.9', crumb: 'מבחן הקלדה',
    desc: 'מבחן מהירות הקלדה חינמי בעברית לפי זמן, מספר מילים או ציטוט. קבלו מילים לדקה, תווים לדקה, דיוק ורשימה של המקשים שכדאי לשפר.' },
  '/lessons': { title: 'שיעורי הקלדה עיוורת בעברית: 16 שיעורים מדורגים | הקלדה עיוורת', priority: '0.9', crumb: 'שיעורים',
    desc: 'למדו הקלדה עיוורת בעברית צעד אחר צעד: שורת הבית, השורה העליונה והתחתונה, פיסוק ומספרים, עם ידיים וירטואליות שמראות איזו אצבע ללחוץ.' },
  '/practice': { title: 'תרגול הקלדה בעברית שמתמקד במקשים החלשים שלכם | הקלדה עיוורת', priority: '0.8', crumb: 'תרגול',
    desc: 'תרגול הקלדה חכם בעברית: האתר מזהה את המקשים והמילים שבהם אתם טועים ובונה תרגילים שמחזקים בדיוק אותם.' },
  '/privacy': { title: 'מדיניות פרטיות | הקלדה עיוורת', priority: '0.3', crumb: 'מדיניות פרטיות',
    desc: 'איזה מידע האתר הקלדה עיוורת אוסף, איך הוא משמש ואיך אפשר למחוק אותו.' },
  '/profile': { title: 'הפרופיל שלי | הקלדה עיוורת', desc: HOME_DESC, noindex: true },
  '/admin': { title: 'לוח ניהול | הקלדה עיוורת', desc: HOME_DESC, noindex: true },
};

// Lesson titles and descriptions come from public/js/data.js, the same file the site uses.
let lessonCache = null;
async function lessons(env, origin) {
  if (lessonCache) return lessonCache;
  const res = await env.ASSETS.fetch(new Request(origin + '/js/data.js'));
  const src = await res.text();
  const unq = s => s.replace(/\\'/g, "'");
  const list = [];
  const re = /\{\s*id:\s*(\d+),([\s\S]*?)desc:\s*'((?:[^'\\]|\\.)*)'\s*\}/g;
  let m;
  while ((m = re.exec(src))) {
    const t = /title:\s*'((?:[^'\\]|\\.)*)'/.exec(m[2]);
    list.push({ id: Number(m[1]), title: t ? unq(t[1]) : `שיעור ${m[1]}`, desc: unq(m[3]) });
  }
  lessonCache = list;
  return list;
}

async function pageMeta(env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (PAGES[path]) return { path, ...PAGES[path] };
  const lesson = /^\/lesson\/(\d+)$/.exec(path);
  if (lesson) {
    const all = await lessons(env, url.origin);
    const l = all.find(x => x.id === Number(lesson[1]));
    if (!l) return null;
    return {
      path, lesson: l, total: all.length, crumb: `שיעור ${l.id}`,
      title: `שיעור ${l.id}: ${l.title} | הקלדה עיוורת`,
      desc: `שיעור ${l.id} מתוך ${all.length} בקורס ההקלדה העיוורת בעברית. ${l.desc}`,
    };
  }
  if (/^\/custom\/[\w-]+$/.test(path)) return { path, title: 'שיעור אישי | הקלדה עיוורת', desc: HOME_DESC, noindex: true };
  return null;
}

// Public address for canonical links and the sitemap: always https except on this computer.
const siteOrigin = url => (/^(localhost|127\.|\[::1\])/.test(url.hostname) ? url.origin : `https://${url.host}`);

const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function structuredData(meta, origin) {
  const home = `${origin}/`;
  if (meta.path === '/') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', '@id': `${home}#website`, url: home, name: SITE, alternateName: 'הקלדה עיוורת בעברית', inLanguage: 'he' },
        {
          '@type': 'WebApplication', name: 'הקלדה עיוורת בעברית', url: home, inLanguage: 'he',
          applicationCategory: 'EducationalApplication', operatingSystem: 'Any', isAccessibleForFree: true,
          description: HOME_DESC, image: `${origin}/og-image.png`,
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'ILS' },
        },
      ],
    };
  }
  const trail = [{ name: SITE, item: home }];
  if (meta.lesson) trail.push({ name: 'שיעורים', item: `${origin}/lessons` });
  trail.push({ name: meta.crumb, item: `${origin}${meta.path}` });
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: t.item })),
  };
}

function withMeta(html, meta, origin) {
  const url = `${origin}${meta.path === '/' ? '/' : meta.path}`;
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${attr(meta.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(meta.desc)}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(meta.title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(meta.desc)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${attr(url)}">`);
  let head = `  <link rel="canonical" href="${attr(url)}">\n`;
  if (meta.noindex) head += '  <meta name="robots" content="noindex">\n';
  else if (meta.crumb || meta.path === '/') {
    head += `  <script type="application/ld+json">${JSON.stringify(structuredData(meta, origin)).replace(/</g, '\\u003c')}</script>\n`;
  }
  return html.replace('</head>', `${head}</head>`);
}

async function sitemap(env, origin) {
  const paths = Object.entries(PAGES).filter(([, p]) => !p.noindex).map(([path, p]) => [path, p.priority]);
  (await lessons(env, origin)).forEach(l => paths.push([`/lesson/${l.id}`, '0.7']));
  const urls = paths.map(([p, pr]) => `  <url><loc>${origin}${p}</loc><priority>${pr}</priority></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

const robots = origin => `User-agent: *
Allow: /
Disallow: /api/
Disallow: /profile
Disallow: /admin
Disallow: /custom/

Sitemap: ${origin}/sitemap.xml
`;

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

async function servePage(request, env, cfg, meta) {
  const url = new URL(request.url);
  const asset = await env.ASSETS.fetch(new Request(url.origin + '/', { headers: request.headers }));
  if (!asset.ok) return asset;
  let html = withMeta(await asset.text(), meta, siteOrigin(url));
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
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
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
      if (url.pathname === '/sitemap.xml') {
        return new Response(await sitemap(env, siteOrigin(url)), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
      }
      // One canonical address per page: no trailing slash.
      if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
        url.pathname = url.pathname.replace(/\/+$/, '');
        return Response.redirect(url.toString(), 301);
      }
      const meta = await pageMeta(env, url);
      if (meta) return await servePage(request, env, cfg, meta);
      return env.ASSETS.fetch(request); // unknown pages get public/404.html with status 404
    } catch (e) {
      if (!e.status) console.error(e);
      return json(e.status || 500, { error: e.status ? e.message : 'שגיאת שרת' });
    }
  },

  // Daily clean-up of expired sessions (cron trigger in wrangler.jsonc).
  async scheduled(_event, env) {
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(Date.now()).run();
  },
};
