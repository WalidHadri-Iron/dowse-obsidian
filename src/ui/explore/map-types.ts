export interface MapPiece {
  path: string;
  kind: string;
  name: string;
  folder: string;
  visual: boolean;
  version?: number;   // modification time: refresh edited previews without discarding other files' textures
  aisle: number;
  x: number;
  y: number;
}
export interface MapAisle {
  index: number;
  label: string;
  count: number;
  x: number;
  y: number;
  radius: number;
  id?: string;        // "auto-<n>", or "rest"
  about?: string;
}
