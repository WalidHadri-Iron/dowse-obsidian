// A file on the wall: one vitrine.
export interface Piece {
  key: string;          // the file's path: the same file keeps its vitrine from one query to the next
  path: string;
  kind: string;
  loc: number | null;
  name: string;
  line: string;         // the tag's machine line: kind, page or moment, folder
  strong: boolean;
  visual: boolean;
  excerpt: string | null;
  back?: boolean;       // the rest of the rack, behind what a search pulled forward
  closest?: boolean;    // optional weaker candidate, not an engine-confirmed strong match
  score?: number;       // relative ranking value; used for visual area, never presented as confidence
}
