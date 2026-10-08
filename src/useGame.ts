import { useCallback, useEffect, useMemo, useState } from "react";
import { computerMove, DEFAULT_SETTINGS, isComputerTurn, type Settings } from "./computer";
import { boardOf, NEW_GAME, outcomeOf, play, type Board, type Moves, type Outcome } from "./game";

/** The computer's pause before it moves: long enough to follow, well under the second the rules allow. */
export const THINK_MS = 450;

export interface GameState {
  moves: Moves;
  board: Board;
  outcome: Outcome;
  settings: Settings;
  /** Whether the computer is about to move: clicks on the board change nothing meanwhile. */
  computerTurn: boolean;
  /** Plays `cell` for the player whose turn it is; an illegal move, or a click on the computer's turn, changes nothing. */
  playCell: (cell: number) => void;
  /** Starts over: an empty board, X to play (the computer, when it goes first). */
  newGame: () => void;
  /** Changes who plays, which starts a new game. */
  changeSettings: (change: Partial<Settings>) => void;
}

/** The game's state for React: the moves played, who plays, and what follows from them (see game.ts, computer.ts). */
export function useGame(): GameState {
  const [moves, setMoves] = useState<Moves>(NEW_GAME);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const board = useMemo(() => boardOf(moves), [moves]);
  const outcome = useMemo(() => outcomeOf(board), [board]);
  const computerTurn = isComputerTurn(moves, settings);

  // Updates read the latest moves, never the ones of the last render: two clicks before React re-renders
  // (a fast double click) are judged one after the other, and an illegal one returns the same moves (no render).
  const playCell = useCallback(
    (cell: number) => setMoves((current) => (isComputerTurn(current, settings) ? current : play(current, cell))),
    [settings],
  );
  const newGame = useCallback(() => setMoves(NEW_GAME), []);
  const changeSettings = useCallback((change: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...change }));
    setMoves(NEW_GAME);
  }, []);

  // The computer moves after a short pause, from the moves of that moment. A new game or a change of settings
  // meanwhile cancels the pending move (the effect's cleanup), and the turn is checked again when it lands.
  useEffect(() => {
    if (!computerTurn) return;
    const timer = setTimeout(() => {
      setMoves((current) => {
        if (!isComputerTurn(current, settings)) return current;
        const cell = computerMove(current, settings.difficulty);
        return cell === undefined ? current : play(current, cell);
      });
    }, THINK_MS);
    return () => clearTimeout(timer);
  }, [computerTurn, moves, settings]);

  return { moves, board, outcome, settings, computerTurn, playCell, newGame, changeSettings };
}
