// The only module that touches localStorage: the score, kept across reloads. Storage can be missing, blocked
// (private browsing, a sandboxed frame), full or hold anything at all; none of that may break the game, which
// then keeps the score for the page's lifetime only.
import { ZERO_SCORE, type Score } from "./score.ts";

export const SCORE_KEY = "tic-tac-toe:score";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const count = (value: unknown): number => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);

/** The score saved as `text`; anything unreadable is 0. */
export function parseScore(text: string | null): Score {
  if (text === null) return ZERO_SCORE;
  try {
    const saved: unknown = JSON.parse(text);
    if (typeof saved !== "object" || saved === null) return ZERO_SCORE;
    const { x, o, draw } = saved as Record<string, unknown>;
    return { x: count(x), o: count(o), draw: count(draw) };
  } catch {
    return ZERO_SCORE;
  }
}

export function loadScore(store: Store | null = browserStore()): Score {
  try {
    return parseScore(store?.getItem(SCORE_KEY) ?? null);
  } catch {
    return ZERO_SCORE;
  }
}

export function saveScore(score: Score, store: Store | null = browserStore()): void {
  try {
    store?.setItem(SCORE_KEY, JSON.stringify({ x: score.x, o: score.o, draw: score.draw }));
  } catch {
    // Full or blocked: the score still lives in the page.
  }
}

/** Calls `listener` when another tab of the game changes the saved score; returns the unsubscribe. */
export function onSavedScoreChange(listener: (score: Score) => void): () => void {
  const handle = (event: StorageEvent) => {
    // key null: the other tab cleared its storage.
    if (event.key === SCORE_KEY || event.key === null) listener(parseScore(event.newValue));
  };
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}
