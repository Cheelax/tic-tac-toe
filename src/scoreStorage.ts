/** Browser persistence is isolated from the rules and reducer. */
export interface Scores { x: number; o: number; draw: number }
export const EMPTY_SCORES: Scores = { x: 0, o: 0, draw: 0 };
export const SCORE_KEY = "tic-tac-toe.scores.v1";
type ScoreStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): ScoreStorage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

export function readScores(storage: ScoreStorage | undefined = browserStorage()): Scores {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(SCORE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_SCORES };
    const score = parsed as Scores;
    if (![score.x, score.o, score.draw].every((n) => Number.isSafeInteger(n) && n >= 0)) return { ...EMPTY_SCORES };
    return { x: score.x, o: score.o, draw: score.draw };
  } catch { return { ...EMPTY_SCORES }; }
}

export function writeScores(scores: Scores, storage: ScoreStorage | undefined = browserStorage()): boolean {
  if (!storage) return false;
  try { storage.setItem(SCORE_KEY, JSON.stringify(scores)); return true; } catch { return false; }
}
