import assert from "node:assert/strict";
import { test } from "node:test";
import { neighbour } from "../src/game.ts";
import { loadScore, parseScore, saveScore, SCORE_KEY } from "../src/storage.ts";

function memoryStore() {
  const items = new Map<string, string>();
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
}

test("the score round-trips through storage", () => {
  const store = memoryStore();
  assert.deepEqual(loadScore(store), { x: 0, o: 0, draw: 0 });
  saveScore({ x: 2, o: 1, draw: 4 }, store);
  assert.deepEqual(JSON.parse(store.items.get(SCORE_KEY)!), { x: 2, o: 1, draw: 4 });
  assert.deepEqual(loadScore(store), { x: 2, o: 1, draw: 4 });
});

test("unreadable storage gives 0, never an error", () => {
  for (const text of [null, "", "nope", "null", "[]", '"3"', '{"x":-1,"o":1.5,"draw":"2"}'])
    assert.deepEqual(parseScore(text), { x: 0, o: 0, draw: 0 }, String(text));
  assert.deepEqual(parseScore('{"x":3,"draw":1}'), { x: 3, o: 0, draw: 1 });
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  assert.deepEqual(loadScore(broken), { x: 0, o: 0, draw: 0 });
  assert.doesNotThrow(() => saveScore({ x: 1, o: 0, draw: 0 }, broken));
  assert.deepEqual(loadScore(null), { x: 0, o: 0, draw: 0 });
});

test("the arrow keys' neighbours follow rows and columns and stop at the edges", () => {
  assert.equal(neighbour(4, "up"), 1);
  assert.equal(neighbour(4, "down"), 7);
  assert.equal(neighbour(4, "left"), 3);
  assert.equal(neighbour(4, "right"), 5);
  for (const cell of [0, 1, 2]) assert.equal(neighbour(cell, "up"), cell);
  for (const cell of [6, 7, 8]) assert.equal(neighbour(cell, "down"), cell);
  for (const cell of [0, 3, 6]) assert.equal(neighbour(cell, "left"), cell);
  for (const cell of [2, 5, 8]) assert.equal(neighbour(cell, "right"), cell);
  assert.equal(neighbour(2, "left"), 1, "no wrap to the next row");
});
