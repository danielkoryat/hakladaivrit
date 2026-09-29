# הקלדה עיוורת בעברית

Hebrew touch-typing site for kids and adults: typing test, 16 graded lessons, adaptive practice,
a balloon typing game, a library of educational texts, practice on your own text, XP / levels /
streaks / badges, a leaderboard, shareable result cards, animated on-screen hands, kids mode,
light and dark themes, Google sign-in, Google Analytics and AdSense support.
Runs free on **Cloudflare Workers** with a **D1** database.

## Run locally

```
npm install      # first time only
npm run dev
```

Open **http://localhost:5000** (Google sign-in needs `localhost`, not `127.0.0.1`).
Local settings live in `.dev.vars` (copy `.dev.vars.example`); the local database is kept in `.wrangler/`.

## Deploy to Cloudflare (free)

One-time setup:

1. `npx wrangler login` — opens the browser to connect your Cloudflare account.
2. `npx wrangler d1 create hakladaivrit` — copy the printed `database_id` into `wrangler.jsonc`.
3. In `wrangler.jsonc` → `vars`, set `GOOGLE_CLIENT_ID` (and later
   `GA_MEASUREMENT_ID`, `ADSENSE_*`, `CONTACT_EMAIL`).
4. The domain in `wrangler.jsonc` → `routes` must be in the same Cloudflare account. If it already
   has DNS records for the bare domain or `www`, delete them first (the deploy creates its own).

Admin accounts are a Cloudflare secret (kept out of the repo):

```
npx wrangler secret put ADMIN_EMAILS     # e.g. you@gmail.com, comma separate several
```

### Automatic deploys

Every push to `main` runs the tests, applies database migrations and publishes the site to
https://hakladaivrit.com (GitHub Actions, `.github/workflows/deploy.yml`). It needs, under the
repository's **Settings → Secrets and variables → Actions**:

- secret `CLOUDFLARE_API_TOKEN` – a Cloudflare API token (template **Edit Cloudflare Workers**,
  plus **Account → D1 → Edit** and **Zone → DNS → Edit** for your domain)
- variable `CLOUDFLARE_ACCOUNT_ID` – shown by `npx wrangler whoami`

To publish by hand instead: `npm run deploy`.

Free-plan limits: 100,000 page/API requests per day (static files don't count), 5 GB database,
5M database rows read and 100k written per day.

## Sign in with Google

In Google Cloud Console → **Google Auth Platform**:

- **Clients → your Web client → Authorized JavaScript origins**: `http://localhost`,
  `http://localhost:5000`, `https://hakladaivrit.com`, `https://www.hakladaivrit.com`.
- **Branding**: home page `https://hakladaivrit.com`, privacy policy
  `https://hakladaivrit.com/privacy`, authorized domain `hakladaivrit.com`.
- **Audience**: **Publish app** (until then only listed test users can sign in).

The worker verifies every Google token's signature, audience, expiry and verified email itself
(`lib/google-auth.js`, tested by `npm test`).

## Search engines and AI assistants

Every page has its own address (`/test`, `/lessons`, `/lesson/1` … `/lesson/16`, `/practice`,
`/guide`, `/privacy`); old `/#/…` links still work.

- **Page text is in the HTML.** Page texts live in `public/content/*.html`; the worker puts the
  current page's text into the HTML (so crawlers that don't run JavaScript, like ChatGPT's, see it)
  and the site shows the same file to visitors. Lesson pages and the lesson list are generated from
  `public/js/data.js`.
- **Tags and structured data:** title, description, canonical link, Open Graph, and schema.org
  (WebSite, Organization, WebApplication, FAQPage, Course, Article, BreadcrumbList).
- **`/sitemap.xml`, `/robots.txt`** (search and AI crawlers explicitly allowed; private pages
  blocked and `noindex`) and **`/llms.txt`**, a plain-language summary for AI assistants.
- **IndexNow:** every deploy notifies Bing (used by ChatGPT search and Copilot) and Yandex of all
  pages; the key file is `public/5d282cb84ed7fd9c20e5d623a15b306b.txt`.

Google Search Console: add the **Domain** property `hakladaivrit.com` (verify with the TXT record it
gives you, in Cloudflare → DNS), then submit `https://hakladaivrit.com/sitemap.xml`.
Bing Webmaster Tools: sign in at https://www.bing.com/webmasters and import the site from Search Console.

## Visitor statistics (Google Analytics)

1. At https://analytics.google.com create a property with a **Web** data stream for your domain and
   copy its measurement ID (`G-XXXXXXXXXX`) into `GA_MEASUREMENT_ID`.
2. In the data stream's **Enhanced measurement → Page views → advanced settings**, turn off
   **"Page changes based on browser history events"** — the site sends its own page views
   (`/test`, `/lesson/3`, …), so leaving it on double-counts.

Custom events: `training_complete` (`activity`, `wpm`, `accuracy`), `sign_up`, `login`.
Not loaded for admin accounts or visitors with Global Privacy Control.

## Admin dashboard

Put your Google account email in the `ADMIN_EMAILS` secret (see above), sign in and click **ניהול**.
It shows registered users, sign-ups, active users per day, completed activities and recent users.

## Ads (Google AdSense)

1. Apply at https://adsense.google.com with your live domain.
2. Set `ADSENSE_CLIENT=ca-pub-…` and deploy: the worker adds the AdSense code and verification tag
   and serves `/ads.txt`.
3. Once approved, turn on Auto ads, or create display ad units and set `ADSENSE_SLOT_HOME`,
   `ADSENSE_SLOT_RESULTS`, `ADSENSE_SLOT_LESSONS`, `ADSENSE_SLOT_PROFILE`.
4. Enable the consent message for European visitors in AdSense → Privacy & messaging.

`ADS_PREVIEW=1` (in `.dev.vars`) shows placeholder boxes where ads will appear.

## Layout

- `worker/index.js` – API, HTML pages (SEO tags, security headers, AdSense), sitemap, robots.txt, ads.txt, www redirect
- `lib/google-auth.js` – Google token verification; `test/` – tests (`npm test`)
- `migrations/` – database schema (applied by `npm run dev` / `npm run deploy`)
- `wrangler.jsonc` – Cloudflare configuration and site settings
- `public/` – the site (served as static files)
  - `js/data.js` – keyboard layout, lessons, word list, sentences, quotes
  - `js/keyboard.js` – on-screen keyboard and animated hands
  - `js/text.js` – exercise text generation
  - `js/account.js` – sign-in, profile data, Google Analytics, ads, analysis, personalised lessons
  - `js/core.js` – shared page context, preferences (hands, kids mode), icons, typing engine
  - `js/gamify.js` – XP, levels, streaks, daily goal, badges, celebrations
  - `js/share.js` – result card image, share window, challenge links
  - `js/game.js` – balloon typing game
  - `js/texts.js` – text library and "my text" practice
  - `js/leaderboard.js` – leaderboard page
  - `js/app.js` – router, header and the other pages
  - `data/texts.json` – the educational texts (typeable characters only)
  - `content/*.html` – page texts (home, guide, and explanations for the test, lessons and practice pages)
