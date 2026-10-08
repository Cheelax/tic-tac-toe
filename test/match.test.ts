import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL_MATCH, isComputerTurn, matchReducer, type Match } from "../src/match.ts";

const cpuGame = (): Match => matchReducer(INITIAL_MATCH, { type: "settings", settings: { mode: "cpu" } });
const reply = (m: Match, cell: number) => ({ type: "computer" as const, cell, moves: m.moves, revision: m.revision });

test("rapid human clicks cannot place the computer's mark; a reply applies exactly once", () => {
  const first = matchReducer(cpuGame(), { type: "human", cell: 0 });
  assert.ok(isComputerTurn(first));
  assert.equal(matchReducer(first, { type: "human", cell: 1 }), first);
  const action = reply(first, 4);
  const second = matchReducer(first, action);
  assert.deepEqual(second.moves, [0, 4]);
  assert.equal(matchReducer(second, action), second);
});

test("resets and every setting change invalidate already queued replies", () => {
  const first = matchReducer(cpuGame(), { type: "human", cell: 0 });
  const queued = reply(first, 4);
  for (const action of [
    { type: "reset" as const },
    { type: "settings" as const, settings: { mode: "pvp" as const } },
    { type: "settings" as const, settings: { difficulty: "hard" as const } },
    { type: "settings" as const, settings: { first: "computer" as const } },
  ]) {
    const fresh = matchReducer(first, action);
    assert.deepEqual(fresh.moves, []);
    assert.equal(matchReducer(fresh, queued), fresh);
    assert.equal(fresh.revision, first.revision + 1);
  }
});

test("resetting an empty computer-first game invalidates its opening move", () => {
  const opening = matchReducer(cpuGame(), { type: "settings", settings: { first: "computer" } });
  assert.ok(isComputerTurn(opening));
  assert.equal(matchReducer(opening, { type: "human", cell: 4 }), opening);
  const queued = reply(opening, 4);
  const reset = matchReducer(opening, { type: "reset" });
  assert.ok(isComputerTurn(reset));
  assert.equal(matchReducer(reset, queued), reset);
  assert.deepEqual(matchReducer(reset, reply(reset, 4)).moves, [4]);
});

test("two-player mode stays two-player with either starting preference", () => {
  const match = matchReducer(INITIAL_MATCH, { type: "settings", settings: { first: "computer" } });
  assert.equal(isComputerTurn(match), false);
  assert.equal(matchReducer(match, reply(match, 4)), match);
  const x = matchReducer(match, { type: "human", cell: 4 });
  assert.deepEqual(matchReducer(x, { type: "human", cell: 0 }).moves, [4, 0]);
});
