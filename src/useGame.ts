import { useCallback, useMemo, useState } from "react";
import { boardOf, NEW_GAME, outcomeOf, play, type Board, type Moves, type Outcome } from "./game";

export interface GameState {
  moves: Moves;
  board: Board;
  outcome: Outcome;
  /** Plays `cell` for the player whose turn it is; an illegal move changes nothing. */
  playCell: (cell: number) => void;
  /** Starts over: an empty board, X to play. */
  newGame: () => void;
}

/** The game's state for React: the moves played, and what follows from them (see game.ts). */
export function useGame(): GameState {
  const [moves, setMoves] = useState<Moves>(NEW_GAME);
  const board = useMemo(() => boardOf(moves), [moves]);
  const outcome = useMemo(() => outcomeOf(board), [board]);
  // Updates read the latest moves, never the ones of the last render: two clicks before React re-renders
  // (a fast double click) are judged one after the other, and an illegal one returns the same moves (no render).
  const playCell = useCallback((cell: number) => setMoves((current) => play(current, cell)), []);
  const newGame = useCallback(() => setMoves(NEW_GAME), []);
  return { moves, board, outcome, playCell, newGame };
}
