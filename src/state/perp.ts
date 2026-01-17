export type PerpPositionsSnapshot = {
  positions: unknown[];
  ts: number;
  seq?: number;
};

let latestSnapshot: PerpPositionsSnapshot | null = null;
const listeners = new Set<(snapshot: PerpPositionsSnapshot) => void>();

export function setPerpPositions(snapshot: PerpPositionsSnapshot): void {
  latestSnapshot = snapshot;
  for (const listener of listeners) {
    listener(snapshot);
  }
}

export function getPerpPositions(): PerpPositionsSnapshot | null {
  return latestSnapshot;
}

export function subscribePerpPositions(listener: (snapshot: PerpPositionsSnapshot) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
