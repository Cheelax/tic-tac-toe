import assert from "node:assert/strict";
import { test } from "node:test";
import { boardOf, CELL_COUNT, outcomeOf, type Moves } from "../src/game.ts";
import { gameOfSearch, linkOf, parseMoves, type LinkGame } from "../src/link.ts";
import { INITIAL_MATCH, matchOfLink, matchReducer, type Match } from "../src/match.ts";

const PAGE = "https://example.test/tic-tac-toe/?game=012#rules";
const moves = (link: LinkGame): Moves => {
  assert.ok(link.ok, link.ok ? "" : link.reason);
  return link.moves;
};
const reason = (link: LinkGame): string => {
  assert.ok(!link.ok, "the link was accepted");
  return link.reason;
};

/** Every position of every game, the empty board included: each game as it stands after each of its moves. */
function* everyPosition(game: Moves = []): Generator<Moves> {
  yield game;
  if (outcomeOf(boardOf(game)).status !== "playing") return;
  for (let cell = 0; cell < CELL_COUNT; cell++) if (!game.includes(cell)) yield* everyPosition([...game, cell]);
}

test("?game=40852 is X 4, O 0, X 8, O 5, X 2; no game, or an empty one, is the empty board", () => {
  assert.deepEqual(moves(gameOfSearch("?game=40852")), [4, 0, 8, 5, 2]);
  assert.deepEqual(moves(gameOfSearch("")), []);
  assert.deepEqual(moves(gameOfSearch("?game=")), []);
  assert.deepEqual(moves(gameOfSearch("?other=1")), []);
});

test("every position of every game round-trips through its link", () => {
  let positions = 0;
  for (const game of everyPosition()) {
    const link = linkOf(PAGE, game);
    assert.deepEqual(moves(gameOfSearch(new URL(link).search)), game, link);
    positions++;
  }
  assert.equal(positions, 549_946);
});

test("a link keeps the page's origin and path, drops its query and fragment, and has no game for the empty board", () => {
  assert.equal(linkOf(PAGE, [4, 0, 8, 5, 2]), "https://example.test/tic-tac-toe/?game=40852");
  assert.equal(linkOf(PAGE, []), "https://example.test/tic-tac-toe/");
  assert.equal(linkOf("http://127.0.0.1:4173/", [0]), "http://127.0.0.1:4173/?game=0");
});

test("a bad link is refused with a reason that names the problem", () => {
  const cases: [string, RegExp][] = [
    ["abc", /"a" \(character 1\) is not a square/],
    ["4a", /"a" \(character 2\)/],
    ["4,0", /"," \(character 2\)/],
    ["9", /"9" \(character 1\) is not a square: squares are the digits 0 to 8/],
    ["-1", /"-" \(character 1\)/],
    ["4 0", /a space \(character 2\)/],
    ["4\u00000", /a control character \(character 2\)/],
    ["4😀", /"😀" \(character 2\)/],
    ["44", /Move 2 plays square 4, already taken on move 1/],
    ["4084", /Move 4 plays square 4, already taken on move 1/],
    ["031428", /Move 6 comes after the game ended \(X wins on move 5\)/],
    ["0124357680", /It lists 10 moves, and a game has at most 9/],
    ["01234567801234567801234567801234567801234567801234", /It lists 50 moves/],
  ];
  for (const [cells, expected] of cases) {
    assert.match(reason(gameOfSearch(`?game=${encodeURIComponent(cells)}`)), expected, cells);
  }
  assert.match(reason(gameOfSearch("?game=40&game=8")), /game= appears 2 times/);
});

test("a very long link is refused without repeating it", () => {
  const digits = "0".repeat(100_000);
  assert.ok(reason(parseMoves(digits)).length < 100);
  assert.ok(reason(parseMoves(`${digits}x`)).length < 100);
});

test("a game still on opens in two-player mode and counts when it ends here, once", () => {
  const cpu = matchReducer(INITIAL_MATCH, { type: "settings", settings: { mode: "cpu", difficulty: "hard" } });
  const opened = matchOfLink(gameOfSearch("?game=0314"), cpu);
  assert.equal(opened.settings.mode, "pvp");
  assert.equal(opened.settings.difficulty, "hard");
  assert.deepEqual(opened.history, [0, 3, 1, 4]);
  assert.deepEqual(opened.moves, [0, 3, 1, 4]);
  assert.equal(opened.linkError, null);
  const won = matchReducer(opened, { type: "human", cell: 2 });
  assert.deepEqual(won.score, { x: 1, o: 0, draw: 0 });
  const replayed = matchReducer(matchReducer(won, { type: "jump", step: 4 }), { type: "human", cell: 5 });
  assert.deepEqual(replayed.score, { x: 1, o: 0, draw: 0 });
});

test("a finished game opens finished and counts nothing, even played again from its history", () => {
  let match: Match = matchOfLink(gameOfSearch("?game=03142"));
  assert.equal(outcomeOf(boardOf(match.moves)).status, "won");
  assert.deepEqual(match.score, { x: 0, o: 0, draw: 0 });
  match = matchReducer(match, { type: "human", cell: 5 });
  assert.deepEqual(match.moves, [0, 3, 1, 4, 2]);
  match = matchReducer(matchReducer(match, { type: "jump", step: 4 }), { type: "human", cell: 6 });
  match = matchReducer(match, { type: "human", cell: 2 });
  assert.deepEqual(match.score, { x: 0, o: 0, draw: 0 });
  match = matchReducer(match, { type: "reset" });
  for (const cell of [0, 3, 1, 4, 2]) match = matchReducer(match, { type: "human", cell });
  assert.deepEqual(match.score, { x: 1, o: 0, draw: 0 });
});

test("a bad link opens the empty board with its reason, until the first move or a new game", () => {
  const opened = matchOfLink(gameOfSearch("?game=44"));
  assert.deepEqual(opened.moves, []);
  assert.match(opened.linkError ?? "", /already taken/);
  assert.equal(matchReducer(opened, { type: "human", cell: 4 }).linkError, null);
  assert.equal(matchReducer(opened, { type: "reset" }).linkError, null);
  assert.equal(matchReducer(opened, { type: "settings", settings: { mode: "cpu" } }).linkError, null);
});
