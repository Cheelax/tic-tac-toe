/** Immutable rules; no UI, effects, timers, or persistence. */
export type Player = "X" | "O";
export type Cell = Player | null;
export type Board = readonly Cell[];
export type Position =
  | { kind: "playing"; next: Player; winningCells: readonly number[] }
  | { kind: "won"; winner: Player; winningCells: readonly number[] }
  | { kind: "draw"; winningCells: readonly number[] };

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

export function newBoard(): Board {
  return Array<Cell>(9).fill(null);
}

/** Evaluate every completed line before considering a full board a draw. */
export function position(board: Board): Position {
  const lines = LINES.filter(([a, b, c]) =>
    board[a] !== null && board[a] === board[b] && board[a] === board[c]);
  if (lines.length) {
    return {
      kind: "won",
      winner: board[lines[0][0]] as Player,
      winningCells: [...new Set(lines.flat())],
    };
  }
  const moves = board.filter((cell) => cell !== null).length;
  return moves === 9
    ? { kind: "draw", winningCells: [] }
    : { kind: "playing", next: moves % 2 === 0 ? "X" : "O", winningCells: [] };
}

/** Illegal moves preserve the exact same board, including after the game ends. */
export function play(board: Board, cell: number): Board {
  if (!Number.isInteger(cell) || cell < 0 || cell >= 9 || board[cell] !== null) return board;
  const current = position(board);
  if (current.kind !== "playing") return board;
  return board.map((mark, index) => index === cell ? current.next : mark);
}

export function statusText(current: Position): string {
  if (current.kind === "won") return `${current.winner} wins`;
  if (current.kind === "draw") return "Draw";
  return `${current.next} to play`;
}
