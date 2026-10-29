// The whole vault laid out by what's in it (Dowse's `explore`): aisles of files that are alike, whatever folder
// they're in, each named with words the model chose for it.
//
// - A file is the mean of its vectors (its passages, pages, pictures, moments). EmbeddingGemma puts every kind in one
//   space but in different regions of it (the modality gap): clustered as they are, photos would only find photos and
//   notes notes. Each modality's mean is taken off its vectors first, so what's left is what they're about.
// - Files are grouped by spherical k-means (k-means++ seeding, seeded: the same index gives the same map), the best of
//   `TRIES` runs (the most alike groups). One run depends on where it starts: on Dowse's testbed (64 files, 5 groups),
//   two seeds agreed at an adjusted Rand index of 0.43 on average (0.31 at worst); the best of 8, 0.79 (0.72), and of
//   16 no better (scripts/eval-explore.ts, 2026-10-28). A run over 5,000 files takes 0.7 s, beside what you're doing.
//   There are √n groups (at most 18), more than Dowse's √(n/3): its library mixes photos, recordings and documents,
//   a vault is mostly notes on many subjects. On Obsidian's help vault (179 notes, its 16 folders as subjects), the
//   aisles were purer (0.58 of each aisle's notes from one folder, against 0.47) and agreed better with the folders
//   (adjusted Rand index 0.36, against 0.31); on 36 one-sentence notes of 6 subjects, as pure (1.00), with 46% left
//   in "Everything else" instead of 64% (2026-10-29).
//   A group keeps a file only if it's like the rest of the group (`COHESION`, the cosine to the other members' mean);
//   the others are in "Everything else".
// - An aisle's name is the two words of a fixed everyday vocabulary that are closest to it and to no other aisle as
//   much (the vocabulary's own vectors, embedded once per vault by the model, centred the same way).
// - Aisles are placed by their likeness (the first two principal axes of their centres), spread so they don't
//   overlap, and each aisle's files spiral out from its middle, the most typical first.
//
// Dowse's aisles of your own (a description that gathers files) aren't here: every aisle is found.

import type { Store } from "../store.ts";
import { Prompts } from "../reading/types.ts";

export const WORDS = `
beach sea waves sand sunset sunrise sky clouds rain snow mountains forest trees flowers garden park river lake
waterfall desert island city street buildings bridge night lights road car train airplane boat bicycle traffic
house kitchen bedroom office desk computer screen keyboard phone camera television game music guitar piano drums
concert singing speech talk interview podcast lecture meeting class school university book page text letter
document contract lease invoice receipt bill bank money tax form table chart graph spreadsheet presentation slides
diagram map plan drawing painting art photo portrait selfie family friends children baby wedding party birthday
holiday travel trip museum church food meal cooking recipe cake coffee drink restaurant market shopping clothes
shoes sport football running fitness doctor health medicine hospital animal dog cat horse bird fish insect wolf
nature ocean storm fire smoke water ice night dark light colors black white screenshot error message code
software website app settings login chat email news politics history science space stars moon sun planet
technology robot machine tools building construction work job resume notes list calendar time clock sound noise
voice laughter applause silence wind birdsong animals farm field village castle ruins statue sculpture fashion
`.split(/\s+/).filter(Boolean);

export const TARGET = 1200;   // files shown on the map at most: beyond, each aisle shows its most typical ones and a count
export const COHESION = 0.1;  // how much like the rest of its group a file must be to stay in it
export const TRIES = 8;       // k-means runs, the best kept
export const REST = "Everything else";

export interface MapFile {
  path: string;
  kind: string;
  vectors: { modality: string; vector: ArrayLike<number> }[];
}

export interface Aisle {
  index: number;
  label: string;
  count: number;
  x: number;
  y: number;
  radius: number;
  id: string;      // "auto-<n>", or "rest"
  about: string;   // the words that describe it best
}

export interface MapPiece { path: string; kind: string; aisle: number; x: number; y: number }

export interface ExploreMap {
  aisles: Aisle[];
  pieces: MapPiece[];
  total: number;
  membership: Record<string, string[]>;   // aisle id → its files, the most typical first
}

/** Rows of a matrix stored flat. */
export class Matrix {
  readonly rows: number;
  readonly dim: number;
  readonly data: Float32Array;

  constructor(rows: number, dim: number, data = new Float32Array(rows * dim)) {
    this.rows = rows;
    this.dim = dim;
    this.data = data;
  }

  row(i: number): Float32Array {
    return this.data.subarray(i * this.dim, (i + 1) * this.dim);
  }
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function unit(v: Float32Array): Float32Array {
  const norm = Math.max(Math.sqrt(dot(v, v)), 1e-6);
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/** The normalised sum of some rows. */
function centreOf(points: Matrix, members: ArrayLike<number>): Float32Array {
  const sum = new Float32Array(points.dim);
  for (let m = 0; m < members.length; m++) {
    const row = points.row(members[m]);
    for (let j = 0; j < sum.length; j++) sum[j] += row[j];
  }
  return unit(sum);
}

/** One unit vector a file: the mean of its vectors, every modality centred on its own mean. Files without vectors
 * are left out. */
export function fileVectors(files: MapFile[]): { files: MapFile[]; vectors: Matrix } {
  const kept = files.filter((f) => f.vectors.length);
  const dim = kept[0]?.vectors[0].vector.length ?? 0;
  const means = new Map<string, { sum: Float64Array; n: number }>();
  for (const file of kept) {
    for (const { modality, vector } of file.vectors) {
      let mean = means.get(modality);
      if (!mean) means.set(modality, (mean = { sum: new Float64Array(dim), n: 0 }));
      for (let j = 0; j < dim; j++) mean.sum[j] += vector[j];
      mean.n++;
    }
  }
  const out = new Matrix(kept.length, dim);
  kept.forEach((file, i) => {
    const row = out.row(i);
    for (const { modality, vector } of file.vectors) {
      const mean = means.get(modality)!;
      for (let j = 0; j < dim; j++) row[j] += vector[j] - mean.sum[j] / mean.n;
    }
    unit(row);
  });
  return { files: kept, vectors: out };
}

/** A seeded generator in [0, 1) (mulberry32): the same vault gives the same map. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** (labels, unit centres): spherical k-means with k-means++ seeding. Yields between iterations (a large vault's
 * map is made beside what you're doing). */
export async function kmeans(points: Matrix, k: number, iterations = 30, seed = 7): Promise<{ labels: Int32Array; centres: Matrix }> {
  const random = seeded(seed);
  const n = points.rows;
  const centres = new Matrix(k, points.dim);
  centres.row(0).set(points.row(Math.floor(random() * n)));
  const best = new Float32Array(n).fill(-Infinity);
  for (let c = 1; c < k; c++) {
    const last = centres.row(c - 1);
    let total = 0;
    const weights = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      best[i] = Math.max(best[i], dot(points.row(i), last));
      weights[i] = Math.max(1 - best[i], 0) ** 2;
      total += weights[i];
    }
    let pick = Math.floor(random() * n);
    if (total > 0) {
      let target = random() * total;
      for (pick = 0; pick < n - 1 && (target -= weights[pick]) > 0; pick++);
    }
    centres.row(c).set(points.row(pick));
  }
  const labels = new Int32Array(n);
  for (let round = 0; round < iterations; round++) {
    let changed = round === 0;
    for (let i = 0; i < n; i++) {
      const row = points.row(i);
      let label = 0, top = -Infinity;
      for (let c = 0; c < k; c++) {
        const score = dot(row, centres.row(c));
        if (score > top) { top = score; label = c; }
      }
      if (labels[i] !== label) { labels[i] = label; changed = true; }
    }
    if (!changed) break;
    for (let c = 0; c < k; c++) {
      const members = [];
      for (let i = 0; i < n; i++) if (labels[i] === c) members.push(i);
      if (members.length) centres.row(c).set(centreOf(points, members));
    }
    if (n * k > 20000) await pause();
  }
  return { labels, centres };
}

/** The best of `tries` k-means runs: the groups whose files are most like their centres. */
export async function grouped(points: Matrix, k: number, tries = TRIES): Promise<Int32Array> {
  let best: Int32Array | null = null, top = -Infinity;
  for (let t = 0; t < tries; t++) {
    const { labels, centres } = await kmeans(points, k, 30, 7 + t);
    let fit = 0;
    for (let i = 0; i < points.rows; i++) fit += dot(points.row(i), centres.row(labels[i]));
    if (fit > top) { top = fit; best = labels; }
  }
  return best!;
}

/** (kept, loose): the members like the rest of their group (`COHESION`: each against the mean of the others), and
 * those that aren't. A group of one has no rest to be like. */
export function cohesive(vectors: Matrix, members: number[]): { kept: number[]; loose: number[] } {
  if (members.length < 2) return { kept: [], loose: members };
  const total = new Float32Array(vectors.dim);
  for (const m of members) {
    const row = vectors.row(m);
    for (let j = 0; j < total.length; j++) total[j] += row[j];
  }
  const kept: number[] = [], loose: number[] = [];
  const others = new Float32Array(vectors.dim);
  for (const m of members) {
    const own = vectors.row(m);
    for (let j = 0; j < others.length; j++) others[j] = total[j] - own[j];
    const alike = dot(own, others) / Math.max(Math.sqrt(dot(others, others)), 1e-6);
    (alike >= COHESION ? kept : loose).push(m);
  }
  return { kept, loose };
}

/** The vocabulary's vectors as the model gave them, centred and made unit. */
export function centredWords(raw: Float32Array[]): Float32Array[] {
  const dim = raw[0].length;
  const mean = new Float32Array(dim);
  for (const v of raw) for (let j = 0; j < dim; j++) mean[j] += v[j] / raw.length;
  return raw.map((v) => unit(Float32Array.from(v, (x, j) => x - mean[j])));
}

function descending(scores: ArrayLike<number>): number[] {
  return Array.from({ length: scores.length }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
}

/** Each aisle's name: the two words closest to it and to no other aisle as much; no two lead with the same word. */
export function names(centres: Float32Array[], words: Float32Array[] | null, vocabulary = WORDS): string[] {
  if (!words) return centres.map((_, i) => `Aisle ${i + 1}`);
  const scores = centres.map((centre) => Float32Array.from(words, (word) => dot(centre, word)));
  const mean = new Float32Array(words.length);
  for (const row of scores) for (let w = 0; w < words.length; w++) mean[w] += row[w] / scores.length;
  const used = new Set<string>();
  return scores.map((own) => {
    const order = descending(Float32Array.from(own, (s, w) => s - mean[w] + 0.5 * s));
    const picked = order.map((i) => vocabulary[i]).filter((w) => !used.has(w)).slice(0, 2);
    if (picked[0]) used.add(picked[0]);
    return picked.map((w, j) => (j === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" · ");
  });
}

/** An aisle described in words: the vocabulary's closest to it. */
export function about(centre: Float32Array, words: Float32Array[] | null, count = 5, vocabulary = WORDS): string {
  if (!words) return "";
  return descending(words.map((w) => dot(w, centre))).slice(0, count).map((i) => vocabulary[i]).join(", ");
}

/** The two leading eigenvectors (and eigenvalues) of a small symmetric matrix (Jacobi rotations). */
function leading(gram: number[][]): { values: number[]; vectors: number[][] } {
  const n = gram.length;
  const a = gram.map((row) => [...row]);
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => a[y][y] - a[x][x]).slice(0, 2);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => v.map((row) => row[i])) };
}

/** Where each aisle stands (x, y) and its radius: by likeness (the centres' first two principal axes), then spread
 * until none overlap, centred. `counts`: files an aisle holds; `total`: files on the map. */
export function layout(centres: Float32Array[], counts: number[], total: number): { place: [number, number][]; radius: number[]; shown: number[] } {
  const k = centres.length;
  const shown = counts.map((c) => Math.min(c, Math.max(4, Math.round(c * Math.min(1, TARGET / total)))));
  const radius = shown.map((s) => Math.sqrt(s) * 0.78 + 0.6);
  let place: [number, number][];
  if (k >= 3) {
    const dim = centres[0].length;
    const mean = new Float32Array(dim);
    for (const c of centres) for (let j = 0; j < dim; j++) mean[j] += c[j] / k;
    const centred = centres.map((c) => Float32Array.from(c, (x, j) => x - mean[j]));
    const gram = centred.map((a) => centred.map((b) => dot(a, b)));
    const { values, vectors } = leading(gram);   // the centred centres' SVD: U Σ = each eigenvector × √eigenvalue
    place = centred.map((_, i) => [vectors[0][i] * Math.sqrt(Math.max(values[0], 0)),
                                   vectors[1][i] * Math.sqrt(Math.max(values[1], 0))]);
    const largest = Math.max(1e-6, ...place.flat().map(Math.abs));
    const scale = radius.reduce((a, b) => a + b, 0) * 0.3 / largest;
    place = place.map(([x, y]) => [x * scale, y * scale]);
  } else {
    const widest = Math.max(...radius);
    place = centres.map((_, i) => [i * widest * 2.4, 0]);
  }
  for (let round = 0; round < 300; round++) {   // push apart until no two aisles overlap
    let moved = false;
    for (let a = 0; a < k; a++) {
      for (let b = a + 1; b < k; b++) {
        const dx = place[b][0] - place[a][0], dy = place[b][1] - place[a][1];
        const distance = Math.hypot(dx, dy) || 1e-3;
        const need = radius[a] + radius[b] + 0.9;
        if (distance < need) {
          const push = (need - distance) / 2 / distance;
          place[a][0] -= push * dx; place[a][1] -= push * dy;
          place[b][0] += push * dx; place[b][1] += push * dy;
          moved = true;
        }
      }
    }
    if (!moved) {
      for (const p of place) { p[0] *= 0.995; p[1] *= 0.995; }
      break;
    }
  }
  const mx = place.reduce((s, p) => s + p[0], 0) / k, my = place.reduce((s, p) => s + p[1], 0) / k;
  return { place: place.map(([x, y]) => [x - mx, y - my]), radius, shown };
}

/** The map of `files` (each with its vectors), named with the vocabulary's vectors as the model gave them (null:
 * "Aisle 1", "Aisle 2"…). */
export async function buildMap(all: MapFile[], rawWords: Float32Array[] | null): Promise<ExploreMap> {
  const { files, vectors } = fileVectors(all);
  if (!files.length) return { aisles: [], pieces: [], total: 0, membership: {} };
  const n = files.length;
  const k = n >= 6 ? Math.min(Math.max(Math.round(Math.sqrt(n)), 1), 18) : 1;   // (Dowse: √(n/3); see above)
  return arrange(files, vectors, await grouped(vectors, k), k, rawWords);
}

/** The map, once the files are grouped (`labels`, of `k` groups): what isn't like its group set apart, each aisle
 * named, placed, and its files laid out. */
export function arrange(files: MapFile[], vectors: Matrix, labels: ArrayLike<number>, k: number,
                        rawWords: Float32Array[] | null, vocabulary = WORDS): ExploreMap {
  const words = rawWords ? centredWords(rawWords) : null;
  const groups: { members: number[]; centre: Float32Array }[] = [];
  const loose: number[] = [];
  for (let c = 0; c < k; c++) {
    const members: number[] = [];
    for (let i = 0; i < labels.length; i++) if (labels[i] === c) members.push(i);
    const split = cohesive(vectors, members);
    loose.push(...split.loose);
    if (split.kept.length) groups.push({ members: split.kept, centre: centreOf(vectors, split.kept) });
  }
  const labelled = names(groups.map((g) => g.centre), words, vocabulary);
  const order: number[][] = [], centres: Float32Array[] = [], aisleNames: string[] = [], abouts: string[] = [], ids: string[] = [];
  groups.forEach((group, c) => {
    const typical = group.members.map((m) => [m, dot(vectors.row(m), group.centre)] as const)
      .sort((a, b) => b[1] - a[1]).map(([m]) => m);
    order.push(typical);
    centres.push(group.centre);
    aisleNames.push(labelled[c]);
    abouts.push(about(group.centre, words, 5, vocabulary));
    ids.push(`auto-${c}`);
  });
  if (loose.length) {   // like no group: on the floor without an aisle of their own
    order.push(loose);
    centres.push(centreOf(vectors, loose));
    aisleNames.push(REST);
    abouts.push("");
    ids.push("rest");
  }

  const { place, radius, shown } = layout(centres, order.map((o) => o.length), files.length);
  const aisles: Aisle[] = [], pieces: MapPiece[] = [];
  order.forEach((members, c) => {
    aisles.push({ index: c, label: aisleNames[c], count: members.length, x: place[c][0], y: place[c][1],
                  radius: radius[c], id: ids[c], about: abouts[c] });
    members.slice(0, shown[c]).forEach((m, i) => {   // a sunflower spiral: dense, round, the most typical at the middle
      const angle = i * 2.39996, r = Math.sqrt(i + 0.5) * 0.78;
      pieces.push({ path: files[m].path, kind: files[m].kind, aisle: c,
                    x: place[c][0] + r * Math.cos(angle), y: place[c][1] + r * Math.sin(angle) });
    });
  });
  const membership = Object.fromEntries(order.map((members, c) => [ids[c], members.map((m) => files[m].path)]));
  return { aisles, pieces, total: files.length, membership };
}

/** The vocabulary's vectors for this vault's index, as the model gave them: kept with it, embedded the first time
 * (null: not yet, and no model to embed them). */
export async function wordVectors(store: Store, embed: ((prompts: string[]) => Promise<Float32Array[]>) | null): Promise<Float32Array[] | null> {
  const kept = await store.meta<{ words: string; vectors: ArrayBuffer }>("explore-words");
  const key = WORDS.join(" ");
  if (kept && kept.words === key) {
    const all = new Float32Array(kept.vectors);
    const dim = all.length / WORDS.length;
    return WORDS.map((_, i) => all.slice(i * dim, (i + 1) * dim));
  }
  if (!embed) return null;
  const vectors: Float32Array[] = [];
  for (let i = 0; i < WORDS.length; i += 16) vectors.push(...(await embed(WORDS.slice(i, i + 16).map(Prompts.query))));
  const dim = vectors[0].length;
  const all = new Float32Array(WORDS.length * dim);
  vectors.forEach((v, i) => all.set(v, i * dim));
  await store.setMeta("explore-words", { words: key, vectors: all.buffer });
  return vectors;
}
