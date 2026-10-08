import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { easyMove, hardMove, legalMoves } from "../src/computer.ts";
import { boardOf, NEW_GAME, play } from "../src/game.ts";
import type { Moves } from "../src/game.ts";

// A separate board-based oracle: no engine outcome, line table or search is used here.
function winner(b: string): string | null {
  for (const p of ["X", "O"]) {
    for (let i = 0; i < 3; i++) {
      if ([0, 1, 2].every(j => b[3 * i + j] === p)) return p;
      if ([0, 1, 2].every(j => b[3 * j + i] === p)) return p;
    }
    if ([0, 4, 8].every(i => b[i] === p) || [2, 4, 6].every(i => b[i] === p)) return p;
  }
  return null;
}
const emptyCells = (b: string): number[] => [...b].flatMap((p, i) => p === "." ? [i] : []);
const mark = (b: string): string => emptyCells(b).length % 2 ? "X" : "O";
const put = (b: string, i: number): string => b.slice(0, i) + mark(b) + b.slice(i + 1);
const valueCache = new Map<string, number>();
function value(b: string): number {
  const known = valueCache.get(b);
  if (known !== undefined) return known;
  const empties = emptyCells(b);
  // Magnitude favours winning sooner and delaying unavoidable losses.
  const score = winner(b) ? -(empties.length + 1)
    : !empties.length ? 0 : Math.max(...empties.map(i => -value(put(b, i))));
  valueCache.set(b, score);
  return score;
}

test("Hard chooses an optimal move in every reachable position, from either side", () => {
  const positions = new Map<string, Moves>();
  function collect(b: string, moves: Moves) {
    if (positions.has(b)) return;
    positions.set(b, moves);
    if (winner(b)) return;
    for (const i of emptyCells(b)) collect(put(b, i), [...moves, i]);
  }
  collect(".........", []);
  assert.equal(positions.size, 5478);
  let checked = 0;
  const started = performance.now();
  for (const [b, moves] of positions) {
    const frozen = Object.freeze([...moves]);
    const selected = hardMove(frozen);
    if (winner(b) || !b.includes(".")) {
      assert.equal(selected, null);
      continue;
    }
    assert.notEqual(selected, null);
    assert.ok(emptyCells(b).includes(selected!));
    assert.equal(-value(put(b, selected!)), value(b), `suboptimal move ${selected} on ${b}`);
    assert.deepEqual(frozen, moves);
    checked++;
  }
  assert.equal(checked, 4520);
  console.log(`Optimal on ${checked} positions; ${Math.round(performance.now() - started)} ms for all searches`);
});

test("Easy partitions the random sample uniformly across legal moves and can be beaten", () => {
  const moves = play(NEW_GAME, 4);
  const legal = legalMoves(moves);
  for (let i = 0; i < legal.length; i++) {
    assert.equal(easyMove(moves, (i + .5) / legal.length), legal[i]);
  }
  assert.equal(easyMove(moves, 0), legal[0]);
  assert.equal(easyMove(moves, .999999), legal.at(-1));
  for (const sample of [-1, 1, Infinity, NaN]) assert.throws(() => easyMove(moves, sample), RangeError);
  let game: Moves = [];
  for (const human of [0, 3, 6]) {
    game = play(game, human);
    const cpu = easyMove(game, 0);
    if (cpu !== null) game = play(game, cpu);
  }
  assert.equal(winner(boardOf(game).map(p => p ?? ".").join("")), "X");
  assert.equal(hardMove(game), null);
  assert.equal(easyMove(game, .5), null);
});
