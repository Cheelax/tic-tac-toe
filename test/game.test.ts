// Unit tests of the rules, with Node's own test runner (no dependency): npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { boardOf, canPlay, LINES, NEW_GAME, outcomeOf, play, statusText, type Moves } from "../src/game.ts";

const playAll = (cells: number[]): Moves => cells.reduce<Moves>((moves, cell) => play(moves, cell), NEW_GAME);
const status = (moves: Moves) => statusText(outcomeOf(boardOf(moves)));

test("X starts, then the players take turns", () => {
  assert.equal(status(NEW_GAME), "X to play");
  assert.equal(status(playAll([4])), "O to play");
  assert.equal(status(playAll([4, 0])), "X to play");
  assert.deepEqual(boardOf(playAll([4, 0])), [..."O...X...."].map((c) => (c === "." ? null : c)));
});

test("each of the 8 lines wins, for X and for O", () => {
  for (const line of LINES) {
    const off = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !line.includes(c));
    const xGame = playAll([line[0], off[0], line[1], off[1], line[2]]);
    const outcome = outcomeOf(boardOf(xGame));
    assert.equal(statusText(outcome), "X wins", `line ${line}`);
    assert.deepEqual(outcome.status === "won" && [...outcome.winningCells].sort(), [...line].sort());
  }
  assert.equal(status(playAll([0, 3, 1, 4, 8, 5])), "O wins");
});

test("a move completing two lines marks both", () => {
  const outcome = outcomeOf(boardOf(playAll([1, 4, 2, 5, 3, 7, 6, 8, 0])));
  assert.equal(outcome.status, "won");
  assert.deepEqual(outcome.status === "won" && [...outcome.winningCells].sort(), [0, 1, 2, 3, 6]);
});

test("a full board with no line is a draw; a line on the ninth move is a win", () => {
  assert.equal(status(playAll([0, 1, 2, 4, 3, 5, 7, 6, 8])), "Draw");
  assert.equal(status(playAll([0, 1, 2, 4, 3, 5, 7, 8, 6])), "X wins");
});

test("an illegal move returns the same moves", () => {
  const moves = playAll([4]);
  assert.equal(play(moves, 4), moves, "an occupied cell");
  assert.equal(play(moves, 9), moves, "off the board");
  assert.equal(play(moves, -1), moves, "off the board");
  assert.equal(play(moves, 1.5), moves, "not a cell");
  const won = playAll([0, 3, 1, 4, 2]);
  assert.equal(canPlay(won, 8), false, "the game is over");
  assert.equal(play(won, 8), won);
});
