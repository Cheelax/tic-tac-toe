import { position, type Moves, type Outcome } from "../game";
import { computerPlayer, type Settings } from "../match";

export function TurnNote({ moves, outcome, thinking, settings }: {
  moves: Moves; outcome: Outcome; thinking: boolean; settings: Settings;
}) {
  let note = "Take turns. Three in a row wins.";
  if (settings.mode === "cpu") {
    if (thinking) note = "Computer is thinking…";
    else if (outcome.status === "won") note = outcome.winner === computerPlayer(settings) ? "Computer wins. Ready for a rematch?" : "You win! Ready for a rematch?";
    else if (outcome.status === "draw") note = "A draw. Ready for another game?";
    else if (moves.length) {
      const { row, column } = position(moves[moves.length - 1]);
      note = `Your turn. Computer played row ${row + 1}, column ${column + 1}.`;
    } else note = "Your turn. Choose an empty square.";
  }
  return <p className="turn-note" aria-live="polite" aria-atomic="true">{note}</p>;
}
