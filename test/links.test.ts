import assert from "node:assert/strict";
import test from "node:test";
import { parseGame, readGameLink, writeGameLink } from "../src/links.ts";
import { matchFromLink, matchReducer } from "../src/match.ts";

test("every legal replay round-trips, including every finished game", () => {
  // Independent rules: generate every legal sequence, stopping immediately at a win or draw.
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  let positions = 0;
  let endings = 0;
  function visit(moves: number[], board: string[]) {
    positions++;
    const parsed = parseGame(moves.join(""));
    assert.equal(parsed.error, null);
    assert.deepEqual(parsed.moves, moves);
    const url = writeGameLink("https://example.test/play/?private=discard#fragment", moves);
    assert.deepEqual(readGameLink(url), parsed);
    assert.equal(new URL(url).pathname, "/play/");
    assert.deepEqual([...new URL(url).searchParams.keys()], ["game"]);
    assert.equal(new URL(url).hash, "");
    const ended = moves.length === 9 || lines.some(([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c]);
    if (ended) { endings++; return; }
    for (let cell = 0; cell < 9; cell++) {
      if (board[cell]) continue;
      const next = [...board];
      next[cell] = moves.length % 2 === 0 ? "X" : "O";
      visit([...moves, cell], next);
    }
  }
  visit([], Array<string>(9).fill(""));
  assert.equal(positions, 549946);
  assert.equal(endings, 255168);
});

test("invalid replays are refused in full with specific reasons", () => {
  for (const value of ["abc", "9", "-1", "4 0", "4,0", "４", "4\n0", "<script>", "0123456789", "0".repeat(100000)]) {
    const result = parseGame(value);
    assert.deepEqual(result.moves, []);
    assert.ok(result.error);
  }
  assert.match(parseGame("44").error ?? "", /Move 2 repeats cell 4/);
  assert.match(parseGame("031425").error ?? "", /Move 6 comes after/);
  assert.match(parseGame("0".repeat(50)).error ?? "", /at most 9/);
  assert.deepEqual(parseGame(null), { moves: [], error: null });
  assert.deepEqual(parseGame(""), { moves: [], error: null });
});

test("URL decoding accepts encoded digits and rejects ambiguous or malformed URLs", () => {
  assert.deepEqual(readGameLink("https://example.test/?game=%34%30%38%35%32").moves, [4, 0, 8, 5, 2]);
  for (const href of ["not a URL", "https://example.test/?game=4&game=0", "https://example.test/?game=%00", "https://example.test/?game=%ZZ", "https://example.test/?game=4+0"]) {
    const result = readGameLink(href);
    assert.ok(result.error);
    assert.deepEqual(result.moves, []);
  }
});

test("a loaded finished result and its rewinds never count; a partial replay counts when completed here", () => {
  const score = { x: 3, o: 2, draw: 1 };
  const finished = matchFromLink(parseGame("03142"), score);
  assert.equal(finished.counted, true);
  assert.equal(finished.settings.mode, "pvp");
  assert.equal(finished.history, finished.moves);
  const rewound = matchReducer(finished, { type: "jump", step: 4 });
  assert.deepEqual(matchReducer(rewound, { type: "human", cell: 2 }).score, score);
  const partial = matchFromLink(parseGame("0314"), score);
  assert.equal(partial.counted, false);
  assert.deepEqual(matchReducer(partial, { type: "human", cell: 2 }).score, { ...score, x: 4 });
  const reset = matchReducer(finished, { type: "reset" });
  assert.deepEqual(reset.moves, []);
  assert.equal(reset.counted, false);
});

test("a bad link leaves a playable board; a legal move or new game dismisses the error", () => {
  const broken = matchFromLink(parseGame("44"), { x: 0, o: 0, draw: 0 });
  assert.ok(broken.linkError);
  const moved = matchReducer(broken, { type: "human", cell: 4 });
  assert.deepEqual(moved.moves, [4]);
  assert.equal(moved.linkError, null);
  assert.equal(matchReducer(broken, { type: "reset" }).linkError, null);
});
