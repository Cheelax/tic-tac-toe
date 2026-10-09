import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL_MATCH, isComputerTurn, matchReducer, type Match, type MatchAction } from "../src/match.ts";

const apply = (match: Match, ...actions: MatchAction[]) => actions.reduce(matchReducer, match);
const humans = (...cells: number[]): MatchAction[] => cells.map((cell) => ({ type: "human", cell }));
const jump = (step: number): MatchAction => ({ type: "jump", step });
const X_WINS = humans(0, 3, 1, 4, 2);

test("a game counts once, when it ends: X, O and draws, and not on New game", () => {
  let m = apply(INITIAL_MATCH, ...humans(0, 3, 1, 4));
  assert.deepEqual(m.score, { x: 0, o: 0, draw: 0 });
  m = apply(m, ...humans(2), ...humans(5));
  assert.deepEqual(m.score, { x: 1, o: 0, draw: 0 }, "a click after the win counts nothing");
  m = apply(m, { type: "reset" }, ...humans(0, 3, 1, 4, 8, 5));
  m = apply(m, { type: "reset" }, ...humans(0, 1, 2, 4, 3, 5, 7, 6, 8));
  assert.deepEqual(m.score, { x: 1, o: 1, draw: 1 });
  m = apply(m, ...humans(4), { type: "reset" }, { type: "settings", settings: { difficulty: "hard" } });
  assert.deepEqual(m.score, { x: 1, o: 1, draw: 1 }, "abandoned games count nothing");
});

test("the history keeps every move; a jump shows a position and keeps the later moves", () => {
  let m = apply(INITIAL_MATCH, ...humans(4, 0, 8));
  assert.deepEqual(m.history, [4, 0, 8]);
  m = apply(m, jump(1));
  assert.deepEqual(m.moves, [4]);
  assert.deepEqual(m.history, [4, 0, 8]);
  assert.equal(apply(m, jump(1)), m, "a jump to the position shown changes nothing");
  assert.equal(apply(m, jump(4)), m, "no position past the last move");
  assert.equal(apply(m, jump(-1)), m);
  assert.equal(apply(m, jump(3)).moves, m.history, "back to the last position");
});

test("a move from a past position drops the later moves; a refused one drops nothing", () => {
  let m = apply(INITIAL_MATCH, ...humans(4, 0, 8), jump(1));
  assert.equal(apply(m, ...humans(4)), m, "an occupied cell");
  m = apply(m, ...humans(2));
  assert.deepEqual(m.history, [4, 2]);
  assert.deepEqual(m.moves, [4, 2]);
});

test("a game rewound and ended again counts nothing more; rewound before its end, it counts once", () => {
  let m = apply(INITIAL_MATCH, ...X_WINS);
  assert.deepEqual(m.score, { x: 1, o: 0, draw: 0 });
  m = apply(m, jump(4), ...humans(8, 5));
  assert.deepEqual(m.moves, [0, 3, 1, 4, 8, 5], "O won this time");
  assert.deepEqual(m.score, { x: 1, o: 0, draw: 0 }, "the same game, counted already");
  m = apply(m, jump(5), jump(6));
  assert.deepEqual(m.score, { x: 1, o: 0, draw: 0 }, "jumping counts nothing");
  m = apply(m, { type: "reset" }, ...humans(4, 0), jump(1), ...humans(0, 8, 2, 1, 6, 3, 5, 7));
  assert.deepEqual(m.score, { x: 2, o: 0, draw: 0 });
});

test("against the computer, a jump to its turn hands it the move, from that position only", () => {
  let m = apply(INITIAL_MATCH, { type: "settings", settings: { mode: "cpu" } }, ...humans(4));
  const firstReply = { type: "computer" as const, cell: 0, moves: m.moves, revision: m.revision };
  m = apply(m, firstReply, ...humans(8));
  m = apply(m, { type: "computer", cell: 2, moves: m.moves, revision: m.revision });
  assert.deepEqual(m.history, [4, 0, 8, 2]);
  m = apply(m, jump(1));
  assert.ok(isComputerTurn(m));
  assert.equal(apply(m, firstReply), m, "a reply scheduled before the jump is refused");
  assert.equal(apply(m, ...humans(1)), m, "the human cannot play the computer's turn");
  m = apply(m, { type: "computer", cell: 6, moves: m.moves, revision: m.revision });
  assert.deepEqual(m.history, [4, 6]);
  assert.equal(isComputerTurn(apply(m, jump(0))), false, "the human starts");
});

test("reset-score zeroes the score and leaves the game; a saved score from another tab replaces it", () => {
  const won = apply(INITIAL_MATCH, ...X_WINS);
  const reset = apply(won, { type: "reset-score" });
  assert.deepEqual(reset.score, { x: 0, o: 0, draw: 0 });
  assert.equal(reset.history, won.history);
  assert.equal(apply(reset, { type: "reset-score" }), reset);
  const synced = apply(reset, { type: "saved-score", score: { x: 3, o: 2, draw: 1 } });
  assert.deepEqual(synced.score, { x: 3, o: 2, draw: 1 });
  assert.equal(apply(synced, { type: "saved-score", score: { x: 3, o: 2, draw: 1 } }), synced);
});
