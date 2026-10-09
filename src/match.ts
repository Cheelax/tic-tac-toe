import { boardOf, NEW_GAME, outcomeOf, play, type Moves, type Player } from "./game.ts";
import type { Difficulty } from "./computer.ts";
import type { LinkGame } from "./link.ts";
import { sameScore, scoreAfter, ZERO_SCORE, type Score } from "./score.ts";

export interface Settings {
  mode: "pvp" | "cpu";
  difficulty: Difficulty;
  first: "human" | "computer";
}
export interface Match {
  /** Every move of the current game, in order, the ones after the position shown included. */
  history: Moves;
  /** The position shown and played from: the first `moves.length` moves of `history`. */
  moves: Moves;
  settings: Settings;
  /** A reset changes the revision even if the board was already empty. */
  revision: number;
  /** The current game has ended once: it counted then, and counts nothing more, whatever is replayed. */
  counted: boolean;
  score: Score;
  /** Why the link the page was opened with holds no game; shown until the first move or a new game. */
  linkError: string | null;
}
export const INITIAL_MATCH: Match = {
  history: NEW_GAME,
  moves: NEW_GAME,
  settings: { mode: "pvp", difficulty: "easy", first: "human" },
  revision: 0,
  counted: false,
  score: ZERO_SCORE,
  linkError: null,
};
export type MatchAction =
  | { type: "human"; cell: number }
  | { type: "computer"; cell: number; moves: Moves; revision: number }
  | { type: "jump"; step: number }
  | { type: "settings"; settings: Partial<Settings> }
  | { type: "reset" }
  | { type: "reset-score" }
  | { type: "saved-score"; score: Score };

export function computerPlayer(settings: Settings): Player {
  return settings.first === "computer" ? "X" : "O";
}
export function isComputerTurn(match: Match): boolean {
  const outcome = outcomeOf(boardOf(match.moves));
  return match.settings.mode === "cpu" && outcome.status === "playing" && outcome.next === computerPlayer(match.settings);
}

/**
 * The match a page opens on with the game its link holds: two players, every move in the history, the last one
 * shown. A game that already ended was counted wherever it was played, so it counts nothing here; one still on
 * counts when it ends on this page. A link that holds no game opens the empty board, with the reason.
 */
export function matchOfLink(link: LinkGame, match: Match = INITIAL_MATCH): Match {
  const settings: Settings = { ...match.settings, mode: "pvp" };
  if (!link.ok) return { ...match, history: NEW_GAME, moves: NEW_GAME, settings, counted: false, linkError: link.reason };
  const ended = outcomeOf(boardOf(link.moves)).status !== "playing";
  return { ...match, history: link.moves, moves: link.moves, settings, counted: ended, linkError: null };
}

/**
 * All input and resets are atomic; a delayed move only applies to the position that scheduled it. The score
 * lives here too, so a game is counted in the same step as the move that ends it, and only the first time.
 */
export function matchReducer(match: Match, action: MatchAction): Match {
  switch (action.type) {
    case "reset":
    case "settings":
      // A new game, which can count once more; the score stays.
      return {
        ...match,
        history: NEW_GAME,
        moves: NEW_GAME,
        settings: action.type === "settings" ? { ...match.settings, ...action.settings } : match.settings,
        revision: match.revision + 1,
        counted: false,
        linkError: null,
      };
    case "jump": {
      const { step } = action;
      if (!Number.isInteger(step) || step < 0 || step > match.history.length || step === match.moves.length) return match;
      return { ...match, moves: step === match.history.length ? match.history : match.history.slice(0, step) };
    }
    case "human":
      return isComputerTurn(match) ? match : move(match, action.cell);
    case "computer":
      if (!isComputerTurn(match) || action.revision !== match.revision || action.moves !== match.moves) return match;
      return move(match, action.cell);
    case "reset-score":
      return sameScore(match.score, ZERO_SCORE) ? match : { ...match, score: ZERO_SCORE };
    case "saved-score":
      return sameScore(match.score, action.score) ? match : { ...match, score: action.score };
  }
}

/** The next player plays `cell` on the position shown: the later moves are dropped, and a first ending counts. */
function move(match: Match, cell: number): Match {
  const moves = play(match.moves, cell);
  if (moves === match.moves) return match;
  const ends = outcomeOf(boardOf(moves)).status !== "playing";
  return {
    ...match,
    history: moves,
    moves,
    counted: match.counted || ends,
    score: ends && !match.counted ? scoreAfter(match.score, moves) : match.score,
    linkError: null,
  };
}
