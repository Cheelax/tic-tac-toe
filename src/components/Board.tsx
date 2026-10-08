import { useRef, useState, type KeyboardEvent } from "react";
import { neighbour, position, type Board as BoardCells, type Direction, type Mark, type Outcome } from "../game";

interface BoardProps {
  board: BoardCells;
  outcome: Outcome;
  onPlay: (cell: number) => void;
  locked?: boolean;
  lastComputerCell?: number;
}

const ARROWS: Partial<Record<string, Direction>> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/**
 * The 3×3 grid of cells. It shows the game and reports clicks; the rules decide what a click does.
 * One Tab stop for the whole board (the last cell focused); the arrow keys move between the cells by row and column
 * and stop at the edges. Enter and Space are the buttons' own: they play the focused cell as a click would.
 */
export function Board({ board, outcome, onPlay, locked = false, lastComputerCell }: BoardProps) {
  const over = outcome.status !== "playing";
  const winningCells = outcome.status === "won" ? outcome.winningCells : undefined;
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const [tabStop, setTabStop] = useState(4);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const direction = ARROWS[event.key];
    const from = cells.current.findIndex((cell) => cell === event.target);
    if (direction === undefined || from < 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault(); // no page scroll
    const to = neighbour(from, direction);
    cells.current[to]?.focus();
    setTabStop(to);
  }
  return (
    <div
      className="board"
      data-testid="board"
      role="group"
      aria-label="Board"
      aria-describedby="board-keys"
      data-next={outcome.status === "playing" ? outcome.next : undefined}
      onKeyDown={onKeyDown}
    >
      {board.map((mark, cell) => (
        <Cell
          key={cell}
          ref={(button) => { cells.current[cell] = button; }}
          cell={cell}
          mark={mark}
          playable={!over && !locked && mark === null}
          winning={winningCells?.has(cell) ?? false}
          lastComputer={cell === lastComputerCell}
          tabStop={cell === tabStop}
          onFocus={setTabStop}
          onPlay={onPlay}
        />
      ))}
    </div>
  );
}

interface CellProps {
  ref: (button: HTMLButtonElement | null) => void;
  cell: number;
  mark: Mark;
  playable: boolean;
  winning: boolean;
  lastComputer: boolean;
  tabStop: boolean;
  onFocus: (cell: number) => void;
  onPlay: (cell: number) => void;
}

function Cell({ ref, cell, mark, playable, winning, lastComputer, tabStop, onFocus, onPlay }: CellProps) {
  const { row, column } = position(cell);
  const label = `Row ${row + 1}, column ${column + 1}, ${mark ?? "empty"}${winning ? ", winning line" : ""}`;
  return (
    // A cell that cannot be played stays focusable (aria-disabled, not disabled), so the keyboard and screen
    // readers can still reach and read every cell; a click on it changes nothing.
    <button
      ref={ref}
      type="button"
      className="cell"
      data-testid={`cell-${cell}`}
      data-mark={mark ?? undefined}
      data-win={winning ? "true" : undefined}
      data-last-computer={lastComputer ? "true" : undefined}
      aria-label={label}
      aria-disabled={!playable}
      tabIndex={tabStop ? 0 : -1}
      onFocus={() => onFocus(cell)}
      onClick={() => onPlay(cell)}
    >
      {mark}
    </button>
  );
}
