import { parse, type Span } from "../engine/search/dates.ts";
import { kindFilter, type SearchOptions } from "../engine/search/searcher.ts";
import { isScreenshot } from "../engine/reading/media.ts";

export interface Filters {
  within: string[];
  kinds: string[];
  inferredKinds: boolean;
  date: Span | null;
  inferredDate: boolean;
}

export function filtersFor(query: string, options: SearchOptions = {}): Filters {
  const explicit = options.kinds?.length ? options.kinds : null;
  const date = options.dateSpan ?? ((options.inferDate ?? true) ? parse(query, options.now) : null);
  return { within: options.within ?? [], kinds: explicit ?? ((options.inferKinds ?? true) ? [...kindFilter(query)] : []),
    inferredKinds: !explicit, date, inferredDate: !options.dateSpan && !!date };
}

/** Local calendar days, inclusive in the picker and exclusive at the end in search. */
export function dateRange(from: string, to: string): Span | null {
  if (!from && !to) return null;
  const day = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y, m, d] = value.split("-").map(Number), date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
  };
  const start = from ? day(from) : new Date(-8640000000000000), end = to ? day(to) : new Date(8640000000000000);
  if (!start || !end || start > end) return null;
  if (to) end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime(), label: from && to ? `${from} – ${to}` : from ? `Since ${from}` : `Until ${to}`,
    from, to, rest: "" };
}

export function inFolders(path: string, folders: string[]): boolean {
  return !folders.length || folders.some(folder => folder === "/" ? !path.includes("/") : path === folder || path.startsWith(folder + "/"));
}

export function meetsFilters(file: { path: string; kind: string; mtime?: number; info?: Record<string, unknown> }, filters: Filters): boolean {
  const taken = file.info?.taken, time = typeof taken === "number" ? taken : file.mtime;
  return inFolders(file.path, filters.within) && (!filters.kinds.length || filters.kinds.includes(file.kind) ||
    (filters.kinds.includes("screenshot") && file.kind === "image" && isScreenshot(file.path))) &&
    (!filters.date || (time !== undefined && filters.date.start <= time && time < filters.date.end));
}
