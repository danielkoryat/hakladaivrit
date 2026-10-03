# Hakladaivrit: Hebrew touch typing

[hakladaivrit.com](https://hakladaivrit.com) is a free website that teaches touch typing in Hebrew,
with English as an optional second language. An English version of the whole site at
[/en](https://hakladaivrit.com/en) teaches English typing to visitors outside Israel. It has a typing test, 25 graded lessons, adaptive
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
- **Two sites:** the Hebrew site at `/` and the English site at `/en`, from the same code. See
  [Two sites](#two-sites-hebrew-and-english).
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

The Hebrew course has 25 lessons and the English course 24. Both start with the home row
(index and middle fingers, then ring fingers and pinkies, then the two inner keys) and then add
two keys per lesson in order of how common the letters are in the language, not row by row.
In Hebrew the index fingers' letters (ו ה א ר מ נ, about 40% of the letters in Hebrew text)
come right after the home row, and the rare ט צ ז ס ץ come last. Each group ends with a review.
Measured on a 50,000-word frequency list, the old row-by-row order made 28% of real text
typeable halfway through the letters; this order makes 65%. After the letters come final
forms (Hebrew), capitals (English), punctuation, `?` and `!` with the opposite-hand Shift,
geresh, gershayim and hyphen, numbers for each hand, common words, Hebrew prefixes
(ו ה ב ל מ ש כ), sentences and quotations.

Exercise text for a letter lesson is generated fresh every time:

1. drills of each new key: the key three times, then the key with the home key of the same
   finger (`חוח` for ו), so the reach is practised out of the home row and back
2. short letter groups mixing the new keys with those home keys
3. real words that use only the keys taught so far, mostly words with the new keys and some
   with earlier keys only, so older keys keep coming back. Words come from the common-word
   list plus a list of extra words for the first lessons (`LESSON_WORDS`), so even lesson 1
   has real words
4. pronounceable letter groups where real words run out. In Hebrew, final letters only appear
   at the end of a group, and כ מ נ פ צ never end one, as in real writing.

A review lesson practises everything taught so far, with extra weight on the keys of its group.

Blind mode (a button in every lesson) hides the on-screen keyboard and shows the finger hint
only after a 1.5 second hesitation, so the help can fade out as the keys become familiar.

Eye stars, from lesson 5 on: every 6 to 15 seconds of active typing, a star shows just above the
text for 2.5 seconds, and pressing Enter while it shows catches it for 3 bonus XP. It follows
Yechiam et al. (2003), where a secondary task with signals on the screen kept trainees from
going back to looking at the keys. The results show how many stars were caught.

Letter lessons stop on every mistake until the right key is pressed. The real-typing lessons
(`free: true`: common words, prefixes, sentences, quotations) let the user type past a mistake
and fix it with Backspace, as in real typing.

A lesson earns stars:

| Stars | Rule |
| --- | --- |
| 3 | accuracy of at least 97% and at least the lesson's target speed |
| 2 | accuracy of at least 92% |
| 1 | the lesson was completed |

Lesson progress is stored by `pid`: 200 + id for Hebrew and 300 + id for English. The earlier
16-lesson courses used 1 to 16 and 101 to 116; each new lesson lists in `legacy` the old
lessons whose completion also counts for it, so nobody loses their progress.

## Research behind the lessons

The course design rests on published research on how typing skill is learned, on data about
Hebrew and English text, and on what established courses do. Each source below was checked
against the paper itself (abstract or full text), and each row says what the site does with it.

### Studies

| Finding | Source | How the site uses it |
| --- | --- | --- |
| Skilled typing works on two levels: an outer loop that handles whole words and an inner loop that turns each word into keystrokes. | Logan & Crump (2011), "Hierarchical control of cognitive processes: the case for skilled typewriting", *Psychology of Learning and Motivation* 54. [PDF](http://www.psy.vanderbilt.edu/faculty/logan/logan%20crump%20psych%20learn%20mot%202011.pdf) | Real words from the first lessons (`LESSON_WORDS`), so words become single units early. |
| Typists can trade speed for accuracy, but most of the trade-off happens at the keystroke level, and pushing for speed costs many errors. | Yamaguchi, Crump & Logan (2013), "Speed–accuracy trade-off in skilled typewriting", *J. Exp. Psychology: Human Perception and Performance* 39(3). [doi:10.1037/a0030512](https://doi.org/10.1037/a0030512) | Accuracy first: letter lessons stop on every mistake, and 3 stars need 97% accuracy. |
| Self-taught typists can be as fast as touch typists. The three predictors of speed are a consistent finger for each letter, preparing upcoming keystrokes, and little hand movement. | Feit, Weir & Oulasvirta (2016), "How we type: Movement strategies and performance in everyday typing", CHI 2016. [Project page](https://userinterfaces.aalto.fi/how-we-type/) | Each new key is drilled from the home key of its own finger (`חוח` for ו), and the hint names the finger for every key. |
| Pairs of letters typed by different hands or fingers predict typing speed; overlapping key presses (rollover) are common among fast typists. | Dhakal, Feit, Kristensson & Oulasvirta (2018), "Observations on typing from 136 million keystrokes", CHI 2018. [doi:10.1145/3173574.3174220](https://doi.org/10.1145/3173574.3174220) | Drills pair keys of the two hands (כ with ח), and lessons move to real words, which are full of common letter pairs. |
| Success in touch-typing training does not ensure its use afterwards: learners go back to looking at the keys because it gives better results in the moment. A secondary task with signals on the screen made looking at the screen worth more and helped trainees keep and maintain the skill. | Yechiam, Erev, Yehene & Gopher (2003), "Melioration and the transition from touch-typing training to everyday use", *Human Factors* 45(4). Technion. [doi:10.1518/hfes.45.4.671.27085](https://doi.org/10.1518/hfes.45.4.671.27085) | Eye stars: a short signal above the text that Enter catches for bonus XP. Blind mode hides the on-screen keyboard. |
| Hiding the hands made skilled typists slower between keystrokes, and without on-screen echo they noticed their own errors less accurately. | Snyder, Logan & Yamaguchi (2015), "Watch what you type", *Attention, Perception & Psychophysics* 77(1). [doi:10.3758/s13414-014-0756-6](https://doi.org/10.3758/s13414-014-0756-6) | Visual help fades step by step instead of disappearing at once: blind mode still shows the hint after a hesitation, and typed text is always marked on screen. |
| In a 14-lesson touch-typing program at the Hebrew University, typical students were *slower* at the end of the program; three months later, both groups had become significantly faster than before, with accuracy above 95%. | Weigelt Marom & Weintraub (2015), "The effect of a touch-typing program on keyboarding skills of higher education students with and without learning disabilities", *Research in Developmental Disabilities* 47. [doi:10.1016/j.ridd.2015.09.014](https://doi.org/10.1016/j.ridd.2015.09.014) | The lessons page and the guide tell learners to expect a temporary slowdown, and not to go back to looking at the keys. |
| Postal workers learning to type learned fastest with one hour a day; longer or more intense sessions learned more slowly. | Baddeley & Longman (1978), "The influence of length and frequency of training session on the rate of learning to type", *Ergonomics* 21(8). [doi:10.1080/00140137808931764](https://doi.org/10.1080/00140137808931764) | The guide recommends short daily practice (15 to 20 minutes) rather than long sessions. |

### Language data

- **Letter frequency and word coverage.** Measured on the 50,000 most frequent words of
  Hebrew and of English in [FrequencyWords](https://github.com/hermitdave/FrequencyWords)
  (OpenSubtitles 2018), weighted by how often each word appears. Hebrew: י 11.1%, ו 9.5%,
  ה 9.4%, א 8.6%, ל 7.5%, ת 6.1%, ר 4.8%, מ 4.6%, ש 4.6%, ב 4.4%, נ 3.7%, down to ף 0.2% and
  ץ 0.1%. This sets the order of the lessons and of `ADAPTIVE_ORDER`.
- **The effect of the order.** For each key order, the share of real text that can be typed
  with the keys taught so far. Halfway through the letters, the earlier row-by-row Hebrew course
  covered 28% of text and the current order covers 65%.
- **Keyboard layout.** The course uses the standard Israeli layout, SI-1452, the default on
  Windows. The optional 2018 "improved" layout (SI-1452-2), which moves punctuation and some
  final letters, is rarely used. [Hebrew keyboard](https://en.wikipedia.org/wiki/Hebrew_keyboard)
- **Spelling.** Practice text follows the Academy of the Hebrew Language's rules for spelling
  without vowel marks (כתיב מלא), including its 2017 changes: שמיים, צוהריים, אימא, עוגייה,
  מייד. [Academy rules](https://hebrew-academy.org.il/topic/hahlatot/missingvocalizationspelling/)

### Courses compared

- [typing.com](https://www.typing.com/curriculum/keyboarding) introduces common letters from all
  rows early (J F, then U R K, then D E I, then C G N) instead of row by row.
- [AgileFingers](https://agilefingers.com/he/kurs) (Hebrew) goes row by row, two keys per lesson,
  with a review after each group. The site keeps that rhythm: two keys per lesson and a review
  after each group.
- [TypingStudy](https://www.typingstudy.com/he-hebrew-3/) (Hebrew) brings ר ו, ה צ and ב ת in
  early.
- [keybr](https://www.keybr.com/) opens letters one at a time by frequency, when the open ones
  reach a target speed. The practice page's letter-unlocking mode follows this model.

### Limits of the evidence

No published study compares a frequency-based key order with a row-by-row order, in Hebrew or
in any language. The order is supported indirectly: by the word-level studies above, by the
coverage measurements, and by typing.com. The exact parameters are design choices, not research
results: two keys per lesson, the star thresholds, and the timing, key and bonus of the eye stars.

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

The practice page also has a letter-unlocking mode, after keybr. Letters open one at a time in
order of frequency (`ADAPTIVE_ORDER`), starting with six. Each open letter keeps a moving average
(weight 0.3 per round) of its time per key press and its accuracy. The next letter opens when
every open letter has at least 15 presses, 95% accuracy and the target speed (20 to 40 WPM, the
user's choice). Each round concentrates on the open letter furthest from the target, and rounds
follow each other without a results screen. The state is kept in the browser per language.

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

## Two sites: Hebrew and English

The English site lives under `/en` (`/en/test`, `/en/lesson/3`, `/en/texts/science-moon`…) and
has every page of the Hebrew site except `/english`. It is written in English, runs left to right
and teaches only English typing.

- **One code base:** `data-en.js` sets `SITE_LANG` from the address and defines `tr(he, en)`,
  which every script uses for its texts. On the English site the typing language is always
  English and the Hebrew/English switch is hidden.
- **Addresses:** `sitePath()` adds `/en` to addresses built in code, the router ignores the
  prefix, and every `<a href="/…">` in the page gets it automatically. The Worker does the same
  for the HTML it renders.
- **English content:** the app shell is `public/en/index.html`, page texts are in
  `public/content/en/`, the text library is `public/data/texts-en.json`, and the English lessons'
  English text is `EN_LESSONS_EN` in `data-en.js`.
- **Search engines:** pages that exist on both sites link to each other with `hreflang`
  (`x-default` is English), and the sitemap lists both sites.
- **Who sees which site:** a visitor outside Israel who opens a Hebrew page is redirected to the
  same page on the English site, unless their browser asks for Hebrew or they chose Hebrew with
  the language link in the footer (`?site=he` / `?site=en`, kept in a `site` cookie for a year).
  Search engines and link-preview bots are never redirected, so both sites stay indexed.

## Typing language

Hebrew is the default on the Hebrew site. A switch in the header changes the practised language to English. The
choice is saved in the browser and read once when the page loads, and switching reloads the page.
Before any feature runs, `public/js/data-en.js` swaps the shared data (keyboard characters, word
list, sentences, quotes and lessons), so the rest of the code works the same in both languages.
Links with `?lang=en` open the site straight in English.

The two languages are tracked separately:

- English lessons are stored under their own ids.
- English test results use their own mode names, so they have their own personal bests.
- The speed leaderboards count Hebrew tests on the Hebrew site and English tests on the English
  site.
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
| `public/en/index.html` | the English site's app shell |
| `public/js/data.js` | keyboard layout, Hebrew lessons, word list, sentences, quotes |
| `public/js/data-en.js` | site language and `t()`, typing language switch, US layout, English lessons, words, sentences, quotes |
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
