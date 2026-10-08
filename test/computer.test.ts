// Unit tests of the computer player, with Node's own test runner (no dependency): npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bestMove,
  bestMoves,
  computerMark,
  computerMove,
  DEFAULT_SETTINGS,
  isComputerTurn,
  legalMoves,
  randomMove,
  scoreMoves,
  valueOf,
  type Settings,
} from "../src/computer.ts";
import { boardOf, NEW_GAME, outcomeOf, play, playerOfMove, type Moves, type Player } from "../src/game.ts";

const playAll = (cells: number[]): Moves => cells.reduce<Moves>((moves, cell) => play(moves, cell), NEW_GAME);
const winnerOf = (moves: Moves): Player | null => {
  const outcome = outcomeOf(boardOf(moves));
  return outcome.status === "won" ? outcome.winner : null;
};
const over = (moves: Moves) => outcomeOf(boardOf(moves)).status !== "playing";
const other = (player: Player): Player => (player === "X" ? "O" : "X");
/** A fixed generator (mulberry32): the same draws on every run. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("the computer's mark follows the settings: none with two players, X when it goes first, O otherwise", () => {
  assert.equal(computerMark(DEFAULT_SETTINGS), null);
  assert.equal(computerMark({ ...DEFAULT_SETTINGS, first: "computer" }), null, "two players, whoever is first");
  assert.equal(computerMark({ mode: "cpu", difficulty: "easy", first: "human" }), "O");
  assert.equal(computerMark({ mode: "cpu", difficulty: "hard", first: "computer" }), "X");
});

test("it is the computer's turn when its mark plays next in a game still on", () => {
  const cpuSecond: Settings = { mode: "cpu", difficulty: "easy", first: "human" };
  const cpuFirst: Settings = { ...cpuSecond, first: "computer" };
  assert.equal(isComputerTurn(NEW_GAME, cpuSecond), false);
  assert.equal(isComputerTurn(NEW_GAME, cpuFirst), true);
  assert.equal(isComputerTurn(playAll([4]), cpuSecond), true);
  assert.equal(isComputerTurn(playAll([4]), cpuFirst), false);
  assert.equal(isComputerTurn(playAll([4]), DEFAULT_SETTINGS), false, "two players");
  assert.equal(isComputerTurn(playAll([0, 3, 1, 4, 2]), cpuSecond), false, "the game is over");
});

test("easy plays a legal move, varies, and has none once the game is over", () => {
  const random = seeded(1);
  const moves = playAll([4]);
  const answers = new Set<number>();
  for (let i = 0; i < 50; i++) {
    const cell = randomMove(moves, random);
    assert.ok(cell !== undefined && legalMoves(moves).includes(cell), `an illegal move: ${cell}`);
    answers.add(cell);
  }
  assert.ok(answers.size >= 4, `easy answered X in the centre with only ${[...answers].join(", ")}`);
  assert.deepEqual(legalMoves(NEW_GAME), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(randomMove(playAll([0, 3, 1, 4, 2]), random), undefined);
  assert.equal(computerMove(playAll([4]), "easy", () => 0), 0, "the first legal cell on a draw of 0");
});

test("hard values the game as a draw from the start and takes a win in one when it has it", () => {
  assert.equal(valueOf(NEW_GAME), 0);
  assert.equal(bestMoves(NEW_GAME).length, 9, "every opening draws");
  assert.deepEqual(bestMoves(playAll([0, 3, 1, 4])), [2], "X completes the top row");
  assert.deepEqual(bestMoves(playAll([0, 4, 8, 2])), [6], "X blocks O's diagonal, which also forks");
  assert.equal(bestMove(playAll([0, 3, 1, 4, 2]), seeded(2)), undefined, "the game is over");
  for (const { cell, value } of scoreMoves(playAll([0, 3, 1, 4]))) {
    assert.ok(cell === 2 ? value > 0 : value <= 0, `cell ${cell} is worth ${value}`);
  }
});

test("hard never loses, from either side, whichever of its best moves it takes and whatever the other plays", () => {
  let positions = 0;
  const safe = (moves: Moves, computer: Player): void => {
    positions++;
    if (over(moves)) {
      assert.notEqual(winnerOf(moves), other(computer), `hard lost after ${moves.join(", ")}`);
      return;
    }
    const cells = playerOfMove(moves.length) === computer ? bestMoves(moves) : legalMoves(moves);
    assert.ok(cells.length > 0, `no move after ${moves.join(", ")}`);
    for (const cell of cells) safe(play(moves, cell), computer);
  };
  safe(NEW_GAME, "X");
  safe(NEW_GAME, "O");
  assert.ok(positions > 1_000, `only ${positions} positions were searched`);
});

test("hard punishes a slip: whenever the other side can be beaten, it is", () => {
  // The whole game, the other side playing anything: once a position is won for hard, every move it may take keeps the win.
  const punishes = (moves: Moves, computer: Player): void => {
    if (over(moves)) return;
    if (playerOfMove(moves.length) === computer) {
      const cells = bestMoves(moves);
      if (valueOf(moves) > 0) {
        for (const cell of cells) assert.ok(-valueOf(play(moves, cell)) > 0, `hard let a win go after ${moves.join(", ")}`);
      }
      for (const cell of cells) punishes(play(moves, cell), computer);
    } else {
      for (const cell of legalMoves(moves)) punishes(play(moves, cell), computer);
    }
  };
  punishes(NEW_GAME, "X");
  punishes(NEW_GAME, "O");
  // A concrete one: X takes two opposite corners around O's centre; O's slip to a third corner loses by force
  // (X blocks the diagonal on 6, which threatens 3 and 7 at once).
  const slipped = playAll([0, 4, 8, 2]);
  assert.ok(valueOf(slipped) > 0, "X is winning");
  assert.deepEqual(bestMoves(slipped), [6], "the block that forks");
});

test("hard prefers the quickest win and the longest defence", () => {
  // X can win at once on 2, or play elsewhere and still win later: it takes the win now.
  assert.deepEqual(bestMoves(playAll([0, 3, 1, 4])), [2]);
  // O is lost after X on 0 and 4 (O on 1): X threatens 8 now, and forks after the block. O still blocks,
  // losing on the 7th move rather than the 5th.
  const lost = playAll([0, 1, 4]);
  assert.ok(valueOf(lost) < 0, "O is lost");
  assert.deepEqual(bestMoves(lost), [8], "O blocks the diagonal all the same");
});
