import { boardOf, outcomeOf, type Moves } from "./game.ts";

/** Finished games: X's wins, O's wins and the draws. */
export interface Score {
  readonly x: number;
  readonly o: number;
  readonly draw: number;
}

export const ZERO_SCORE: Score = { x: 0, o: 0, draw: 0 };

/** `score` with the game that ended on `moves` added; a game still on adds nothing. */
export function scoreAfter(score: Score, moves: Moves): Score {
  const outcome = outcomeOf(boardOf(moves));
  if (outcome.status === "won") return outcome.winner === "X" ? { ...score, x: score.x + 1 } : { ...score, o: score.o + 1 };
  if (outcome.status === "draw") return { ...score, draw: score.draw + 1 };
  return score;
}

export const sameScore = (a: Score, b: Score): boolean => a.x === b.x && a.o === b.o && a.draw === b.draw;
