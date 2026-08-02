import type { GameId, GameModule, Round } from "./types";

export * from "./types";

/**
 * Light metadata for the lobby. Deliberately free of heavy imports — Word Hunt drags a 340 KB
 * dictionary behind it, and none of that belongs in the entry bundle. Use {@link loadGame} to pull
 * in the real module when a round actually starts.
 */
export const GAME_META: Record<GameId, { name: string; tagline: string; emoji: string }> = {
  fastmath: {
    name: "Fast Math",
    tagline: "Answer as many as you can in 60 seconds.",
    emoji: "＋",
  },
  wordhunt: {
    name: "Word Hunt",
    tagline: "Link touching letters to spell words.",
    emoji: "Aa",
  },
  tilemerge: {
    name: "Tile Merge",
    tagline: "Swipe to combine matching tiles.",
    emoji: "▦",
  },
};

const loaders: Record<GameId, () => Promise<GameModule<Round>>> = {
  fastmath: () => import("./fastmath").then((m) => m.fastMath as GameModule<Round>),
  wordhunt: () => import("./wordhunt").then((m) => m.wordHunt as GameModule<Round>),
  tilemerge: () => import("./tilemerge").then((m) => m.tileMerge as GameModule<Round>),
};

const cache = new Map<GameId, Promise<GameModule<Round>>>();

/** Lazy-loads a game module. Cached, so a replay does not re-download the chunk. */
export function loadGame(id: GameId): Promise<GameModule<Round>> {
  let existing = cache.get(id);
  if (!existing) {
    existing = loaders[id]();
    cache.set(id, existing);
  }
  return existing;
}
