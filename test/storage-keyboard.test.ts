import assert from "node:assert/strict";
import { test } from "node:test";
import { arrowDestination } from "../src/keyboard.ts";
import { readScores, writeScores, SCORE_KEY } from "../src/scoreStorage.ts";

test("scores round-trip without storing any board or game result to replay", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, val: string) => { values.set(key, val); } };
  assert.deepEqual(readScores(storage), { x: 0, o: 0, draw: 0 });
  assert.equal(writeScores({ x: 12, o: 4, draw: 3 }, storage), true);
  assert.deepEqual(readScores(storage), { x: 12, o: 4, draw: 3 });
  assert.equal(values.size, 1);
  assert.equal(values.has(SCORE_KEY), true);
  assert.equal(writeScores({ x: 0, o: 0, draw: 0 }, storage), true);
  assert.deepEqual(readScores(storage), { x: 0, o: 0, draw: 0 });
});

test("bad or blocked storage cannot crash the game or supply invalid score numbers", () => {
  for (const text of ["broken", "null", "[]", '{"x":-1,"o":0,"draw":0}', '{"x":1.5,"o":0,"draw":0}', '{"x":"1","o":0,"draw":0}', '{"x":1,"o":0}', '{"x":1e99,"o":0,"draw":0}']) {
    assert.deepEqual(readScores({ getItem: () => text, setItem: () => {} }), { x: 0, o: 0, draw: 0 });
  }
  const blocked = { getItem: (): string => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
  assert.deepEqual(readScores(blocked), { x: 0, o: 0, draw: 0 });
  assert.equal(writeScores({ x: 1, o: 0, draw: 0 }, blocked), false);
});

test("every arrow from every square preserves the other coordinate and stops at the edge", () => {
  for (let cell = 0; cell < 9; cell++) {
    const r = Math.floor(cell / 3), c = cell % 3;
    assert.equal(arrowDestination(cell, "ArrowLeft"), 3 * r + Math.max(0, c - 1));
    assert.equal(arrowDestination(cell, "ArrowRight"), 3 * r + Math.min(2, c + 1));
    assert.equal(arrowDestination(cell, "ArrowUp"), 3 * Math.max(0, r - 1) + c);
    assert.equal(arrowDestination(cell, "ArrowDown"), 3 * Math.min(2, r + 1) + c);
    assert.equal(arrowDestination(cell, "Enter"), null);
  }
  assert.equal(arrowDestination(9, "ArrowUp"), null);
  assert.equal(arrowDestination(-1, "ArrowDown"), null);
});
