// A fixed bank of everyday queries, for telling hubs apart from matches (Dowse's `probes`, the same 102).
//
// Some vectors sit close to everything (a blank page, a stretch of noise): whatever the query, they score high, and
// they'd come up for every search. A vector's typical similarity to these probes says how much of its score is its own
// level rather than the query (the searcher subtracts half of it, as CSLS does). And a result plainly matches only if
// the query describes it at least as well as all but one of them do. Embedded once per vault, kept with its index.

import type { Store } from "../store.ts";
import { Prompts } from "../reading/types.ts";

export const PROBES = [
  "a cat sleeping", "a horse in a field", "birds on a branch", "a fish in an aquarium", "a car on a highway",
  "a bicycle against a wall", "an airplane in the sky", "a train station", "a boat on a lake", "a city skyline",
  "a mountain trail", "a sandy beach", "a forest in autumn", "a snowy street", "a sunset over the sea",
  "a garden with flowers", "a kitchen table", "a living room", "an office desk", "a classroom", "a birthday party",
  "a wedding", "a family photo", "a selfie", "a crowd at a concert", "a football stadium", "a plate of food",
  "a cup of coffee", "a bowl of salad", "a chocolate cake", "a glass of wine", "a smartphone", "a laptop keyboard",
  "a television", "a camera", "a pair of shoes", "a red dress", "a book on a shelf", "a painting in a museum",
  "a church", "a bridge over a river", "a map", "an invoice", "a bank statement", "a tax form", "a contract",
  "a receipt", "a passport", "a boarding pass", "a resume", "a letter", "meeting notes", "a shopping list",
  "a recipe", "a train timetable", "a manual", "a scientific paper", "a news article", "a spreadsheet with numbers",
  "a chart", "a slide presentation", "an error message", "a login page", "a chat conversation", "an email",
  "source code", "a settings window", "a calendar", "a weather forecast", "a web page", "a video game menu",
  "people talking", "a phone call", "a lecture", "a podcast interview", "a song with guitar", "piano music", "drums",
  "a choir singing", "applause", "rain falling", "wind", "traffic noise", "a dog barking", "birds singing",
  "a baby crying", "laughter", "an announcement", "a news broadcast", "silence", "health and fitness",
  "money and investing", "travel plans", "politics", "history", "science", "cooking", "sports results",
  "technology news", "school homework", "a job interview", "a doctor's appointment",
];

/** The probes' vectors for this vault's index: kept with it, embedded the first time they're needed. */
export async function probes(store: Store, embed: (prompts: string[]) => Promise<Float32Array[]>): Promise<Float32Array[]> {
  const kept = await store.meta<{ count: number; vectors: ArrayBuffer }>("probes");
  if (kept && kept.count === PROBES.length) {
    const all = new Float32Array(kept.vectors);
    return PROBES.map((_, i) => all.slice(i * 768, (i + 1) * 768));
  }
  const vectors: Float32Array[] = [];
  for (const probe of PROBES) vectors.push(...(await embed([Prompts.query(probe)])));
  const all = new Float32Array(PROBES.length * 768);
  vectors.forEach((v, i) => all.set(v, i * 768));
  await store.setMeta("probes", { count: PROBES.length, vectors: all.buffer });
  return vectors;
}
