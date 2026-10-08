import { useRef } from "react";
import { arrowDestination } from "../keyboard";
import { position, type Board as BoardCells, type Mark, type Outcome } from "../game";

interface BoardProps {
  board: BoardCells;
  outcome: Outcome;
  onPlay: (cell: number) => void;
  locked?: boolean;
  lastComputerCell?: number;
}

/** The 3×3 grid of cells. It shows the game and reports clicks; the rules decide what a click does. */
export function Board({ board, outcome, onPlay, locked = false, lastComputerCell }: BoardProps) {
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const over = outcome.status !== "playing";
  const winningCells = outcome.status === "won" ? outcome.winningCells : undefined;
  return (
    <div
      className="board"
      data-testid="board"
      role="group"
      aria-label="Board"
      onKeyDown={(event) => {
        if (!(event.target instanceof HTMLButtonElement)) return;
        const cell = Number(event.target.dataset.cell);
        const next = arrowDestination(cell, event.key);
        if (next !== null) { event.preventDefault(); cells.current[next]?.focus(); }
      }}
      data-next={outcome.status === "playing" ? outcome.next : undefined}
    >
      {board.map((mark, cell) => (
        <Cell
          key={cell}
          cell={cell}
          buttonRef={(element) => { cells.current[cell] = element; }}
          mark={mark}
          playable={!over && !locked && mark === null}
          winning={winningCells?.has(cell) ?? false}
          lastComputer={cell === lastComputerCell}
          onPlay={onPlay}
        />
      ))}
    </div>
  );
}

interface CellProps {
  cell: number;
  buttonRef: (element: HTMLButtonElement | null) => void;
  mark: Mark;
  playable: boolean;
  winning: boolean;
  lastComputer: boolean;
  onPlay: (cell: number) => void;
}

function Cell({ cell, buttonRef, mark, playable, winning, lastComputer, onPlay }: CellProps) {
  const { row, column } = position(cell);
  const label = `Row ${row + 1}, column ${column + 1}, ${mark ?? "empty"}${winning ? ", winning line" : ""}`;
  return (
    // A cell that cannot be played stays focusable (aria-disabled, not disabled), so the keyboard and screen
    // readers can still reach and read every cell; a click on it changes nothing.
    <button
      ref={buttonRef}
      type="button"
      data-cell={cell}
      className="cell"
      data-testid={`cell-${cell}`}
      data-mark={mark ?? undefined}
      data-win={winning ? "true" : undefined}
      data-last-computer={lastComputer ? "true" : undefined}
      aria-label={label}
      aria-disabled={!playable}
      onClick={() => onPlay(cell)}
    >
      {mark}
    </button>
  );
}
