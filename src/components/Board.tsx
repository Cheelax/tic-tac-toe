import { position, type Board as BoardCells, type Mark, type Outcome } from "../game";

interface BoardProps {
  board: BoardCells;
  outcome: Outcome;
  onPlay: (cell: number) => void;
}

/** The 3×3 grid of cells. It shows the game and reports clicks; the rules decide what a click does. */
export function Board({ board, outcome, onPlay }: BoardProps) {
  const over = outcome.status !== "playing";
  const winningCells = outcome.status === "won" ? outcome.winningCells : undefined;
  return (
    <div
      className="board"
      data-testid="board"
      role="group"
      aria-label="Board"
      data-next={outcome.status === "playing" ? outcome.next : undefined}
    >
      {board.map((mark, cell) => (
        <Cell
          key={cell}
          cell={cell}
          mark={mark}
          playable={!over && mark === null}
          winning={winningCells?.has(cell) ?? false}
          onPlay={onPlay}
        />
      ))}
    </div>
  );
}

interface CellProps {
  cell: number;
  mark: Mark;
  playable: boolean;
  winning: boolean;
  onPlay: (cell: number) => void;
}

function Cell({ cell, mark, playable, winning, onPlay }: CellProps) {
  const { row, column } = position(cell);
  const label = `Row ${row + 1}, column ${column + 1}, ${mark ?? "empty"}${winning ? ", winning line" : ""}`;
  return (
    // A cell that cannot be played stays focusable (aria-disabled, not disabled), so the keyboard and screen
    // readers can still reach and read every cell; a click on it changes nothing.
    <button
      type="button"
      className="cell"
      data-testid={`cell-${cell}`}
      data-mark={mark ?? undefined}
      data-win={winning ? "true" : undefined}
      aria-label={label}
      aria-disabled={!playable}
      onClick={() => onPlay(cell)}
    >
      {mark}
    </button>
  );
}
