import { boardOf, CELL_COUNT, NEW_GAME, outcomeOf, play, type Moves } from "./game.ts";

export type LinkedGame =
  | { readonly moves: Moves; readonly error: null }
  | { readonly moves: Moves; readonly error: string };

const invalid = (error: string): LinkedGame => ({ moves: NEW_GAME, error });

/** Validate the entire replay before exposing any of it. At most nine moves are examined. */
export function parseGame(value: string | null): LinkedGame {
  if (value === null || value === "") return { moves: NEW_GAME, error: null };
  if (value.length > CELL_COUNT) return invalid("A game can contain at most 9 moves.");
  if (!/^[0-8]+$/.test(value)) return invalid("Use only cell numbers 0 to 8, with no spaces or punctuation.");
  let moves: Moves = NEW_GAME;
  for (const digit of value) {
    const cell = Number(digit);
    const step = moves.length + 1;
    if (outcomeOf(boardOf(moves)).status !== "playing") {
      return invalid(`Move ${step} comes after the game has ended.`);
    }
    if (moves.includes(cell)) return invalid(`Move ${step} repeats cell ${cell}, which is already occupied.`);
    moves = play(moves, cell);
  }
  return { moves, error: null };
}

/** URL decoding belongs here; repeated game parameters are ambiguous and refused. */
export function readGameLink(href: string): LinkedGame {
  try {
    const values = new URL(href).searchParams.getAll("game");
    if (values.length > 1) return invalid("The link must contain only one game parameter.");
    return parseGame(values[0] ?? null);
  } catch {
    return invalid("This game link is not a valid URL.");
  }
}

/** Share only the position shown, on this page's origin and path, without unrelated query data or a fragment. */
export function writeGameLink(href: string, moves: Moves): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("game", moves.join(""));
  return url.href;
}
