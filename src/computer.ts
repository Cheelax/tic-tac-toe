// The computer player: pure functions over the game of game.ts, with no React and no DOM.
//
// Easy plays any legal move, at random. Hard searches the whole game (negamax over the list of moves, each
// position valued once), so it never loses and wins whenever the other side slips: a win counts for more the
// sooner it comes and a loss for less the later it comes, so among perfect moves it takes the one that ends
// the game first, and among equals it picks at random, so its games are not all the same.

import { boardOf, canPlay, CELL_COUNT, outcomeOf, play, type Moves, type Player } from "./game.ts";

export type Mode = "pvp" | "cpu";
export type Difficulty = "easy" | "hard";
export type First = "human" | "computer";

/** Who plays: two people, or one against the computer, at a level, one of them first. */
export interface Settings {
  readonly mode: Mode;
  readonly difficulty: Difficulty;
  readonly first: First;
}

export const DEFAULT_SETTINGS: Settings = { mode: "pvp", difficulty: "easy", first: "human" };

/** A source of numbers in [0, 1): Math.random in the app, something fixed in a test. */
export type Random = () => number;

/** The mark the computer plays under `settings`, or null with two players. X always starts, so the first player is X. */
export function computerMark(settings: Settings): Player | null {
  if (settings.mode !== "cpu") return null;
  return settings.first === "computer" ? "X" : "O";
}

/** Whether the computer is to move: the game is on and its mark plays next. */
export function isComputerTurn(moves: Moves, settings: Settings): boolean {
  const mark = computerMark(settings);
  if (mark === null) return false;
  const outcome = outcomeOf(boardOf(moves));
  return outcome.status === "playing" && outcome.next === mark;
}

/** Every cell the next player may play now. */
export function legalMoves(moves: Moves): number[] {
  const cells: number[] = [];
  for (let cell = 0; cell < CELL_COUNT; cell++) if (canPlay(moves, cell)) cells.push(cell);
  return cells;
}

/** One of `list`, drawn with `random`. */
function pick<T>(list: readonly T[], random: Random): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/** Easy: any legal move, at random; undefined when the game is over. */
export function randomMove(moves: Moves, random: Random = Math.random): number | undefined {
  const cells = legalMoves(moves);
  return cells.length > 0 ? pick(cells, random) : undefined;
}

/** A position is its board: the same board reached by other moves has the same value. */
const keyOf = (moves: Moves): string => boardOf(moves).map((mark) => mark ?? ".").join("");

const values = new Map<string, number>();

/** The other side's view of a value (a draw stays 0, never -0). */
const negate = (value: number): number => (value === 0 ? 0 : -value);

/**
 * The value of the game after `moves` for the player to move, both sides playing perfectly: positive a win,
 * 0 a draw, negative a loss. The magnitude is the number of empty cells left when the game ends, plus one,
 * so an outcome counts for more the sooner it comes.
 */
export function valueOf(moves: Moves): number {
  const key = keyOf(moves);
  const known = values.get(key);
  if (known !== undefined) return known;
  const outcome = outcomeOf(boardOf(moves));
  let value: number;
  if (outcome.status === "won") value = -(CELL_COUNT + 1 - moves.length); // the last move won: the player to move lost
  else if (outcome.status === "draw") value = 0;
  else value = Math.max(...legalMoves(moves).map((cell) => negate(valueOf(play(moves, cell)))));
  values.set(key, value);
  return value;
}

/** Every legal move with its value for the player to move. */
export function scoreMoves(moves: Moves): { cell: number; value: number }[] {
  return legalMoves(moves).map((cell) => ({ cell, value: negate(valueOf(play(moves, cell))) }));
}

/** The moves that keep the best outcome the position allows: the quickest win, or the longest defence. */
export function bestMoves(moves: Moves): number[] {
  const scored = scoreMoves(moves);
  if (scored.length === 0) return [];
  const top = Math.max(...scored.map(({ value }) => value));
  return scored.filter(({ value }) => value === top).map(({ cell }) => cell);
}

/** Hard: a perfect move, drawn at random among the equally good ones; undefined when the game is over. */
export function bestMove(moves: Moves, random: Random = Math.random): number | undefined {
  const cells = bestMoves(moves);
  return cells.length > 0 ? pick(cells, random) : undefined;
}

/** The computer's move at `difficulty`; undefined when the game is over. */
export function computerMove(moves: Moves, difficulty: Difficulty, random: Random = Math.random): number | undefined {
  return difficulty === "hard" ? bestMove(moves, random) : randomMove(moves, random);
}
