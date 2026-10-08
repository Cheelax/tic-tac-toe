import { CELL_COUNT, position, SIZE } from "./game.ts";

/** Arrow destinations stop at each row/column edge instead of wrapping. */
export function arrowDestination(cell: number, key: string): number | null {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) return null;
  const { row, column } = position(cell);
  switch (key) {
    case "ArrowLeft": return column > 0 ? cell - 1 : cell;
    case "ArrowRight": return column < SIZE - 1 ? cell + 1 : cell;
    case "ArrowUp": return row > 0 ? cell - SIZE : cell;
    case "ArrowDown": return row < SIZE - 1 ? cell + SIZE : cell;
    default: return null;
  }
}
