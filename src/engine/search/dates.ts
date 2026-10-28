// When a query says when: "last summer", "from July 2025", "yesterday", "3 weeks ago". Dowse's `dates`.
//
// The model knows what's in a file, not when it was made, so a date in the query is a filter (on when a photo was
// taken, or else when the file last changed), and the words that said it are taken out of what the model is asked.
// Only what's said plainly is read: a bare year ("tax return 2019") or a bare month ("May") stays a word. Seasons are
// the northern hemisphere's.

const MONTH_NAMES: string[][] = [["january", "jan"], ["february", "feb"], ["march", "mar"], ["april", "apr"],
  ["may"], ["june", "jun"], ["july", "jul"], ["august", "aug"], ["september", "sep", "sept"], ["october", "oct"],
  ["november", "nov"], ["december", "dec"]];
const MONTHS: Record<string, number> = Object.fromEntries(MONTH_NAMES.flatMap((names, i) => names.map((n) => [n, i + 1])));
const SEASONS: Record<string, number> = { spring: 3, summer: 6, autumn: 9, fall: 9, winter: 12 };
const UNITS: Record<string, string> = { day: "day", days: "day", week: "week", weeks: "week", month: "month",
  months: "month", year: "year", years: "year" };
const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, "a couple of": 2, "a few": 3 };

const byLength = (words: string[]) => words.sort((a, b) => b.length - a.length).join("|");
const MONTH = byLength(Object.keys(MONTHS));
const SEASON = Object.keys(SEASONS).join("|");
const YEAR = String.raw`(?:19[7-9]\d|20\d\d)`;
const LEAD = String.raw`(?:(?:taken|made|written|shot|saved|modified|edited|changed|sent|received|from|in|during|on|since)\s+)`;
const COUNT = `(\\d+|${byLength(Object.keys(NUMBERS))})`;

const PATTERNS: [RegExp, string][] = [   // in the order tried; the match is taken out of the query
  [new RegExp(String.raw`\b${LEAD}*(?:the\s+)?(last|this|past|previous)\s+(${SEASON})\b`), "season-relative"],
  [new RegExp(String.raw`\b${LEAD}*(?:the\s+)?(${SEASON})\s+(?:of\s+)?(${YEAR})\b`), "season-year"],
  [new RegExp(String.raw`\b${LEAD}*(?:the\s+)?(last|this|past|previous)\s+(week|month|year)\b`), "period-relative"],
  [new RegExp(String.raw`\b${LEAD}*${COUNT}\s+(days?|weeks?|months?|years?)\s+ago\b`), "ago"],
  [new RegExp(String.raw`\b${LEAD}*(today|yesterday)\b`), "day"],
  [new RegExp(String.raw`\b${LEAD}*(${MONTH})\.?\s+(${YEAR})\b`), "month-year"],
  [new RegExp(String.raw`\b${LEAD}+(?:the\s+month\s+of\s+)?(${MONTH})\b(?!\s+\d)`), "month"],
  [new RegExp(String.raw`\b${LEAD}+(?:the\s+year\s+)?(${YEAR})\b`), "year"],
];

export interface Span {
  start: number;   // milliseconds, local time: [start, end)
  end: number;
  label: string;   // "summer 2026", "July 2025", "yesterday"
  rest: string;    // the query without the words that said when
  from?: string;   // ISO dates, for showing the filter
  to?: string;
}

type Day = { y: number; m: number; d: number };   // a calendar day (months 1–12)

const toDate = (day: Day) => new Date(day.y, day.m - 1, day.d);
const fromDate = (date: Date): Day => ({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() });
const addDays = (day: Day, n: number) => fromDate(new Date(day.y, day.m - 1, day.d + n));
const iso = (day: Day) => `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
const before = (a: Day, b: Day) => toDate(a) < toDate(b);
const monthName = (m: number) => MONTH_NAMES[m - 1][0][0].toUpperCase() + MONTH_NAMES[m - 1][0].slice(1);
const weekday = (day: Day) => (toDate(day).getDay() + 6) % 7;   // Monday 0, as Python's

function monthSpan(year: number, month: number): [Day, Day] {
  const following = month === 12 ? { y: year + 1, m: 1, d: 1 } : { y: year, m: month + 1, d: 1 };
  return [{ y: year, m: month, d: 1 }, addDays(following, -1)];
}

/** `year`'s season; winter is the one that ends in `year` (December before it to February). */
function seasonSpan(name: string, year: number): [Day, Day] {
  const start = SEASONS[name];
  if (start === 12) return [{ y: year - 1, m: 12, d: 1 }, monthSpan(year, 2)[1]];
  return [{ y: year, m: start, d: 1 }, monthSpan(year, start + 2)[1]];
}

function span(kind: string, groups: string[], today: Day): [Day, Day, string] | null {
  if (kind === "season-relative") {
    const [which, name] = groups;
    let year = today.y + (SEASONS[name] === 12 && today.m === 12 ? 1 : 0);
    let [first, last] = seasonSpan(name, year);
    if (["last", "past", "previous"].includes(which)) {   // the latest one that's over
      while (!before(last, today)) [first, last] = seasonSpan(name, --year);
    } else if (before(today, first)) {                     // "this summer" in March: last year's
      [first, last] = seasonSpan(name, --year);
    }
    return [first, last, SEASONS[name] === 12 ? `winter ${first.y}–${last.y}` : `${name} ${first.y}`];
  }
  if (kind === "season-year") {
    const [name, year] = groups;
    const [first, last] = seasonSpan(name, Number(year));
    return [first, last, `${name} ${year}`];
  }
  if (kind === "period-relative") {
    const [which, unit] = groups;
    const back = which !== "this" ? 1 : 0;
    if (unit === "week") {
      const monday = addDays(today, -weekday(today) - 7 * back);
      return [monday, addDays(monday, 6), `${which} week`];
    }
    if (unit === "month") {
      const [year, month] = back ? [today.y - (today.m === 1 ? 1 : 0), ((today.m - 2 + 12) % 12) + 1] : [today.y, today.m];
      const [first, last] = monthSpan(year, month);
      return [first, last, `${monthName(month)} ${year}`];
    }
    const year = today.y - back;
    return [{ y: year, m: 1, d: 1 }, { y: year, m: 12, d: 31 }, String(year)];
  }
  if (kind === "ago") {
    const [count, raw] = groups;
    const n = /^\d+$/.test(count) ? Number(count) : NUMBERS[count];
    const unit = UNITS[raw];
    const s = n !== 1 ? "s" : "";
    if (unit === "day") {
      const day = addDays(today, -n);
      return [addDays(day, -1), addDays(day, 1), `${n} day${s} ago`];
    }
    if (unit === "week") {
      const monday = addDays(today, -weekday(today) - 7 * n);
      return [monday, addDays(monday, 6), `${n} week${s} ago`];
    }
    if (unit === "month") {
      const index = today.y * 12 + today.m - 1 - n;
      const [first, last] = monthSpan(Math.floor(index / 12), (index % 12) + 1);
      return [first, last, `${monthName(first.m)} ${first.y}`];
    }
    return [{ y: today.y - n, m: 1, d: 1 }, { y: today.y - n, m: 12, d: 31 }, String(today.y - n)];
  }
  if (kind === "day") {
    const day = groups[0] === "yesterday" ? addDays(today, -1) : today;
    return [day, day, groups[0]];
  }
  if (kind === "month-year") {
    const [first, last] = monthSpan(Number(groups[1]), MONTHS[groups[0]]);
    return [first, last, `${monthName(first.m)} ${first.y}`];
  }
  if (kind === "month") {
    const month = MONTHS[groups[0]];
    const [first, last] = monthSpan(month <= today.m ? today.y : today.y - 1, month);   // the latest not in the future
    return [first, last, `${monthName(month)} ${first.y}`];
  }
  if (kind === "year") {
    const year = Number(groups[0]);
    return year > today.y ? null : [{ y: year, m: 1, d: 1 }, { y: year, m: 12, d: 31 }, String(year)];
  }
  return null;
}

/** The first span of time the query names plainly, or null. `now`: milliseconds (default: now). */
export function parse(text: string, now: number = Date.now()): Span | null {
  const today = fromDate(new Date(now));
  const folded = text.toLowerCase();
  for (const [pattern, kind] of PATTERNS) {
    const match = pattern.exec(folded);
    if (!match) continue;
    const found = span(kind, match.slice(1), today);
    if (!found) continue;
    let [first, last, label] = found;
    if (match[0].split(/\s+/)[0] === "since") [last, label] = [today, `since ${label}`];
    const rest = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length)).split(/\s+/)
      .filter(Boolean).join(" ");
    return { start: toDate(first).getTime(), end: toDate(addDays(last, 1)).getTime(), label, rest,
             from: iso(first), to: iso(last) };
  }
  return null;
}

/** What the model should be asked: the query without its date ("sunflowers from last summer" → "sunflowers"). */
export function forMeaning(text: string, now?: number): string {
  const found = parse(text, now);
  return found && found.rest.trim() ? found.rest : text;
}
