'use strict';

// ---------- Typing language ----------
// The site teaches Hebrew by default; visitors can switch the exercises to English.
// The choice is read once at load (switching reloads the page), so every other
// script simply sees Hebrew or English data.
const LANG = (() => {
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

// The same course as the Hebrew one, on the same physical keys, with English letters.
// Progress is stored under 100 + id so it never mixes with the Hebrew lessons.
const EN_LESSONS = [
  { id: 1, group: 'שורת הבית', title: 'יד שמאל: a s d f', newKeys: ['a', 's', 'd', 'f'], target: 12,
    desc: 'הניחו את אצבעות יד שמאל על a s d f. האצבע המורה נחה על f, ויש עליו בליטה קטנה שעוזרת למצוא אותו בלי להסתכל.' },
  { id: 2, title: 'יד ימין: j k l ;', newKeys: ['j', 'k', 'l', ';'], target: 12,
    desc: 'אצבעות יד ימין על j k l ;. האצבע המורה נחה על j (גם עליו יש בליטה). האגודלים על מקש הרווח.' },
  { id: 3, title: 'g ו־h', newKeys: ['g', 'h'], target: 12,
    desc: 'האצבע המורה השמאלית נמתחת ימינה אל g, והאצבע המורה הימנית נמתחת שמאלה אל h. אחרי כל הקשה חוזרים לשורת הבית.' },
  { id: 4, title: 'חזרה: שורת הבית', newKeys: [], review: true, target: 14,
    desc: 'כל מקשי שורת הבית יחד. התמקדו בדיוק, בלי להסתכל על המקלדת.' },
  { id: 5, group: 'השורה העליונה', title: 'r t y u', newKeys: ['r', 't', 'y', 'u'], target: 14,
    desc: 'האצבעות המורות עולות לשורה העליונה: שמאל אל r ו־t, ימין אל y ו־u.' },
  { id: 6, title: 'e ו־i', newKeys: ['e', 'i'], target: 14,
    desc: 'אצבעות האמה עולות שורה: האמה השמאלית אל e והאמה הימנית אל i.' },
  { id: 7, title: 'q w o p', newKeys: ['q', 'w', 'o', 'p'], target: 14,
    desc: 'הקמיצות והזרתות עולות: הזרת השמאלית אל q, הקמיצה השמאלית אל w, הקמיצה הימנית אל o והזרת הימנית אל p.' },
  { id: 8, title: 'חזרה: שורת הבית והשורה העליונה', newKeys: [], review: true, target: 16,
    desc: 'משלבים את שתי השורות. זכרו לחזור עם כל אצבע למקומה בשורת הבית.' },
  { id: 9, group: 'השורה התחתונה', title: 'v b n m', newKeys: ['v', 'b', 'n', 'm'], target: 16,
    desc: 'האצבעות המורות יורדות לשורה התחתונה: שמאל אל v ו־b, ימין אל n ו־m.' },
  { id: 10, title: 'c x z', newKeys: ['c', 'x', 'z'], target: 16,
    desc: 'האמה השמאלית יורדת אל c, הקמיצה השמאלית אל x והזרת השמאלית אל z.' },
  { id: 11, title: 'חזרה: כל האותיות', newKeys: [], review: true, target: 18,
    desc: 'כל 26 האותיות האנגליות. עכשיו אתם מכירים את כל המקלדת!' },
  { id: 12, group: 'שלב מתקדם', title: 'אותיות גדולות (Shift)', newKeys: [], type: 'caps', target: 16,
    desc: 'לאות גדולה לוחצים על Shift ביד הנגדית: אות של יד שמאל עם Shift ימני, ואות של יד ימין עם Shift שמאלי.' },
  { id: 13, title: 'פיסוק: נקודה ופסיק', newKeys: ['.', ','], type: 'punct', target: 18,
    desc: 'בפריסה האנגלית הפסיק נמצא על מקש , (האמה הימנית) והנקודה על מקש . (הקמיצה הימנית).' },
  { id: 14, title: 'מילים נפוצות', newKeys: [], type: 'words', target: 20,
    desc: 'המילים השכיחות ביותר באנגלית. ככל שתקלידו אותן יותר, כך הן יהפכו לתנועה אחת רציפה.' },
  { id: 15, title: 'משפטים', newKeys: [], type: 'sentences', target: 20,
    desc: 'משפטים שלמים באנגלית עם אותיות גדולות, רווחים ופיסוק, כמו הקלדה אמיתית.' },
  { id: 16, title: 'מספרים', newKeys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], type: 'numbers', target: 16,
    desc: 'שורת המספרים. כל אצבע עולה שתי שורות מעל מקומה בשורת הבית.' },
];
EN_LESSONS.forEach((l, i) => { if (!l.group) l.group = EN_LESSONS[i - 1].group; l.pid = 100 + l.id; });
LESSONS.forEach(l => { l.pid = l.id; });
const HE_SHIFT = { ...SHIFT_CHARS };

if (LANG === 'en') {
  const swap = (arr, items) => arr.splice(0, arr.length, ...items);
  swap(WORDS, EN_WORDS);
  swap(SENTENCES, EN_SENTENCES);
  swap(QUOTES, EN_QUOTES);
  swap(LESSONS, EN_LESSONS);
  for (const k of Object.keys(SHIFT_CHARS)) delete SHIFT_CHARS[k];
  for (const [code, [, shifted]] of Object.entries(EN_KEYS)) SHIFT_CHARS[code] = shifted;
}
