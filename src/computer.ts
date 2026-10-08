import { boardOf, CELL_COUNT, outcomeOf, play, type Moves, type Player } from "./game.ts";

export type Difficulty = "easy" | "hard";

/** Empty squares in a game still in progress, using round 1's outcome rules. */
export function legalMoves(moves: Moves): number[] {
  const board = boardOf(moves);
  if (outcomeOf(board).status !== "playing") return [];
  return Array.from({ length: CELL_COUNT }, (_, cell) => cell).filter((cell) => board[cell] === null);
}

/** A uniform choice: the caller supplies a random sample so this function stays pure. */
export function easyMove(moves: Moves, sample: number): number | null {
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new RangeError("sample must be in [0, 1)");
  const legal = legalMoves(moves);
  return legal.length ? legal[Math.floor(sample * legal.length)] : null;
}

/** Full minimax: prefer a win to a draw to a loss, faster wins, and slower losses. */
export function hardMove(moves: Moves): number | null {
  const current = outcomeOf(boardOf(moves));
  if (current.status !== "playing") return null;
  const computer: Player = current.next;
  // This cache belongs to one search: no shared state or dependency on earlier games.
  const cache = new Map<string, number>();
  function score(candidate: Moves): number {
    const board = boardOf(candidate);
    const key = board.map((mark) => mark ?? ".").join("");
    const known = cache.get(key);
    if (known !== undefined) return known;
    const outcome = outcomeOf(board);
    let value: number;
    if (outcome.status === "won") {
      value = (outcome.winner === computer ? 1 : -1) * (10 - candidate.length);
    } else if (outcome.status === "draw") {
      value = 0;
    } else {
      const values = legalMoves(candidate).map((cell) => score(play(candidate, cell)));
      value = outcome.next === computer ? Math.max(...values) : Math.min(...values);
    }
    cache.set(key, value);
    return value;
  }
  // For equally good moves, centre, corners, then edges; no random input on Hard.
  const preference = [4, 0, 2, 6, 8, 1, 3, 5, 7];
  const legal = legalMoves(moves);
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const cell of preference.filter((cell) => legal.includes(cell))) {
    const value = score(play(moves, cell));
    if (value > bestScore) {
      best = cell;
      bestScore = value;
    }
  }
  return best;
}
