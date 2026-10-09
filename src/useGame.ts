import { useCallback, useEffect, useMemo, useReducer } from "react";
import { boardOf, outcomeOf } from "./game";
import { easyMove, hardMove } from "./computer";
import { isComputerTurn, matchFromLink, matchReducer, type Match, type Settings } from "./match";
import { loadScore, onSavedScoreChange, saveScore } from "./storage";
import { readGameLink, writeGameLink } from "./links";

export const COMPUTER_PAUSE_MS = 250;

const startMatch = (): Match => matchFromLink(readGameLink(window.location.href), loadScore());

/** React owns scheduling and storage; the computer policy and match transitions have no UI dependency. */
export function useGame() {
  const [match, dispatch] = useReducer(matchReducer, undefined, startMatch);
  const board = useMemo(() => boardOf(match.moves), [match.moves]);
  const outcome = useMemo(() => outcomeOf(board), [board]);
  const thinking = isComputerTurn(match);
  const shareUrl = useMemo(() => writeGameLink(window.location.href, match.moves), [match.moves]);
  useEffect(() => {
    if (!thinking) return;
    const timer = window.setTimeout(() => {
      const cell = match.settings.difficulty === "hard"
        ? hardMove(match.moves) : easyMove(match.moves, Math.random());
      if (cell !== null) dispatch({ type: "computer", cell, moves: match.moves, revision: match.revision });
    }, COMPUTER_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [match, thinking]);
  useEffect(() => saveScore(match.score), [match.score]);
  // Another tab's games count here too, instead of being overwritten by this tab's next save.
  useEffect(() => onSavedScoreChange((score) => dispatch({ type: "saved-score", score })), []);
  const playCell = useCallback((cell: number) => dispatch({ type: "human", cell }), []);
  const newGame = useCallback(() => dispatch({ type: "reset" }), []);
  const changeSettings = useCallback((settings: Partial<Settings>) => dispatch({ type: "settings", settings }), []);
  const jump = useCallback((step: number) => dispatch({ type: "jump", step }), []);
  const resetScore = useCallback(() => dispatch({ type: "reset-score" }), []);
  return {
    moves: match.moves, history: match.history, settings: match.settings, score: match.score, board, outcome, thinking,
    playCell, newGame, changeSettings, jump, resetScore,
    linkError: match.linkError, shareUrl,
  };
}
