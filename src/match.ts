import { boardOf, NEW_GAME, outcomeOf, play, type Moves, type Player } from "./game.ts";
import type { Difficulty } from "./computer.ts";
import { EMPTY_SCORES, type Scores } from "./scoreStorage.ts";

export interface Settings {
  mode: "pvp" | "cpu";
  difficulty: Difficulty;
  first: "human" | "computer";
}
export interface Match {
  moves: Moves;
  /** Full timeline; moves is its currently displayed prefix. */
  history: Moves;
  scores: Scores;
  counted: boolean;
  settings: Settings;
  /** A reset changes the revision even if the board was already empty. */
  revision: number;
}
export const INITIAL_MATCH: Match = {
  moves: NEW_GAME,
  history: NEW_GAME,
  scores: EMPTY_SCORES,
  counted: false,
  settings: { mode: "pvp", difficulty: "easy", first: "human" },
  revision: 0,
};
export type MatchAction =
  | { type: "human"; cell: number }
  | { type: "computer"; cell: number; moves: Moves; revision: number }
  | { type: "settings"; settings: Partial<Settings> }
  | { type: "reset" }
  | { type: "jump"; step: number }
  | { type: "reset-score" };

export function computerPlayer(settings: Settings): Player {
  return settings.first === "computer" ? "X" : "O";
}
export function isComputerTurn(match: Match): boolean {
  const outcome = outcomeOf(boardOf(match.moves));
  return match.settings.mode === "cpu" && outcome.status === "playing" && outcome.next === computerPlayer(match.settings);
}

/** All input and resets are atomic; a delayed move only applies to the position that scheduled it. */
export function matchReducer(match: Match, action: MatchAction): Match {
  if (action.type === "reset-score") return { ...match, scores: { ...EMPTY_SCORES } };
  if (action.type === "jump") {
    if (!Number.isInteger(action.step) || action.step < 0 || action.step > match.history.length) return match;
    if (action.step === match.moves.length) return match;
    return { ...match, moves: match.history.slice(0, action.step), revision: match.revision + 1 };
  }
  if (action.type === "reset" || action.type === "settings") {
    return {
      ...match,
      moves: NEW_GAME,
      history: NEW_GAME,
      counted: false,
      settings: action.type === "settings" ? { ...match.settings, ...action.settings } : match.settings,
      revision: match.revision + 1,
    };
  }
  if (action.type === "human" && isComputerTurn(match)) return match;
  if (action.type === "computer" &&
      (!isComputerTurn(match) || action.revision !== match.revision || action.moves !== match.moves)) return match;
  const moves = play(match.moves, action.cell);
  if (moves === match.moves) return match;
  const outcome = outcomeOf(boardOf(moves));
  // History navigation never counts. Only the first terminal transition of this game does.
  const newlyCounted = !match.counted && outcome.status !== "playing";
  const key = outcome.status === "won" ? (outcome.winner === "X" ? "x" : "o") : "draw";
  const scores = newlyCounted ? { ...match.scores, [key]: match.scores[key] + 1 } : match.scores;
  return { ...match, moves, history: moves, scores, counted: match.counted || newlyCounted };
}
