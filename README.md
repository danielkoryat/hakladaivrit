# Hakladaivrit: Hebrew touch typing

[hakladaivrit.com](https://hakladaivrit.com) is a free website that teaches touch typing in Hebrew,
with English as an optional second language. It has a typing test, 16 graded lessons, adaptive
practice that targets each user's weak keys, a balloon typing game, a library of educational texts,
practice on any text the user pastes, and a progress layer of XP, levels, streaks, badges and a
leaderboard. An on-screen keyboard with animated hands shows which finger presses each key.

This document explains how the site is built and the logic behind each part.

## Architecture

The whole site runs on Cloudflare's free tier, with no servers to manage and no build step.

```
Browser                         Cloudflare
───────                         ──────────
static files  ◄──────────────   Static Assets  (public/)
(vanilla JS)                         │
     │                               │  page routes and /api/* run the Worker first
     ▼                               ▼
page requests / JSON API  ────►  Worker (worker/index.js)
                                     │  HTML with SEO tags and page text,
                                     │  API, sign-in, leaderboard
                                     ▼
                                 D1 (SQLite)
```

- **Front end:** plain JavaScript, HTML and CSS in `public/`, with no framework and no bundler.
  The scripts are classic `<script>` files that share globals, so their load order in
  `index.html` matters: data first, then helpers, the keyboard, the typing engine, the features,
  and the router last.
- **Worker:** handles every page address and the JSON API. For a page it returns the app shell
  with that page's title, description, structured data and readable text already in the HTML.
  For `/api/*` it reads and writes the database. Everything else (scripts, styles, images) is
  served directly from Cloudflare's static asset storage without running the Worker.
- **Database:** Cloudflare D1, a SQLite database. The schema lives in `migrations/`.
- **Deploys:** every push to `main` triggers a GitHub Actions workflow. It runs the tests,
  applies any new database migrations, publishes the Worker, and notifies search engines about
  the site's pages through IndexNow.

### Page rendering

Every page has a real address (`/test`, `/lesson/3`, `/texts/history-moon-landing`, `/english` and
so on), so search engines and people can link to each one.

1. The Worker looks the address up in its page table and builds the HTML: title, description,
   canonical link, Open Graph tags, schema.org data (WebSite, Organization, WebApplication,
   FAQPage, Course, Article, VideoGame, BreadcrumbList) and the page's text from
   `public/content/*.html`. Lesson pages are generated from the lesson data in `public/js/data.js`,
   and text pages from `public/data/texts.json`.
2. In the browser, the router reads the address and draws the interactive page. Explanatory text
   that is already in the HTML is reused instead of downloaded again.
3. After that, links switch pages with the History API, without reloading.

Crawlers that don't run JavaScript still see the full text of every page. The Worker also serves
`/sitemap.xml`, `/robots.txt` (which explicitly allows search engines and AI assistants' crawlers)
and `/llms.txt`, a plain-language summary of the site for AI assistants.

## Keyboard model

The keyboard is described once, by physical key (`KeyA`, `Semicolon`, `Space`...). Each key
records its Hebrew character (standard Israeli SI-1452 layout), its English character (US layout),
the finger responsible for it, and its width. Everything else is derived from that table:

- the character each key produces, and the reverse lookup from a character to its key and to
  whether it needs Shift
- which finger types each character, and which row it sits on
- the on-screen keyboard, colour coded by finger, with the practised language's character as the
  main label and the other language's character in the corner
- the animated hands. Each hand is drawn from a simple skeleton (finger bones, knuckles, palm and
  thumb) as one grey silhouette. When the next character changes, the right finger moves to its
  key and the rest of the hand stays on the home row.

Key presses are matched by **physical position**, not only by the character the computer reports.
If the next character is on the key that was pressed (with the right Shift state), the press
counts, in either layout. As a result, a user can practise Hebrew while the computer's keyboard is
set to English, practise English while it is set to Hebrew, and type text that mixes both
languages without switching.

## The typing engine

All typing activities (test, lessons, practice, texts) share one engine, `Typer` in
`public/js/core.js`.

- **Rendering:** the text is split into words and every character becomes its own element, so the
  engine can colour each one as correct or wrong and place the cursor exactly.
- **Direction:** the box runs right to left when most of the letters are Hebrew, and left to right
  otherwise. Consecutive words in the other direction (English words or numbers inside Hebrew
  text, or a Hebrew phrase inside English text) are grouped into one run, so the phrase keeps its
  own reading order and still wraps with the line.
- **Scrolling:** the box shows three lines and scrolls up as the cursor reaches the third line.
  In the timed test, more words are added as the user nears the end.
- **Modes:** normally a wrong key is shown in red and the user moves on (and may backspace).
  In strict mode, which lessons use, the cursor waits until the right key is pressed.
- **Statistics:**
  - Words per minute = correct characters ÷ 5 ÷ minutes, the standard definition.
  - Accuracy = correct key presses ÷ all key presses, so fixed mistakes still count.
  - For every character, the engine keeps hits, misses and the time it took to find the key. Pauses
    longer than three seconds are ignored so a break doesn't make a key look slow.
  - Words typed with a mistake and words typed cleanly are both reported for the analysis below.

## Lessons and exercise text

The course follows the keyboard row by row: the home row, then the top row, then the bottom row,
then punctuation, common words, full sentences and numbers. Each lesson adds a few new keys and
may only use keys that have already been taught. Exercise text is generated fresh every time:

1. short drills of each new key (three in a row, then small groups of new keys)
2. real words from the word list made only of allowed letters, preferring words that contain the
   new keys
3. when there are too few real words, pronounceable letter groups made of allowed letters. In
   Hebrew, five letters have a special final form, and final forms only appear at the end of a
   group, as in real writing.

A lesson earns stars:

| Stars | Rule |
| --- | --- |
| 3 | accuracy of at least 97% and at least the lesson's target speed |
| 2 | accuracy of at least 92% |
| 1 | the lesson was completed |

Review lessons mix everything learned so far. The English course follows the same plan on the
same physical keys, with a lesson for capital letters (Shift is pressed with the opposite hand).

## Analysis and personalised lessons

Every finished activity adds its per-character statistics to the user's totals. The analysis
reads those totals:

- **Weak keys:** keys with at least 8 attempts and at least 2 mistakes, and accuracy below the
  user's overall accuracy (and below 97%). The five worst are shown.
- **Slow keys:** keys that take more than 15% longer to find than the user's average.
- **Weakest finger and row:** the finger or row with clearly the lowest accuracy.
- **Problem words:** a word's counter goes up every time it is typed with a mistake and down every
  time it is typed cleanly. It leaves the list when the counter reaches zero.
- **Trend:** the average speed of the last ten tests compared with the ten before.

Each finding becomes a personalised lesson: drills on the weak or slow keys followed by real words
rich in them, a lesson for the weakest finger or row, or a lesson made of the problem words. The
practice page keeps generating rounds that put extra weight on the current weak letters, and shows
a heat map of accuracy on the keyboard.

## Progress over time

The profile page shows how the user improves:

- **Metrics:** speed (the daily average of typing tests), accuracy (the daily average of all typing,
  weighted by characters) and typing time (minutes per day, or per week for ranges over 120 days).
- **Ranges:** the last 30 days, the last 90 days or all time. The choice is remembered.
- **Chart:** the points sit on a real time axis, so days off show as gaps in time, not as
  neighbouring points. Speed and accuracy are lines, and typing time is bars. Hovering or the
  arrow keys show the day and the number of tests.
- **Then and now:** the average of the first three days in the range, the average of the last three,
  and the change between them. For typing time, it shows the total, the number of practice days and
  the average per day.
- **Practice calendar:** up to a year of days, coloured by the XP earned each day, with the daily
  goal as one of the steps, and the longest streak.
- **Weekly table:** the same numbers week by week, as a readable alternative to the chart.

Tests and lessons count toward the language they were typed in, so switching to English starts a
separate speed line. History keeps the last 1,000 activities.

## Progress and game layer

- **XP:**
  - test: correct characters ÷ 8, plus 10 at 95% accuracy or more
  - lesson: 15 + 10 per star
  - text: 10 + correct characters ÷ 6
  - personalised lesson: 15 + correct characters ÷ 10
  - balloon game: score ÷ 15
- **Level:** `floor(sqrt(xp / 40)) + 1`, so each level needs a little more XP than the one before.
  Levels map to animal ranks, from a chick to a lightning bolt.
- **Daily goal and streak:** XP is also counted per day. The daily goal is 100 XP. The streak is
  the number of consecutive days with any XP, and it doesn't break until a full day is missed.
- **Badges:** 21 badges, each a rule over the user's data (first test, speed milestones, accuracy,
  finishing lesson groups, streak lengths, game scores, reading texts and so on).
- **Celebrations:** notices for XP and new badges, and confetti for bigger moments.

## Balloon game

Balloons carrying letters (or short words) float up from the bottom. Typing a letter pops the
lowest balloon that carries it. In word mode, the first letter locks onto a balloon and the rest of
the word must be typed in order. The game gets faster every 10 balloons, and popping in a row builds
a score multiplier of up to 5×. A balloon that escapes costs one of three hearts. A wrong key
resets the multiplier and shows which letter was pressed. The on-screen keyboard highlights the
key for the lowest balloon. The game runs on `requestAnimationFrame`, uses the Web Audio API for
sound, and pauses when the tab is hidden.

## Texts

- **Library:** 17 short educational texts (history, science, nature and the Hebrew language) stored
  in `public/data/texts.json`. They contain only characters that can be typed on the keyboard, and
  each one has its own indexable page.
- **Your own text:** users can paste or upload any text, in Hebrew, English or both. It is cleaned
  before typing:
  - Hebrew vowel marks are removed.
  - Typographic quotes and dashes become their keyboard equivalents.
  - Characters that can't be typed are dropped.

  Long texts are split into parts of about 45 words, ending at a sentence end when possible. These
  texts are stored only in the user's browser and are never sent to the server.

## Typing language

Hebrew is the default. A switch in the header changes the practised language to English. The
choice is saved in the browser and read once when the page loads, and switching reloads the page.
Before any feature runs, `public/js/data-en.js` swaps the shared data (keyboard characters, word
list, sentences, quotes and lessons), so the rest of the code works the same in both languages.
Links with `?lang=en` open the site straight in English.

The two languages are tracked separately:

- English lessons are stored under their own ids.
- English test results use their own mode names, so they have their own personal bests.
- The speed leaderboards count Hebrew tests only.
- XP, level and streak are shared by both languages.

## Accounts and data

- **Guests:** everything works without an account. Progress is kept in the browser's
  `localStorage`.
- **Sign in with Google:** the browser receives a Google ID token. The Worker verifies it without
  any SDK, using WebCrypto against Google's published keys. It checks the RS256 signature, the
  issuer, the audience, the expiry and that the email is verified.
- **Sessions:** the Worker creates a random session token and stores only its SHA-256 hash.
  The token is set as an `HttpOnly`, `SameSite=Lax` cookie that lasts 30 days. A daily scheduled
  job deletes expired sessions.
- **First sign-in:** progress made as a guest is imported into the new account.
- **Saving results:** each finished activity saves the result, the per-character statistics, the
  lesson progress, the personal best and the word counters. The free D1 plan allows a limited
  number of queries per request, so rows are written in bulk: one statement per table, with the
  rows passed as a JSON array and expanded by SQLite's `json_each`.
- **Validation:** the server checks and clamps every value it accepts (kinds, modes, numbers,
  nickname format), so a modified client can't store junk.

**Tables:** `users`, `sessions`, `results`, `key_stats`, `word_errors`, `lessons`, `pbs`,
`user_state` (XP, badges, nickname, leaderboard visibility) and `game_scores`.

## Leaderboard

There are four boards: speed this week, speed of all time, the balloon game this week, and total
XP.

- **Which tests count:** a test counts toward speed only with at least 50 characters and at least
  90% accuracy, so key mashing doesn't pay.
- **Names:** users appear as first name and last initial, or as a nickname they choose. They can
  hide themselves.
- **Practice bots:** the board also lists clearly labelled practice bots, from 18 to 90 words per
  minute. They give new visitors targets to beat. They are never presented as real people.

## Sharing

A finished test, lesson, text or game can be shared as a 1080 × 1080 image card drawn on a canvas
(score, accuracy, level). It uses the Web Share API on phones, and on desktop offers WhatsApp,
Facebook, X and Telegram links. The shared link is a challenge: `?c=<score>&n=<name>` makes the
test page show "can you beat it?" with the friend's score, and a message if the visitor wins.

## Security and privacy

- **Content Security Policy:** there is a strict CSP on every page. When ads are enabled, scripts are
  trusted by a fresh nonce on each request instead of by host.
- **Cross-site request forgery:** requests that change data must be JSON and come from the site's
  own origin.
- **Admin access:** admin accounts come from a server secret, and the admin dashboard shows
  usage statistics and recent sign-ups.
- **Analytics:** Google Analytics sends its own page views for the History API navigation. It is
  not loaded for admins or for visitors whose browser sends Global Privacy Control.
- **Ads:** AdSense is configured with environment variables and stays off until it is set up.

## Code map

| Path | What it contains |
| --- | --- |
| `worker/index.js` | page rendering, SEO, API, sign-in, leaderboard, security headers, sitemap, robots.txt, llms.txt |
| `lib/google-auth.js` | Google ID token verification |
| `test/` | tests for the token verification |
| `migrations/` | database schema |
| `wrangler.jsonc` | Cloudflare configuration: routes, database binding, settings |
| `.github/workflows/deploy.yml` | tests, migrations, deploy and IndexNow on every push |
| `public/index.html` | the app shell: header, footer, sign-in dialog, script order |
| `public/js/data.js` | keyboard layout, Hebrew lessons, word list, sentences, quotes |
| `public/js/data-en.js` | typing language switch, US layout, English lessons, words, sentences, quotes |
| `public/js/util.js` | small shared helpers and browser storage |
| `public/js/keyboard.js` | key maps, on-screen keyboard, animated hands |
| `public/js/text.js` | exercise text generation |
| `public/js/account.js` | sign-in, profile data and syncing, analysis, personalised lessons, analytics, ads |
| `public/js/core.js` | shared page context, preferences, icons, the typing engine |
| `public/js/gamify.js` | XP, levels, streaks, daily goal, badges, celebrations |
| `public/js/share.js` | share card, share window, challenge links |
| `public/js/game.js` | balloon game |
| `public/js/texts.js` | text library and practice on your own text |
| `public/js/leaderboard.js` | leaderboard page |
| `public/js/progress.js` | progress over time: charts, practice calendar, weekly table |
| `public/js/app.js` | router, header and the remaining pages |
| `public/content/*.html` | page texts shared by the server-rendered HTML and the app |
| `public/data/texts.json` | the educational texts |
