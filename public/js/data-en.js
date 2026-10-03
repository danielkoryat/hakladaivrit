'use strict';

// ---------- Site language ----------
// The site has two versions: Hebrew (/) and English (/en). The English one is written in
// English and teaches only English typing; tr() picks a text for the version on screen.
const SITE_LANG = /^\/en(\/|$)/.test(location.pathname) ? 'en' : 'he';
const tr = (he, en) => (SITE_LANG === 'en' ? en : he);

// ---------- Typing language ----------
// The Hebrew site teaches Hebrew by default; visitors can switch the exercises to English.
// The choice is read once at load (switching reloads the page), so every other
// script simply sees Hebrew or English data.
const LANG = (() => {
  if (SITE_LANG === 'en') return 'en';
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'he') localStorage.setItem('hebtype.lang', JSON.stringify(q));
    return JSON.parse(localStorage.getItem('hebtype.lang')) === 'en' ? 'en' : 'he';
  } catch { return 'he'; }
})();
document.documentElement.dataset.lang = LANG;

// US English layout by physical key: [unshifted, shifted].
const EN_KEYS = {
  Backquote: ['`', '~'], Digit1: ['1', '!'], Digit2: ['2', '@'], Digit3: ['3', '#'], Digit4: ['4', '$'], Digit5: ['5', '%'],
  Digit6: ['6', '^'], Digit7: ['7', '&'], Digit8: ['8', '*'], Digit9: ['9', '('], Digit0: ['0', ')'], Minus: ['-', '_'], Equal: ['=', '+'],
  BracketLeft: ['[', '{'], BracketRight: [']', '}'], Backslash: ['\\', '|'], Semicolon: [';', ':'], Quote: ["'", '"'],
  Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?'],
};
for (const c of 'abcdefghijklmnopqrstuvwxyz') EN_KEYS['Key' + c.toUpperCase()] = [c, c.toUpperCase()];

const EN_WORDS = [...new Set(`
the be to of and a in that have it for not on with he as you do at this but his by from they we say her she or an
will my one all would there their what so up out if about who get which go me when make can like time no just him know
take people into year your good some could them see other than then now look only come its over think also back after
use two how our work first well way even new want because any these give day most us is was are has had were been
water food home family friend school book hand eye head face house room door table chair window street city country
world life child man woman boy girl baby mother father sister brother name number word letter line page story
music game ball team sport park garden tree flower grass sun moon star sky rain snow wind fire earth sea river lake
morning night today week month summer winter spring autumn happy sad big small long short old young hot cold fast slow
easy hard high low right left early late open close begin end start stop find keep hold bring write read learn teach
play run walk jump sit stand sleep eat drink cook help move live love hope feel hear speak talk ask answer call wait
light dark green blue red white black yellow brown little great best better same different important simple quick
keyboard finger typing practice lesson letter speed skill focus calm steady clear careful ready together always never
often every again still yet here where why while before after during under above between around through without
`.trim().split(/\s+/))];

const EN_SENTENCES = [
  'The quick brown fox jumps over the lazy dog.',
  'Practice a little every day and you will see results.',
  'Keep your fingers on the home row and look at the screen.',
  'Typing without looking at the keys is a skill anyone can learn.',
  'The sun rises in the east and sets in the west.',
  'My sister reads a new book every week.',
  'We walked to the park and played with the dog.',
  'Good typing starts with good posture and relaxed hands.',
  'Accuracy comes first, and speed will follow.',
  'The train to the city leaves in ten minutes.',
  'She wrote a long letter to her best friend.',
  'Every finger is responsible for a few fixed keys.',
  'It was a cold morning, so we stayed inside and cooked.',
  'The children planted trees and flowers in the garden.',
  'Slow down when you make mistakes and find your rhythm.',
  'A small step every day adds up to a long journey.',
  'The teacher asked a question and the student answered.',
  'Music was playing softly while we worked together.',
];

const EN_QUOTES = [
  { text: 'Well done is better than well said.', source: 'Benjamin Franklin' },
  { text: 'An investment in knowledge pays the best interest.', source: 'Benjamin Franklin' },
  { text: 'The journey of a thousand miles begins with one step.', source: 'Lao Tzu' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', source: 'Confucius' },
  { text: 'Knowing is not enough; we must apply. Willing is not enough; we must do.', source: 'Johann Wolfgang von Goethe' },
  { text: 'All that glitters is not gold.', source: 'William Shakespeare' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', source: 'Will Durant' },
  { text: 'The secret of getting ahead is getting started.', source: 'Mark Twain' },
  { text: 'Nothing in life is to be feared, it is only to be understood.', source: 'Marie Curie' },
  { text: 'Four score and seven years ago our fathers brought forth on this continent a new nation.', source: 'Abraham Lincoln' },
  { text: 'Tell me and I forget. Teach me and I remember. Involve me and I learn.', source: 'Benjamin Franklin' },
  { text: 'Imagination is more important than knowledge.', source: 'Albert Einstein' },
];


// The English course, on the same physical keys, with explanations in Hebrew. Home row
// first, then two keys at a time by how common they are in English (e i r u t o before the
// rare v b x q z). Progress is stored under pid (300 + id), apart from the Hebrew course;
// `legacy` lists lessons of the earlier 16-lesson English course (stored as 100 + id).
const EN_LESSONS = [
  { id: 1, group: 'שורת הבית', title: 'האצבעות המורות והאמות: f j d k', newKeys: ['f', 'j', 'd', 'k'], target: 10, legacy: [102, 104, 111],
    desc: 'הניחו את האצבע המורה השמאלית על f ואת הימנית על j. על שני המקשים האלה יש בליטה קטנה, ובעזרתה מוצאים אותם בלי להסתכל. האמות נחות לידן, על d ועל k, והאגודלים על מקש הרווח.' },
  { id: 2, title: 'הקמיצות והזרתות: s l a ;', newKeys: ['s', 'l', 'a', ';'], target: 10, legacy: [102, 104, 111],
    desc: 'ביד שמאל הקמיצה נחה על s והזרת על a. ביד ימין הקמיצה נחה על l והזרת על ;.' },
  { id: 3, title: 'g ו־h', newKeys: ['g', 'h'], target: 11, legacy: [103, 104, 111],
    desc: 'האצבע המורה השמאלית נמתחת ימינה מ־f אל g, והאצבע המורה הימנית נמתחת שמאלה מ־j אל h. אחרי כל הקשה חוזרים לשורת הבית.' },
  { id: 4, title: 'חזרה: שורת הבית', newKeys: [], review: true, target: 12, legacy: [104, 111],
    desc: 'כל מקשי שורת הבית יחד, במילים כמו all, ask, had ו־glass. התמקדו בדיוק, בלי להסתכל על המקלדת.' },

  { id: 5, group: 'האותיות הנפוצות', title: 'e ו־i', newKeys: ['e', 'i'], target: 12, legacy: [111],
    desc: 'e היא האות הנפוצה ביותר באנגלית. האמה השמאלית עולה מ־d אל e, והאמה הימנית עולה מ־k אל i.' },
  { id: 6, title: 'r ו־u', newKeys: ['r', 'u'], target: 13, legacy: [111],
    desc: 'האצבעות המורות עולות לשורה העליונה: השמאלית מ־f אל r, והימנית מ־j אל u.' },
  { id: 7, title: 't ו־o', newKeys: ['t', 'o'], target: 13, legacy: [111],
    desc: 'האצבע המורה השמאלית נמתחת למעלה וימינה אל t, והקמיצה הימנית עולה מ־l אל o. מעכשיו אפשר להקליד את the, to ו־that.' },
  { id: 8, title: 'חזרה: האותיות הנפוצות', newKeys: [], review: true, target: 14, legacy: [111],
    desc: 'שורת הבית יחד עם e i r u t o. עם האותיות האלה כבר אפשר להקליד יותר מ־40% מהמילים בטקסט רגיל.' },

  { id: 9, group: 'עוד אותיות', title: 'n ו־m', newKeys: ['n', 'm'], target: 14, legacy: [111],
    desc: 'האצבע המורה הימנית יורדת לשורה התחתונה: אל n, למטה ושמאלה מ־j, ואל m, ממש מתחת ל־j.' },
  { id: 10, title: 'c ו־w', newKeys: ['c', 'w'], target: 14, legacy: [111],
    desc: 'האמה השמאלית יורדת מ־d אל c, והקמיצה השמאלית עולה מ־s אל w.' },
  { id: 11, title: 'y ו־p', newKeys: ['y', 'p'], target: 15, legacy: [111],
    desc: 'האצבע המורה הימנית נמתחת למעלה ושמאלה אל y, והזרת הימנית עולה מ־; אל p.' },
  { id: 12, title: 'חזרה: רוב האותיות', newKeys: [], review: true, target: 15, legacy: [111],
    desc: 'כל מה שלמדתם עד עכשיו. עם האותיות האלה אפשר להקליד כמעט כל מילה נפוצה באנגלית.' },

  { id: 13, group: 'האותיות האחרונות', title: 'v ו־b', newKeys: ['v', 'b'], target: 15, legacy: [111],
    desc: 'האצבע המורה השמאלית יורדת מ־f אל v, ונמתחת למטה וימינה אל b.' },
  { id: 14, title: 'x q z', newKeys: ['x', 'q', 'z'], target: 15, legacy: [111],
    desc: 'שלוש האותיות הנדירות: הקמיצה השמאלית יורדת מ־s אל x, והזרת השמאלית עולה מ־a אל q ויורדת אל z.' },
  { id: 15, title: 'חזרה: כל האותיות', newKeys: [], review: true, target: 16, legacy: [111], milestone: 'letters',
    desc: 'כל 26 האותיות האנגליות. עכשיו אתם מכירים את כל האותיות במקלדת!' },

  { id: 16, group: 'אותיות גדולות, פיסוק ומספרים', title: 'אותיות גדולות (Shift)', newKeys: [], type: 'caps', target: 14, legacy: [112],
    desc: 'לאות גדולה לוחצים על Shift ביד הנגדית: אות של יד שמאל (כמו A) עם Shift ימני, ואות של יד ימין (כמו J) עם Shift שמאלי.' },
  { id: 17, title: 'נקודה ופסיק', newKeys: ['.', ','], type: 'punct', target: 16, legacy: [113],
    desc: 'בפריסה האנגלית הפסיק נמצא על מקש , (האמה הימנית) והנקודה על מקש . (הקמיצה הימנית). אחרי פסיק ונקודה בא רווח.' },
  { id: 18, title: 'סימן שאלה וסימן קריאה', newKeys: ['?', '!'], type: 'shift', target: 15,
    desc: 'הכלל: Shift ביד הנגדית. סימן שאלה הוא Shift עם מקש / (זרת ימין), ולכן מחזיקים את Shift השמאלי. סימן קריאה הוא Shift עם הספרה 1 (זרת שמאל), ולכן מחזיקים את Shift הימני.' },
  { id: 19, title: 'גרש, מירכאות ומקף', newKeys: ["'", '"', '-'], type: 'marks', target: 14,
    desc: 'הגרש (\') נמצא ליד ; בזרת הימנית, ובאנגלית הוא חלק ממילים נפוצות: don\'t, it\'s, I\'m. המירכאות (") הן Shift שמאלי עם אותו מקש. המקף (-) נמצא בזרת הימנית, ליד הספרה 0, במילים כמו well-known.' },
  { id: 20, title: 'מספרים: יד שמאל', newKeys: ['1', '2', '3', '4', '5'], type: 'numbers', target: 12, legacy: [116],
    desc: 'שורת המספרים ביד שמאל: הזרת על 1, הקמיצה על 2, האמה על 3 והאצבע המורה על 4 ועל 5. כל אצבע עולה שתי שורות מעל מקומה וחוזרת לשורת הבית.' },
  { id: 21, title: 'מספרים: יד ימין', newKeys: ['6', '7', '8', '9', '0'], type: 'numbers', target: 12, legacy: [116],
    desc: 'ביד ימין: האצבע המורה על 6 ועל 7, האמה על 8, הקמיצה על 9 והזרת על 0. בסוף השיעור מספרים משתי הידיים יחד.' },

  { id: 22, group: 'הקלדה אמיתית', title: 'מילים נפוצות', newKeys: [], type: 'words', target: 20, free: true, legacy: [114],
    desc: 'המילים השכיחות ביותר באנגלית. ככל שתקלידו אותן יותר, כך כל מילה תהפוך לתנועה אחת רציפה במקום רצף של אותיות. בשיעור הזה ההקלדה ממשיכה גם אחרי טעות, כמו בהקלדה אמיתית: שימו לב לטעויות ותקנו אותן עם Backspace.' },
  { id: 23, title: 'משפטים', newKeys: [], type: 'sentences', target: 20, free: true, legacy: [115],
    desc: 'משפטים שלמים באנגלית עם אותיות גדולות, רווחים ופיסוק, כמו הקלדה אמיתית. בשיעור הזה ההקלדה ממשיכה גם אחרי טעות, כמו בהקלדה אמיתית: שימו לב לטעויות ותקנו אותן עם Backspace.' },
  { id: 24, title: 'ציטוטים', newKeys: [], type: 'quotes', target: 20, free: true,
    desc: 'משפטים מפורסמים באנגלית, עם פיסוק מלא. בשיעור הזה ההקלדה ממשיכה גם אחרי טעות, כמו בהקלדה אמיתית: שימו לב לטעויות ותקנו אותן עם Backspace.' },
];

// Extra real words for the first lessons, which can't use the common-word list yet.
// The lines can be typed with the keys taught up to lessons 2, 3, 5, 6 and 7; the last two
// lines give the rare letters x q z enough real words.
const EN_LESSON_WORDS = [...new Set(`
a as ad add adds all ask asks dad dads fad fall falls flask lad lads lass sad salad salads alas salsa
had has half hall halls shall glad glass gas flash flag flags dash hash slash lash sash gala lag
is he she if see did his like life feel said side idea kid kids deal asked high ahead safe lie less age sell lead fish fell
sea hide sake liked field held file fake fill heads desk failed sees shake lake dig hill eggs legal glasses headed aside
edge fail egg sale seek skills fed self seal fields ease hills hid dishes shell aid heal slide sail eagle skill ideal dish
shield seed silk heels fled sigh skies leaf sells seeds shade shelf lease heel fade hike sage
are here her us sure girl hear real used use guess hard far afraid dear read free full red hair air figure dark ride fair
fear area agree dress share laugh judge huge rules risk guard herself earlier fresh raise large rule due leader dressed
easier usual issue sugar harder ears rush higher rise useless regular desire rare grade hire hug failure useful guide
argue degree fuel grass relief shared fridge rage laughed larger harsh rear ladder deer
the to it that of this for do so just there get go right out at oh got good let look take or our tell too little should
off these first still their other after talk thought great those last told does father old lot hello house through left
three together hold door also took start looks ago lost true heart later sit eat late forget its shut hit four set
daughter least hurt fight rest though started sister goes hours truth gets trust either tried outside light dog order hot
lose sort hour serious earth fast street till others rather felt looked date straight takes future road feet state tired
hotel talked floor letter short horse radio gold eight star offer list tea soul tough third seat art joke store south tree
gift lots shoes foot further fit stage taste starts sold hole treat roll itself flight dogs rose hat stars faster folks
east ghost tight stories health trial loud sight greatest older teeth target oil shirt guest heat lift total
quick quiet quite question queen quarter equal square zero zoo zone size prize lazy crazy freeze frozen dozen amazing
breeze puzzle jazz quiz box fox six mix fix next text taxi extra exam example relax wax expect explain excited
`.trim().split(/\s+/))];

const EN_ADAPTIVE_ORDER = ['e', 'o', 't', 'a', 'i', 'n', 'h', 's', 'r', 'l', 'u', 'd', 'y', 'w', 'm', 'g', 'c', 'f', 'b', 'p', 'k', 'v', 'j', 'x', 'z', 'q'];

const EN_SHIFT_PHRASES = [
  'How are you?', 'Where is my book?', 'What time is it?', 'Are you ready?', 'Can you help me?', 'Why not?', 'Who is there?',
  'Is it far?', 'Really?', 'Are you sure?', 'Well done!', 'Good luck!', 'Thank you!', 'Happy birthday!', 'Look out!',
  'Great job!', 'Welcome home!', 'What a day!', 'Nice to meet you!', 'See you soon!',
];

const EN_MARK_WORDS = [
  "don't", "it's", "I'm", "you're", "can't", "we'll", "that's", "let's", "isn't", "didn't", "she's", "they're", "won't",
  "I've", "Sam's", '"yes"', '"no"', '"hello"', '"stop"', '"please"',
  'well-known', 'long-term', 'self-made', 'twenty-one', 'mother-in-law', 'up-to-date', 'part-time', 'warm-up', 'follow-up',
];

EN_SENTENCES.push(
  'Please close the door when you leave the room.',
  'We had pancakes and fresh fruit for breakfast.',
  'The library is a quiet place to read and think.',
  'Do you know what time the movie starts?',
  'He forgot his keys at home again this morning.',
  'Our neighbors invited us over for dinner on Friday.',
  'Rain fell all night, and the streets were wet.',
  'Typing with ten fingers saves a lot of time.',
  'Where did you put the new box of pencils?',
  'The birds were singing in the tree by the window.',
  'After the storm, a bright rainbow filled the sky.',
  'Try to keep a steady rhythm instead of rushing.',
);

// The English course explained in English, for the English site. A group is given on the
// first lesson of each group. worker/index.js reads this block too.
const EN_LESSONS_EN = {
  1: { group: 'Home row', title: 'Index and middle fingers: f j d k',
    desc: 'Rest your left index finger on f and your right index finger on j. These two keys have a small bump, so you can find them without looking. Your middle fingers rest next to them, on d and k, and your thumbs on the space bar.' },
  2: { title: 'Ring and little fingers: s l a ;',
    desc: 'On the left hand the ring finger rests on s and the little finger on a. On the right hand the ring finger rests on l and the little finger on ;.' },
  3: { title: 'g and h',
    desc: 'The left index finger reaches right from f to g, and the right index finger reaches left from j to h. After every key press, return to the home row.' },
  4: { title: 'Review: the home row',
    desc: 'All the home row keys together, in words like all, ask, had and glass. Focus on accuracy and keep your eyes off the keyboard.' },
  5: { group: 'The most common letters', title: 'e and i',
    desc: 'e is the most common letter in English. The left middle finger moves up from d to e, and the right middle finger moves up from k to i.' },
  6: { title: 'r and u',
    desc: 'The index fingers move up to the top row: the left one from f to r, and the right one from j to u.' },
  7: { title: 't and o',
    desc: 'The left index finger reaches up and right to t, and the right ring finger moves up from l to o. From now on you can type the, to and that.' },
  8: { title: 'Review: the common letters',
    desc: 'The home row together with e i r u t o. With these letters you can already type more than 40% of the words in ordinary text.' },
  9: { group: 'More letters', title: 'n and m',
    desc: 'The right index finger moves down to the bottom row: to n, down and left of j, and to m, right below j.' },
  10: { title: 'c and w',
    desc: 'The left middle finger moves down from d to c, and the left ring finger moves up from s to w.' },
  11: { title: 'y and p',
    desc: 'The right index finger reaches up and left to y, and the right little finger moves up from ; to p.' },
  12: { title: 'Review: most of the letters',
    desc: 'Everything you have learned so far. With these letters you can type almost every common English word.' },
  13: { group: 'The last letters', title: 'v and b',
    desc: 'The left index finger moves down from f to v, and reaches down and right to b.' },
  14: { title: 'x q z',
    desc: 'The three rarest letters: the left ring finger moves down from s to x, and the left little finger moves up from a to q and down to z.' },
  15: { title: 'Review: all the letters',
    desc: 'All 26 letters of the English alphabet. You now know every letter on the keyboard!' },
  16: { group: 'Capitals, punctuation and numbers', title: 'Capital letters (Shift)',
    desc: 'For a capital letter, hold Shift with the other hand: a left-hand letter (like A) with the right Shift, and a right-hand letter (like J) with the left Shift.' },
  17: { title: 'Period and comma',
    desc: 'The comma is on the , key (right middle finger) and the period on the . key (right ring finger). A space comes after a comma and a period.' },
  18: { title: 'Question mark and exclamation mark',
    desc: 'The rule: Shift with the other hand. The question mark is Shift with the / key (right little finger), so hold the left Shift. The exclamation mark is Shift with 1 (left little finger), so hold the right Shift.' },
  19: { title: 'Apostrophe, quotes and hyphen',
    desc: 'The apostrophe (\') is next to ; under the right little finger, and it is part of common words: don\'t, it\'s, I\'m. Quotation marks (") are the left Shift with the same key. The hyphen (-) is under the right little finger, next to 0, in words like well-known.' },
  20: { title: 'Numbers: left hand',
    desc: 'The number row with the left hand: the little finger on 1, the ring finger on 2, the middle finger on 3 and the index finger on 4 and 5. Each finger reaches two rows up and returns to the home row.' },
  21: { title: 'Numbers: right hand',
    desc: 'With the right hand: the index finger on 6 and 7, the middle finger on 8, the ring finger on 9 and the little finger on 0. The lesson ends with numbers from both hands.' },
  22: { group: 'Real typing', title: 'Common words',
    desc: 'The most frequent words in English. The more you type them, the more each word becomes one smooth movement instead of a string of letters. In this lesson typing continues after a mistake, as in real typing: notice your mistakes and fix them with Backspace.' },
  23: { title: 'Sentences',
    desc: 'Full English sentences with capitals, spaces and punctuation, just like real typing. In this lesson typing continues after a mistake, as in real typing: notice your mistakes and fix them with Backspace.' },
  24: { title: 'Quotes',
    desc: 'Famous English quotes with full punctuation. In this lesson typing continues after a mistake, as in real typing: notice your mistakes and fix them with Backspace.' },
};

const FINGER_NAMES_EN = {
  lp: 'left little finger', lr: 'left ring finger', lm: 'left middle finger', li: 'left index finger',
  ri: 'right index finger', rm: 'right middle finger', rr: 'right ring finger', rp: 'right little finger', th: 'thumb',
};

if (SITE_LANG === 'en') {
  EN_LESSONS.forEach(l => Object.assign(l, EN_LESSONS_EN[l.id]));
  Object.assign(FINGER_NAMES, FINGER_NAMES_EN);
}

EN_LESSONS.forEach((l, i) => { if (!l.group) l.group = EN_LESSONS[i - 1].group; l.pid = 300 + l.id; });
LESSONS.forEach(l => { l.pid = 200 + l.id; });
// Both courses, whichever language is being practised (badges count either one).
const COURSES = { he: LESSONS.slice(), en: EN_LESSONS };
const HE_SHIFT = { ...SHIFT_CHARS };

// A lesson's best result: its own, or one carried over from the earlier course.
function lessonProg(d, l) {
  const own = d.lessons[l.pid];
  if (own && own.stars) return own;
  const old = (l.legacy || []).map(id => d.lessons[id]).filter(p => p && p.stars);
  return old.length ? old.reduce((a, b) => (b.stars > a.stars ? b : a)) : own;
}

if (LANG === 'en') {
  const swap = (arr, items) => arr.splice(0, arr.length, ...items);
  swap(WORDS, EN_WORDS);
  swap(SENTENCES, EN_SENTENCES);
  swap(QUOTES, EN_QUOTES);
  swap(LESSONS, EN_LESSONS);
  swap(LESSON_WORDS, EN_LESSON_WORDS);
  swap(FINAL_PAIRS, []);
  swap(PREFIXED, []);
  swap(SHIFT_PHRASES, EN_SHIFT_PHRASES);
  swap(MARK_WORDS, EN_MARK_WORDS);
  swap(ADAPTIVE_ORDER, EN_ADAPTIVE_ORDER);
  for (const k of Object.keys(SHIFT_CHARS)) delete SHIFT_CHARS[k];
  for (const [code, [, shifted]] of Object.entries(EN_KEYS)) SHIFT_CHARS[code] = shifted;
}
