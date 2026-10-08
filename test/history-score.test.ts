import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL_MATCH, isComputerTurn, matchReducer, type Match } from "../src/match.ts";
import { boardOf, outcomeOf } from "../src/game.ts";

const moves = (state: Match, cells: number[]) => cells.reduce((s, cell) => matchReducer(s, { type: "human", cell }), state);
const xWin = [0, 3, 1, 4, 2];
const oWin = [0, 3, 1, 4, 8, 5];
const draw = [0, 1, 2, 4, 3, 5, 7, 6, 8];

test("only the first finish of a game counts, even if a replay changes the winner", () => {
  const won = moves(INITIAL_MATCH, xWin);
  assert.deepEqual(won.scores, { x: 1, o: 0, draw: 0 });
  assert.equal(matchReducer(won, { type: "human", cell: 8 }), won);
  const before = matchReducer(won, { type: "jump", step: 4 });
  assert.equal(outcomeOf(boardOf(before.moves)).status, "playing");
  assert.deepEqual(before.history, xWin);
  const replayed = moves(before, [8, 5]);
  assert.deepEqual(replayed.moves, oWin);
  assert.deepEqual(replayed.history, oWin);
  assert.deepEqual(replayed.scores, won.scores);
  const cleared = matchReducer(replayed, { type: "reset-score" });
  assert.deepEqual(cleared.scores, { x: 0, o: 0, draw: 0 });
  const replayedAgain = moves(matchReducer(cleared, { type: "jump", step: 4 }), [2]);
  assert.deepEqual(replayedAgain.scores, cleared.scores);
});

test("new games count again, including O wins and draws; abandoning a game counts nothing", () => {
  let state = moves(INITIAL_MATCH, xWin);
  state = moves(matchReducer(state, { type: "reset" }), oWin);
  state = moves(matchReducer(state, { type: "reset" }), draw);
  assert.deepEqual(state.scores, { x: 1, o: 1, draw: 1 });
  state = moves(matchReducer(state, { type: "reset" }), [4, 0]);
  const changed = matchReducer(state, { type: "settings", settings: { difficulty: "hard" } });
  assert.deepEqual(changed.scores, state.scores);
  assert.deepEqual(changed.history, []);
  assert.equal(changed.counted, false);
  assert.deepEqual(moves(changed, xWin).scores, { x: 2, o: 1, draw: 1 });
});

test("navigation keeps future positions; only a legal move truncates the timeline", () => {
  const state = moves(INITIAL_MATCH, [4, 0, 8]);
  const past = matchReducer(state, { type: "jump", step: 1 });
  assert.deepEqual(past.moves, [4]);
  assert.deepEqual(past.history, [4, 0, 8]);
  assert.equal(matchReducer(past, { type: "human", cell: 4 }), past);
  for (const step of [-1, 4, 1.5, NaN]) assert.equal(matchReducer(past, { type: "jump", step }), past);
  const back = matchReducer(past, { type: "jump", step: 3 });
  assert.deepEqual(back.moves, state.moves);
  const branch = moves(past, [2]);
  assert.deepEqual(branch.history, [4, 2]);
  assert.equal(matchReducer(branch, { type: "jump", step: 3 }), branch);
});

test("an unfinished rewound game counts when its new branch first ends", () => {
  const partial = moves(INITIAL_MATCH, [4, 0]);
  const past = matchReducer(partial, { type: "jump", step: 1 });
  const finished = moves(past, [0, 8, 2, 1, 6, 3, 5, 7]);
  assert.equal(finished.history.length, 9);
  assert.deepEqual(finished.scores, { x: 1, o: 0, draw: 0 });
});

test("history jumps cancel stale computer replies, including after a score reset", () => {
  let state = matchReducer(INITIAL_MATCH, { type: "settings", settings: { mode: "cpu" } });
  state = matchReducer(state, { type: "human", cell: 4 });
  const stale = { type: "computer" as const, cell: 0, moves: state.moves, revision: state.revision };
  const past = matchReducer(state, { type: "jump", step: 0 });
  assert.equal(isComputerTurn(past), false);
  assert.equal(matchReducer(past, stale), past);
  state = matchReducer(state, stale);
  const cpuTurn = matchReducer(state, { type: "jump", step: 1 });
  assert.equal(isComputerTurn(cpuTurn), true);
  const cleared = matchReducer(cpuTurn, { type: "reset-score" });
  const response = { type: "computer" as const, cell: 2, moves: cpuTurn.moves, revision: cpuTurn.revision };
  const next = matchReducer(cleared, response);
  assert.deepEqual(next.history, [4, 2]);
  assert.deepEqual(next.scores, { x: 0, o: 0, draw: 0 });
});
