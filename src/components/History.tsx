import { playerOfMove, position, type Moves } from "../game";

const COLUMNS = "ABC";
/** A cell as a column letter and a row number: A1 top left, C3 bottom right. */
const coordinate = (cell: number) => {
  const { row, column } = position(cell);
  return { name: `${COLUMNS[column]}${row + 1}`, spoken: `row ${row + 1}, column ${column + 1}` };
};

interface Props {
  history: Moves;
  /** The position shown: the number of moves played on it. */
  shown: number;
  onJump: (step: number) => void;
}

/** Every position of the current game, the empty board first; the one shown is the current step. */
export function History({ history, shown, onJump }: Props) {
  const later = history.length - shown;
  return (
    <nav className="history" aria-labelledby="history-title">
      <h2 id="history-title" className="history-title">Moves</h2>
      <ol>
        <li>
          <button type="button" data-testid="history-0" aria-current={shown === 0 ? "step" : undefined}
            aria-label="Start: the empty board" onClick={() => onJump(0)}>Start</button>
        </li>
        {history.map((cell, index) => {
          const step = index + 1;
          const player = playerOfMove(index);
          const { name, spoken } = coordinate(cell);
          return (
            <li key={step}>
              <button type="button" data-testid={`history-${step}`} data-player={player}
                data-later={step > shown ? "true" : undefined} aria-current={shown === step ? "step" : undefined}
                aria-label={`Move ${step}: ${player} on ${spoken}`} onClick={() => onJump(step)}>
                <span className="history-step" aria-hidden="true">{step}</span>{player}<span aria-hidden="true">{name}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="history-note" aria-live="polite">
        {later > 0 ? `Viewing move ${shown} of ${history.length}. Playing here replaces the ${later === 1 ? "last move" : `last ${later} moves`}.` : ""}
      </p>
    </nav>
  );
}
