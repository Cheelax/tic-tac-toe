import { boardOf, NEW_GAME, outcomeOf, play, type Moves, type Player } from "./game.ts";
import type { Difficulty } from "./computer.ts";

export interface Settings {
  mode: "pvp" | "cpu";
  difficulty: Difficulty;
  first: "human" | "computer";
}
export interface Match {
  moves: Moves;
  settings: Settings;
  /** A reset changes the revision even if the board was already empty. */
  revision: number;
}
export const INITIAL_MATCH: Match = {
  moves: NEW_GAME,
  settings: { mode: "pvp", difficulty: "easy", first: "human" },
  revision: 0,
};
export type MatchAction =
  | { type: "human"; cell: number }
  | { type: "computer"; cell: number; moves: Moves; revision: number }
  | { type: "settings"; settings: Partial<Settings> }
  | { type: "reset" };

export function computerPlayer(settings: Settings): Player {
  return settings.first === "computer" ? "X" : "O";
}
export function isComputerTurn(match: Match): boolean {
  const outcome = outcomeOf(boardOf(match.moves));
  return match.settings.mode === "cpu" && outcome.status === "playing" && outcome.next === computerPlayer(match.settings);
}

/** All input and resets are atomic; a delayed move only applies to the position that scheduled it. */
export function matchReducer(match: Match, action: MatchAction): Match {
  if (action.type === "reset" || action.type === "settings") {
    return {
      moves: NEW_GAME,
      settings: action.type === "settings" ? { ...match.settings, ...action.settings } : match.settings,
      revision: match.revision + 1,
    };
  }
  if (action.type === "human" && isComputerTurn(match)) return match;
  if (action.type === "computer" &&
      (!isComputerTurn(match) || action.revision !== match.revision || action.moves !== match.moves)) return match;
  const moves = play(match.moves, action.cell);
  return moves === match.moves ? match : { ...match, moves };
}
