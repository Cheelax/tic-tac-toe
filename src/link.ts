// Shareable links, with no UI: a game is `?game=<cells>`, the cells in the order they were played, X first
// (`?game=40852`: X 4, O 0, X 8, O 5, X 2). Pure functions on top of round 1's rules: parsing a link replays its
// moves with game.ts, writing one joins them; no React, no DOM.
import { boardOf, CELL_COUNT, outcomeOf, play, statusText, type Moves } from "./game.ts";

/** The query parameter that carries a game. */
export const GAME_PARAM = "game";

/** What a link holds: a game, or the reason it holds none. */
export type LinkGame = { readonly ok: true; readonly moves: Moves } | { readonly ok: false; readonly reason: string };

const refuse = (reason: string): LinkGame => ({ ok: false, reason });

/** A character as the reason names it: a space or a control character would be invisible in quotes. */
const named = (char: string): string =>
  /^\s$/u.test(char) ? "a space" : /^\p{Cc}$/u.test(char) ? "a control character" : JSON.stringify(char);

/**
 * The game `cells` lists (the value of `game=`), or why it is not one: a character that is not a digit from 0 to
 * 8, more than 9 moves, a cell played twice, or a move after the game ended. Empty is the empty game. The reason
 * names the first problem and never repeats the link itself, however long it is.
 */
export function parseMoves(cells: string): LinkGame {
  const chars = [...cells];
  const bad = chars.findIndex((char) => !/^[0-8]$/.test(char));
  if (bad >= 0) return refuse(`${named(chars[bad])} (character ${bad + 1}) is not a square: squares are the digits 0 to 8.`);
  if (chars.length > CELL_COUNT) return refuse(`It lists ${chars.length} moves, and a game has at most ${CELL_COUNT}.`);
  let moves: Moves = [];
  for (const [index, char] of chars.entries()) {
    const cell = Number(char);
    const outcome = outcomeOf(boardOf(moves));
    if (outcome.status !== "playing") {
      return refuse(`Move ${index + 1} comes after the game ended (${statusText(outcome)} on move ${index}).`);
    }
    const earlier = moves.indexOf(cell);
    if (earlier >= 0) return refuse(`Move ${index + 1} plays square ${cell}, already taken on move ${earlier + 1}.`);
    moves = play(moves, cell);
  }
  return { ok: true, moves };
}

/** The game a page's query string (`location.search`) carries: none, or an empty `game=`, is the empty game. */
export function gameOfSearch(search: string): LinkGame {
  const values = new URLSearchParams(search).getAll(GAME_PARAM);
  if (values.length > 1) return refuse(`It holds ${values.length} games (game= appears ${values.length} times), and a link holds one.`);
  return parseMoves(values[0] ?? "");
}

/**
 * The link that opens `moves` on the page at `page` (a full URL): its origin and path, then `?game=` and the cells
 * in order. The page's own query and fragment are dropped; the empty game has no `game` at all.
 */
export function linkOf(page: string, moves: Moves): string {
  const url = new URL(page);
  url.search = "";
  url.hash = "";
  if (moves.length > 0) url.searchParams.set(GAME_PARAM, moves.join(""));
  return url.href;
}
