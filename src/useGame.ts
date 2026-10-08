import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { boardOf, outcomeOf } from "./game";
import { easyMove, hardMove } from "./computer";
import { readScores, writeScores } from "./scoreStorage";
import { INITIAL_MATCH, isComputerTurn, matchReducer, type Settings } from "./match";

export const COMPUTER_PAUSE_MS = 250;

/** React owns scheduling; the computer policy and match transitions have no UI dependency. */
export function useGame() {
  const [match, dispatch] = useReducer(matchReducer, undefined, () => ({ ...INITIAL_MATCH, scores: readScores() }));
  const [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => { setStorageAvailable(writeScores(match.scores)); }, [match.scores]);
  const board = useMemo(() => boardOf(match.moves), [match.moves]);
  const outcome = useMemo(() => outcomeOf(board), [board]);
  const thinking = isComputerTurn(match);
  useEffect(() => {
    if (!thinking) return;
    const timer = window.setTimeout(() => {
      const cell = match.settings.difficulty === "hard"
        ? hardMove(match.moves) : easyMove(match.moves, Math.random());
      if (cell !== null) dispatch({ type: "computer", cell, moves: match.moves, revision: match.revision });
    }, COMPUTER_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [match, thinking]);
  const playCell = useCallback((cell: number) => dispatch({ type: "human", cell }), []);
  const newGame = useCallback(() => dispatch({ type: "reset" }), []);
  const changeSettings = useCallback((settings: Partial<Settings>) => dispatch({ type: "settings", settings }), []);
  const jumpTo = useCallback((step: number) => dispatch({ type: "jump", step }), []);
  const resetScore = useCallback(() => dispatch({ type: "reset-score" }), []);
  return { history: match.history, scores: match.scores, counted: match.counted, storageAvailable, jumpTo, resetScore, moves: match.moves, settings: match.settings, board, outcome, thinking, playCell, newGame, changeSettings };
}
