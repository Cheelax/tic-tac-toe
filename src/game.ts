// The rules of tic-tac-toe, with no UI: pure functions, no React, no DOM.
//
// A game is the list of cells played so far, in order, X first (`[4, 0, 8]`: X in the centre, O in the top left
// corner, X in the bottom right one). The board, whose turn it is and the outcome all follow from that list, so
// later features (a move history, a shareable link, a computer player) read and extend the same value.
//
// Cells are numbered row by row from the top left:
//   0 1 2
//   3 4 5
//   6 7 8

export type Player = "X" | "O";
/** What a cell holds. */
export type Mark = Player | null;
/** The 9 cells, row by row from the top left. */
export type Board = readonly Mark[];
/** The cells played so far, in order, X first. */
export type Moves = readonly number[];

export type Outcome =
  | { readonly status: "playing"; readonly next: Player }
  | { readonly status: "won"; readonly winner: Player; readonly winningCells: ReadonlySet<number> }
  | { readonly status: "draw" };

export const SIZE = 3;
export const CELL_COUNT = SIZE * SIZE;

/** Every line: the 3 rows, the 3 columns, then the 2 diagonals. */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** The empty game. */
export const NEW_GAME: Moves = [];

/** Who plays the move with this index (0 is the first move): X always starts. */
export const playerOfMove = (index: number): Player => (index % 2 === 0 ? "X" : "O");

/** The row and column of a cell, from 0. */
export const position = (cell: number): { row: number; column: number } => ({
  row: Math.floor(cell / SIZE),
  column: cell % SIZE,
});

/** The board after `moves`. */
export function boardOf(moves: Moves): Board {
  const board: Mark[] = Array<Mark>(CELL_COUNT).fill(null);
  moves.forEach((cell, index) => {
    board[cell] = playerOfMove(index);
  });
  return board;
}

/**
 * Where the game stands on `board`. A win takes every completed line (a move can complete two at once), and a
 * full board that completes a line is a win, not a draw.
 */
export function outcomeOf(board: Board): Outcome {
  let winner: Player | null = null;
  const winningCells = new Set<number>();
  for (const line of LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark !== null && mark === board[b] && mark === board[c]) {
      winner = mark;
      for (const cell of line) winningCells.add(cell);
    }
  }
  if (winner !== null) return { status: "won", winner, winningCells };
  const played = board.filter((mark) => mark !== null).length;
  if (played === CELL_COUNT) return { status: "draw" };
  return { status: "playing", next: playerOfMove(played) };
}

/** Whether the next player may play `cell` now: a cell of the board, still empty, in a game still on. */
export function canPlay(moves: Moves, cell: number): boolean {
  return (
    Number.isInteger(cell) &&
    cell >= 0 &&
    cell < CELL_COUNT &&
    !moves.includes(cell) &&
    outcomeOf(boardOf(moves)).status === "playing"
  );
}

/** The game after the next player plays `cell`; an illegal move returns `moves` itself, unchanged. */
export function play(moves: Moves, cell: number): Moves {
  return canPlay(moves, cell) ? [...moves, cell] : moves;
}

/** The status line: `X to play`, `O to play`, `X wins`, `O wins` or `Draw`. */
export function statusText(outcome: Outcome): string {
  switch (outcome.status) {
    case "playing":
      return `${outcome.next} to play`;
    case "won":
      return `${outcome.winner} wins`;
    case "draw":
      return "Draw";
  }
}
