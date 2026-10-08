// .launchpad/checks/round-3/run.mjs: round 3's checks, "Score, history and keyboard". Run them from the
// repository's root (once per machine before: npx playwright-core install chromium-headless-shell):
//   node .launchpad/checks/round-3/run.mjs
//
// They build the entry (npm run build), serve dist/ and play it in headless Chromium: the score across games
// and reloads, the history of the current game, and the keyboard. Every page runs on Playwright's fake clock,
// paused: the page's timers fire only when a check lets time pass, so the computer's "within 1 second" is exact
// (a move made off the page's clock gets up to 1 more second of real time). Each page starts with an empty
// localStorage, so the score starts at 0; a reload within a check keeps it, which is what the score must survive.
// The entry's code runs only in the build's child process and in the browser, never in this process: the report
// is this process's alone. Under the gate every process this one starts (the build, Chromium) runs as the
// entry's user, so Chromium gets a profile directory anyone can write.
//
// What the brief settles here (the contract the checks hold an entry to):
// - A game counts once, the first time it ends. A game ended, then rewound through its history and ended again,
//   counts nothing more: only New game, or a change of settings, starts a game that can count. A reload counts
//   nothing. Jumping through the history counts nothing.
// - history-0 … history-n are the positions of the current game, n the moves played; New game and a change of
//   settings leave history-0 alone. A click on history-k shows the board after move k, with round 1's status for
//   it and the winning marks only where that position is won. A move from history-k drops the moves after k.
// - The arrow keys move the focus from cell to cell by row and column and stop at the edges; Enter or Space plays
//   the focused cell, as a click would; the focus stays on the board.
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve, sep } from "node:path";
import { check, harness } from "./lib/harness.mjs";
import { entry, ROOT, succeeds, workspace } from "./lib/entry.mjs";

const { test, done } = harness();

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const WAIT_MS = 2_000; // how long the page has to show a click, a jump or a new game (real time)
const SETTLE_MS = 300; // how long a refused click, or a position that must stay, is watched (real time)
const COMPUTER_MS = 1_000; // the computer's time to move, on the page's clock
const OFF_CLOCK_MS = 1_000; // then, real time for a move made off the page's clock

// ---- The game, as the checks expect it (never the entry's code) --------------------------------------
// A board is a 9-character string of X, O and "." (empty), row by row from the top left.

const EMPTY = ".........";
const put = (board, cell, mark) => board.slice(0, cell) + mark + board.slice(cell + 1);
const empties = (board) => [...board].flatMap((mark, cell) => (mark === "." ? [cell] : []));
/** Who plays next on `board`: X starts. */
const toMove = (board) => (empties(board).length % 2 === 1 ? "X" : "O");
const winnerOf = (board) => {
  for (const [a, b, c] of LINES) if (board[a] !== "." && board[a] === board[b] && board[a] === board[c]) return board[a];
  return null;
};
const over = (board) => winnerOf(board) !== null || !board.includes(".");
/** Round 1's status for `board`. */
const statusOf = (board) => {
  const winner = winnerOf(board);
  return winner ? `${winner} wins` : board.includes(".") ? `${toMove(board)} to play` : "Draw";
};
/** The cells of every completed line on `board`, sorted (round 1's data-win cells). */
const winningCells = (board) => [...new Set(LINES.filter(([a, b, c]) => board[a] !== "." && board[a] === board[b] && board[a] === board[c]).flat())].sort((x, y) => x - y);
/** The board after `moves` (cells in order, X first). */
const boardAfter = (moves) => moves.reduce((board, cell) => put(board, cell, toMove(board)), EMPTY);
const show = (board) => `${board.slice(0, 3)}/${board.slice(3, 6)}/${board.slice(6)}`;
const other = (player) => (player === "X" ? "O" : "X");
/** A seeded random generator (mulberry32): the human's choices against the computer are the same on every run. */
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

// ---- Build, serve, browse ------------------------------------------------------------------------------

/** playwright-core from the base's check tools (on PATH under the gate), never from the entry's node_modules. */
function playwright() {
  const require = createRequire(import.meta.url);
  for (const bin of (process.env.PATH ?? "").split(":")) {
    if (!bin.endsWith(`${sep}node_modules${sep}.bin`) || resolve(bin).startsWith(ROOT + sep)) continue;
    const pkg = join(bin, "..", "playwright-core");
    if (existsSync(join(pkg, "package.json"))) return require(pkg);
  }
  // A run by hand, outside the gate: the repository's own install.
  if (process.env.LAUNCHPAD_GATE_OUT) throw new Error("playwright-core is not in the base's check tools");
  return require(join(ROOT, "node_modules", "playwright-core"));
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".map": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};

/** A static server for `dir` on 127.0.0.1: `/` is index.html, nothing outside `dir` (symlinks included). */
async function serve(dir) {
  const root = await realpath(dir);
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = await realpath(join(root, path)).catch(() => null);
      if (!file || !file.startsWith(root + sep) || !(await stat(file)).isFile()) {
        res.writeHead(path === "/favicon.ico" ? 204 : 404).end();
        return;
      }
      res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(await readFile(file));
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise((ok, fail) => server.once("error", fail).listen(0, "127.0.0.1", ok));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

let ready;
/** Builds the entry, serves dist/ and starts Chromium on the fake clock, once: every test waits for it, and fails with it. */
const app = () => (ready ??= (async () => {
  rmSync(join(ROOT, "dist"), { recursive: true, force: true });
  const build = entry("npm", ["run", "build"], { timeoutMs: 180_000, env: { CI: "1", NO_COLOR: "1", npm_config_update_notifier: "false" } });
  await succeeds(build, [], "npm run build");
  check(existsSync(join(ROOT, "dist", "index.html")), "npm run build exited 0 but wrote no dist/index.html");
  const { server, origin } = await serve(join(ROOT, "dist"));
  const profile = join(workspace().scratch, "chromium-profile");
  mkdirSync(profile);
  chmodSync(profile, 0o1777);
  const browser = await playwright().chromium.launchPersistentContext(profile, { headless: true, timeout: 60_000 });
  // Every page from now on runs on the fake clock, paused: its timers wait for the checks to let time pass
  // (installed alone, the fake clock would still flow with real time).
  await browser.clock.install({ time: 0 });
  await browser.clock.pauseAt(1_000);
  return {
    origin,
    browser,
    async close() {
      await browser.close().catch(() => {});
      server.close();
    },
  };
})());

const waitForBoard = (page) => page.locator('[data-testid="board"]').first().waitFor({ state: "attached", timeout: 5_000 })
  .catch(() => { throw new Error('the page has no [data-testid="board"] 5 s after it loaded'); });

/**
 * A fresh page on the game, its board on screen, its localStorage empty (the profile is shared by every page: the
 * score of an earlier check must not leak into this one); `listen(page)` runs before it loads.
 */
async function open(listen) {
  const { browser, origin } = await app();
  const page = await browser.newPage();
  listen?.(page, origin);
  await page.goto(`${origin}/`, { waitUntil: "load", timeout: 15_000 });
  await page.evaluate(() => localStorage.clear());
  await reload(page);
  return page;
}

/** Reloads the page, keeping its storage: what the score must survive. */
async function reload(page) {
  await page.reload({ waitUntil: "load", timeout: 15_000 });
  await waitForBoard(page);
}

/** Runs `fn(page)` on a fresh page, closed afterwards. */
async function onPage(fn) {
  const page = await open();
  try {
    await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

// ---- Reading the page ----------------------------------------------------------------------------------

/** The game as the checks see it: { board, status, wins } or { problem }; `wins` the cells marked data-win="true", sorted. */
const read = (page) => page.evaluate(() => {
  const only = (id) => {
    const all = document.querySelectorAll(`[data-testid="${id}"]`);
    return all.length === 1 ? all[0] : `${all.length} elements with data-testid="${id}" (expected 1)`;
  };
  const board = only("board");
  if (typeof board === "string") return { problem: board };
  let cells = "";
  const wins = [];
  for (let i = 0; i < 9; i++) {
    const cell = only(`cell-${i}`);
    if (typeof cell === "string") return { problem: cell };
    if (cell.tagName !== "BUTTON") return { problem: `cell-${i} is a <${cell.tagName.toLowerCase()}>, not a <button>` };
    if (!board.contains(cell)) return { problem: `cell-${i} is not inside the board` };
    const text = (cell.textContent ?? "").trim();
    if (text !== "X" && text !== "O" && text !== "") return { problem: `cell-${i} reads ${JSON.stringify(text)}: a cell's text is exactly X, O or empty` };
    cells += text || ".";
    if (cell.getAttribute("data-win") === "true") wins.push(i);
  }
  const status = only("status");
  if (typeof status === "string") return { problem: status };
  return { board: cells, status: (status.textContent ?? "").trim(), wins };
});

/** The score as the checks see it: { x, o, draw } (whole numbers) or { problem }; reset-score must be one <button>. */
const readScore = (page) => page.evaluate(() => {
  const out = {};
  for (const [key, id] of [["x", "score-x"], ["o", "score-o"], ["draw", "score-draw"]]) {
    const all = document.querySelectorAll(`[data-testid="${id}"]`);
    if (all.length !== 1) return { problem: `${all.length} elements with data-testid="${id}" (expected 1)` };
    const text = (all[0].textContent ?? "").trim();
    if (!/^\d+$/.test(text)) return { problem: `${id} reads ${JSON.stringify(text)}: its text is a whole number` };
    out[key] = Number(text);
  }
  const reset = document.querySelectorAll('[data-testid="reset-score"]');
  if (reset.length !== 1) return { problem: `${reset.length} elements with data-testid="reset-score" (expected 1)` };
  if (reset[0].tagName !== "BUTTON") return { problem: `reset-score is a <${reset[0].tagName.toLowerCase()}>, not a <button>` };
  return out;
});

/** The history as the checks see it: { n } (history-0 … history-n, each a <button>) or { problem }. */
const readHistory = (page) => page.evaluate(() => {
  const all = [...document.querySelectorAll('[data-testid^="history-"]')];
  const ids = all.map((el) => el.getAttribute("data-testid"));
  const indexes = ids.map((id) => (/^history-(\d+)$/.test(id) ? Number(id.slice(8)) : null));
  const odd = ids.filter((_, i) => indexes[i] === null);
  if (odd.length) return { problem: `data-testid ${odd.map((x) => JSON.stringify(x)).join(", ")}: history buttons are history-0 … history-n` };
  const sorted = [...indexes].sort((a, b) => a - b);
  for (let k = 0; k < sorted.length; k++) if (sorted[k] !== k) return { problem: `history buttons ${ids.join(", ")}: expected history-0 … history-${sorted.length - 1}, each once` };
  const notButton = all.find((el) => el.tagName !== "BUTTON");
  if (notButton) return { problem: `${notButton.getAttribute("data-testid")} is a <${notButton.tagName.toLowerCase()}>, not a <button>` };
  return { n: sorted.length - 1 };
});

/** The data-testid of the element that has the focus, or null. */
const focused = (page) => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);

const describe = (s) => s.problem ?? `board ${show(s.board)}, status ${JSON.stringify(s.status)}${s.wins?.length ? `, winning cells ${s.wins.join(", ")}` : ""}`;
const describeScore = (s) => s.problem ?? `X ${s.x}, O ${s.o}, draws ${s.draw}`;

/** Waits, in real time, until the page's state passes `ok`; throws with `what` and what the page shows. */
async function until(page, ok, what, ms = WAIT_MS) {
  const end = Date.now() + ms;
  let s;
  do {
    s = await read(page);
    if (!s.problem && ok(s)) return s;
    await page.waitForTimeout(25);
  } while (Date.now() < end);
  throw new Error(`${what}; the page shows ${describe(s)}`);
}

/** Waits until the page shows `board` with round 1's status for it. */
const expectGame = (page, board, what) =>
  until(page, (s) => s.board === board && s.status === statusOf(board), `${what}: expected board ${show(board)}, status ${JSON.stringify(statusOf(board))}`);

/** Waits until the page shows `board`, its status and exactly its winning marks (none on a position that is not won). */
const expectPosition = async (page, board, what) => {
  const s = await expectGame(page, board, what);
  const want = winningCells(board);
  if (s.wins.join(",") !== want.join(",")) throw new Error(`${what}: the cells marked data-win="true" are ${s.wins.join(", ") || "none"}, expected ${want.join(", ") || "none"} on ${show(board)}`);
  return s;
};

/** Watches the page for SETTLE_MS: neither the board nor the status may change from `s`. */
async function expectUnchanged(page, s, what) {
  const until = Date.now() + SETTLE_MS;
  do {
    const now = await read(page);
    if (now.problem || now.board !== s.board || now.status !== s.status)
      throw new Error(`${what}: the page changed to ${describe(now)}, expected it to stay ${describe(s)}`);
    await page.waitForTimeout(25);
  } while (Date.now() < until);
}

/** Waits until the score reads `want` (x, o, draw). */
async function expectScore(page, want, what) {
  const end = Date.now() + WAIT_MS;
  let s;
  do {
    s = await readScore(page);
    if (!s.problem && s.x === want.x && s.o === want.o && s.draw === want.draw) return s;
    await page.waitForTimeout(25);
  } while (Date.now() < end);
  throw new Error(`${what}: expected the score X ${want.x}, O ${want.o}, draws ${want.draw}; the page shows ${describeScore(s)}`);
}

/** Waits until the history lists history-0 … history-n. */
async function expectHistory(page, n, what) {
  const end = Date.now() + WAIT_MS;
  let h;
  do {
    h = await readHistory(page);
    if (!h.problem && h.n === n) return h;
    await page.waitForTimeout(25);
  } while (Date.now() < end);
  throw new Error(`${what}: expected history-0 … history-${n}; ${h.problem ?? `the page lists history-0 … history-${h.n}`}`);
}

// ---- Playing -------------------------------------------------------------------------------------------

const click = (page, cell) => page.locator(`[data-testid="cell-${cell}"]`).click({ force: true, timeout: WAIT_MS });
const newGame = (page) => page.locator('[data-testid="new-game"]').click({ timeout: WAIT_MS });
const resetScore = (page) => page.locator('[data-testid="reset-score"]').click({ timeout: WAIT_MS });
const jump = (page, k) => page.locator(`[data-testid="history-${k}"]`).click({ timeout: WAIT_MS });
const choose = (page, id, value) => page.locator(`[data-testid="${id}"]`).selectOption(value, { timeout: WAIT_MS });

/** Lets time pass on the page's clock. */
const letTimePass = (page, ms = COMPUTER_MS) => page.clock.runFor(ms);

/** Two players: plays `moves` from `board`, each shown before the next. Returns the board. */
async function play(page, moves, board = EMPTY) {
  for (const cell of moves) {
    board = put(board, cell, toMove(board));
    await click(page, cell);
    await expectGame(page, board, `after a click on ${cell}`);
  }
  return board;
}

/** Two players, from an empty board: New game, then `moves`. */
const game = async (page, moves) => {
  await newGame(page);
  await expectGame(page, EMPTY, "after New game");
  return play(page, moves);
};

/**
 * The computer's move from `before`: within 1 second of the page's clock (then up to 1 s of real time), exactly
 * one new `mark`, on a cell that was empty, and round 1's status for the board it makes. Returns that board.
 */
async function computerMove(page, before, mark, what) {
  await letTimePass(page);
  const end = Date.now() + OFF_CLOCK_MS;
  let s;
  do {
    s = await read(page);
    if (s.problem) throw new Error(`${what}: ${s.problem}`);
    const changed = [...Array(9).keys()].filter((i) => s.board[i] !== before[i]);
    if (changed.length > 1 || (changed.length === 1 && (before[changed[0]] !== "." || s.board[changed[0]] !== mark)))
      throw new Error(`${what}: the board went from ${show(before)} to ${show(s.board)}; the computer must add one ${mark} on an empty cell`);
    if (changed.length === 1) return (await expectGame(page, s.board, `${what}: after the computer's move`)).board;
    await page.waitForTimeout(25);
  } while (Date.now() < end);
  throw new Error(`${what}: the computer did not move within 1 second: the page shows ${describe(s)}`);
}

/** Against the computer, mode cpu and the given difficulty and first, each change a new game. Returns the board, the computer's first move made. */
async function vsComputer(page, difficulty, first) {
  await choose(page, "mode", "cpu");
  await expectGame(page, EMPTY, "after mode changed to cpu");
  await choose(page, "difficulty", difficulty);
  await expectGame(page, EMPTY, `after difficulty changed to ${difficulty}`);
  if (first === "human") return EMPTY;
  await choose(page, "first", "computer");
  return computerMove(page, EMPTY, "X", "after first changed to computer, the computer plays X");
}

/** The human plays `cell` on `board`; unless that ends the game, the computer answers within 1 second. Returns the board after both moves. */
async function turn(page, board, cell, what) {
  const human = toMove(board);
  const mine = put(board, cell, human);
  await click(page, cell);
  await until(page, (now) => now.board[cell] === human, `${what}: after the human plays ${cell}, expected ${human} there`);
  if (over(mine)) {
    await letTimePass(page);
    await expectUnchanged(page, { board: mine, status: statusOf(mine) }, `${what}: the game ended on the human's move ${cell}`);
    return mine;
  }
  return computerMove(page, mine, other(human), `${what}: the computer's answer to ${cell}`);
}

/** The human picks with `human(board)` until the game ends. Returns the final board. */
async function playOut(page, board, human, what) {
  while (!over(board)) board = await turn(page, board, human(board), what);
  return board;
}

/** The score a finished `board` adds to `score`. */
const counted = (score, board) => {
  const w = winnerOf(board);
  return { x: score.x + (w === "X" ? 1 : 0), o: score.o + (w === "O" ? 1 : 0), draw: score.draw + (w === null ? 1 : 0) };
};

const X_WINS = [0, 3, 1, 4, 2]; // X on the top row
const O_WINS = [0, 3, 1, 4, 8, 5]; // O on the middle row
const DRAW = [0, 1, 2, 4, 3, 5, 7, 6, 8];

// ---- The tests -----------------------------------------------------------------------------------------

await test("score-x, score-o and score-draw read 0 on a fresh page, reset-score is a button, and history-0 alone lists the empty board", () =>
  onPage(async (page) => {
    await expectGame(page, EMPTY, "on a fresh page");
    await expectScore(page, { x: 0, o: 0, draw: 0 }, "on a fresh page");
    await expectHistory(page, 0, "on a fresh page");
    await resetScore(page);
    await expectScore(page, { x: 0, o: 0, draw: 0 }, "after reset-score on a fresh page");
    await expectGame(page, EMPTY, "after reset-score on a fresh page");
  }));

await test("a game counts once, when it ends, in two-player mode: X's wins, O's wins and draws, not before the end, not again on New game", () =>
  onPage(async (page) => {
    let score = { x: 0, o: 0, draw: 0 };
    let board = await play(page, X_WINS.slice(0, 4));
    await expectScore(page, score, "before the game ends (X on 0 and 1, O on 3 and 4)");
    board = await play(page, X_WINS.slice(4), board);
    score = counted(score, board);
    await expectScore(page, score, "after X wins");
    await click(page, 5);
    await expectUnchanged(page, { board, status: statusOf(board) }, "a click after the win");
    await expectScore(page, score, "after a click on the won board");
    await newGame(page);
    await expectGame(page, EMPTY, "after New game");
    await expectScore(page, score, "after New game following a win");
    board = await play(page, O_WINS);
    score = counted(score, board);
    await expectScore(page, score, "after O wins");
    board = await game(page, DRAW);
    score = counted(score, board);
    await expectScore(page, score, "after a draw");
    await newGame(page);
    await expectGame(page, EMPTY, "after New game");
    await expectScore(page, score, "after New game following a draw");
    // A game given up in the middle counts nothing: New game, or a change of settings.
    await play(page, [4, 0]);
    await newGame(page);
    await expectGame(page, EMPTY, "after New game in the middle of a game");
    await expectScore(page, score, "after New game in the middle of a game");
    await play(page, [4]);
    await choose(page, "first", "computer");
    await expectGame(page, EMPTY, "after first changed to computer in the middle of a game (two players)");
    await expectScore(page, score, "after a change of settings in the middle of a game");
    await choose(page, "first", "human");
    await expectGame(page, EMPTY, "after first changed back to human");
    board = await play(page, X_WINS);
    score = counted(score, board);
    await expectScore(page, score, "after a second win of X");
    check(score.x === 2 && score.o === 1 && score.draw === 1, `the score should be X 2, O 1, draws 1 here, it is ${describeScore(score)}`);
  }));

await test("the scores survive a reload, and reset-score sets them back to 0", () =>
  onPage(async (page) => {
    let score = counted({ x: 0, o: 0, draw: 0 }, await play(page, X_WINS));
    await expectScore(page, score, "after X wins");
    await reload(page);
    await expectScore(page, score, "after a reload following X's win (the win counts once, not again on load)");
    await reload(page);
    await expectScore(page, score, "after a second reload");
    score = counted(score, await game(page, O_WINS));
    await expectScore(page, score, "after O wins");
    score = counted(score, await game(page, DRAW));
    await expectScore(page, score, "after a draw");
    await reload(page);
    await expectScore(page, score, "after a reload following O's win and a draw");
    await resetScore(page);
    await expectScore(page, { x: 0, o: 0, draw: 0 }, "after reset-score");
    await reload(page);
    await expectScore(page, { x: 0, o: 0, draw: 0 }, "after a reload following reset-score");
    score = counted({ x: 0, o: 0, draw: 0 }, await game(page, X_WINS));
    await expectScore(page, score, "after X wins following a reset");
    await reload(page);
    await expectScore(page, score, "after a reload following X's win after the reset");
  }));

await test("against the computer, a finished game counts once too, whoever starts", () =>
  onPage(async (page) => {
    const rng = seeded(31);
    let score = { x: 0, o: 0, draw: 0 };
    let board = await vsComputer(page, "easy", "human");
    board = await playOut(page, board, (b) => pick(rng, empties(b)), "against easy, the human X");
    score = counted(score, board);
    await expectScore(page, score, "after a game against easy ended");
    await letTimePass(page, 2 * COMPUTER_MS);
    await expectScore(page, score, "2 s after a game against easy ended");
    await newGame(page);
    await expectGame(page, EMPTY, "after New game against the computer");
    await expectScore(page, score, "after New game against the computer");
    await choose(page, "first", "computer");
    board = await computerMove(page, EMPTY, "X", "after first changed to computer, the computer plays X");
    board = await playOut(page, board, (b) => pick(rng, empties(b)), "against easy, the human O");
    score = counted(score, board);
    await expectScore(page, score, "after a game against easy, the computer first, ended");
    await reload(page);
    await expectScore(page, score, "after a reload following two games against the computer");
  }));

await test("history-0 … history-n list every position of the game; a click shows that position's board, status and marks", () =>
  onPage(async (page) => {
    const moves = [4, 0, 8];
    await play(page, moves);
    await expectHistory(page, 3, "after 3 moves");
    for (const k of [1, 0, 3, 2]) {
      await jump(page, k);
      await expectPosition(page, boardAfter(moves.slice(0, k)), `after a click on history-${k} (moves ${moves.join(", ")})`);
      await expectHistory(page, 3, `after a click on history-${k}: a jump keeps the history`);
    }
    // A won game: the winning marks show on the final position only.
    const won = await game(page, X_WINS);
    await expectPosition(page, won, "after X wins");
    await expectHistory(page, 5, "after X wins in 5 moves");
    await jump(page, 4);
    await expectPosition(page, boardAfter(X_WINS.slice(0, 4)), "after a click on history-4 of a won game (no winning marks, X to play)");
    await jump(page, 0);
    await expectPosition(page, EMPTY, "after a click on history-0 of a won game");
    await jump(page, 5);
    await expectPosition(page, won, "after a click on history-5, back to the won position (its marks again)");
    await newGame(page);
    await expectGame(page, EMPTY, "after New game");
    await expectHistory(page, 0, "after New game: the history starts over");
    await play(page, [4]);
    await choose(page, "difficulty", "hard");
    await expectGame(page, EMPTY, "after a change of settings");
    await expectHistory(page, 0, "after a change of settings: the history starts over");
  }));

await test("a move from a past position drops the later moves, and the history follows", () =>
  onPage(async (page) => {
    await play(page, [4, 0, 8]);
    await jump(page, 1);
    await expectPosition(page, boardAfter([4]), "after a click on history-1");
    await click(page, 2);
    await expectPosition(page, boardAfter([4, 2]), "after O plays 2 from history-1 (the moves after it are dropped)");
    await expectHistory(page, 2, "after a move from history-1");
    await jump(page, 2);
    await expectPosition(page, boardAfter([4, 2]), "after a click on history-2, the last position now");
    await jump(page, 0);
    await expectPosition(page, EMPTY, "after a click on history-0");
    await click(page, 6);
    await expectPosition(page, boardAfter([6]), "after X plays 6 from history-0");
    await expectHistory(page, 1, "after a move from history-0");
    // A click on an occupied cell of a past position changes nothing but the position stays shown.
    await play(page, [4, 8], boardAfter([6]));
    await jump(page, 2);
    const s = await expectPosition(page, boardAfter([6, 4]), "after a click on history-2");
    await click(page, 6);
    await expectUnchanged(page, s, "a click on an occupied cell of a past position");
    await expectHistory(page, 3, "after a refused click on a past position: nothing dropped");
  }));

await test("a game counts once whatever is replayed: ending it again from its history adds nothing; a new game counts again", () =>
  onPage(async (page) => {
    let score = counted({ x: 0, o: 0, draw: 0 }, await play(page, X_WINS));
    await expectScore(page, score, "after X wins");
    // Back before the winning move, and O wins instead: the same game, already counted.
    await jump(page, 4);
    await expectPosition(page, boardAfter(X_WINS.slice(0, 4)), "after a click on history-4");
    const replayed = await play(page, [8, 5], boardAfter(X_WINS.slice(0, 4)));
    check(winnerOf(replayed) === "O", "the checks' own replay should end with O winning");
    await expectScore(page, score, "after the won game was rewound and ended again with O's win: it counted once already");
    await letTimePass(page, COMPUTER_MS);
    await expectScore(page, score, "1 s after the replayed end");
    await reload(page);
    await expectScore(page, score, "after a reload following the replayed end");
    // A game rewound before it ended counts when it ends, once.
    let board = await game(page, [4, 0]);
    await jump(page, 1);
    await expectPosition(page, boardAfter([4]), "after a click on history-1 of an unfinished game");
    board = await play(page, [0, 8, 2, 1, 6, 3, 5, 7], boardAfter([4]));
    check(winnerOf(board) === "X", "the checks' own line should end with X winning");
    score = counted(score, board);
    await expectScore(page, score, "after a game rewound in the middle ended (it counts once)");
    await expectHistory(page, 9, "after 9 moves of the rewound game");
    // New game, then a draw: counts.
    score = counted(score, await game(page, DRAW));
    await expectScore(page, score, "after a draw following New game");
    check(score.x === 2 && score.o === 0 && score.draw === 1, `the score should be X 2, O 0, draws 1 here, it is ${describeScore(score)}`);
  }));

await test("against the computer, a jump to the computer's turn lets it play within 1 second, and a jump to the human's turn does not", () =>
  onPage(async (page) => {
    let board = await vsComputer(page, "easy", "human");
    board = await turn(page, board, 4, "against easy");
    board = await turn(page, board, empties(board)[0], "against easy, the second move");
    await expectHistory(page, 4, "after two turns against the computer");
    // history-1: X on 4 alone, the computer's turn (O).
    await jump(page, 1);
    const after = await computerMove(page, boardAfter([4]), "O", "after a jump to history-1, the computer's turn");
    await expectHistory(page, 2, "after the computer played from history-1 (the later moves are dropped)");
    // history-2: the human's turn: nothing happens, however long.
    await jump(page, 2);
    await expectPosition(page, after, "after a click on history-2");
    await letTimePass(page, 2 * COMPUTER_MS);
    await expectUnchanged(page, { board: after, status: statusOf(after) }, "2 s after a jump to the human's turn");
    await expectHistory(page, 2, "2 s after a jump to the human's turn");
    // history-0 with the computer first: the computer opens again.
    await choose(page, "first", "computer");
    board = await computerMove(page, EMPTY, "X", "after first changed to computer, the computer plays X");
    board = await turn(page, board, empties(board)[0], "against easy, the human O");
    await expectHistory(page, 3, "after the computer's opening and one turn");
    await jump(page, 0);
    await computerMove(page, EMPTY, "X", "after a jump to history-0 with the computer first");
    await expectHistory(page, 1, "after the computer opened again from history-0");
  }));

await test("the arrow keys move the focus between the cells, stopping at the edges, and Enter or Space plays the focused cell", () =>
  onPage(async (page) => {
    await page.locator('[data-testid="cell-4"]').focus();
    check((await focused(page)) === "cell-4", `focusing cell-4 gave the focus to ${await focused(page)}`);
    const steps = [["ArrowRight", "cell-5"], ["ArrowRight", "cell-5"], ["ArrowDown", "cell-8"], ["ArrowDown", "cell-8"], ["ArrowLeft", "cell-7"], ["ArrowLeft", "cell-6"],
      ["ArrowLeft", "cell-6"], ["ArrowUp", "cell-3"], ["ArrowUp", "cell-0"], ["ArrowUp", "cell-0"], ["ArrowRight", "cell-1"], ["ArrowDown", "cell-4"]];
    for (const [key, want] of steps) {
      await page.keyboard.press(key);
      const got = await focused(page);
      check(got === want, `after ${key}, the focus is on ${got ?? "nothing"}, expected ${want}`);
    }
    await page.keyboard.press("Enter");
    await expectGame(page, boardAfter([4]), "after Enter on cell-4");
    await page.keyboard.press("ArrowUp");
    check((await focused(page)) === "cell-1", `after ArrowUp from cell-4, the focus is on ${await focused(page)}, expected cell-1`);
    await page.keyboard.press("Space");
    await expectGame(page, boardAfter([4, 1]), "after Space on cell-1");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expectUnchanged(page, { board: boardAfter([4, 1]), status: statusOf(boardAfter([4, 1])) }, "Enter on the occupied cell-4");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expectGame(page, boardAfter([4, 1, 7]), "after Space on cell-7");
    await expectHistory(page, 3, "after three moves from the keyboard");
  }));

await test("a whole game from the keyboard, with the score and the history following, logs no console error and makes no request outside the page's own server", async () => {
  const errors = [];
  const page = await open((p, origin) => {
    p.on("console", (m) => m.type() === "error" && errors.push(`console error: ${m.text()}`));
    p.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
    p.on("request", (r) => {
      const url = r.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      let at = null;
      try {
        at = new URL(url).origin;
      } catch {}
      if (at !== origin) errors.push(`request outside the page's server: ${url}`);
    });
    p.on("response", (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} for ${r.url()}`));
  });
  try {
    await page.locator('[data-testid="cell-0"]').focus();
    // X 0, O 3, X 1, O 4, X 2: X wins on the top row, all from the keyboard.
    const keys = ["Enter", "ArrowDown", "Enter", "ArrowUp", "ArrowRight", "Enter", "ArrowDown", "Enter", "ArrowUp", "ArrowRight", "Enter"];
    for (const key of keys) await page.keyboard.press(key);
    await expectPosition(page, boardAfter(X_WINS), "after X's win from the keyboard");
    await expectScore(page, { x: 1, o: 0, draw: 0 }, "after X's win from the keyboard");
    await expectHistory(page, 5, "after X's win from the keyboard");
    await jump(page, 3);
    await expectPosition(page, boardAfter(X_WINS.slice(0, 3)), "after a click on history-3");
    await reload(page);
    await expectScore(page, { x: 1, o: 0, draw: 0 }, "after a reload");
    await resetScore(page);
    await expectScore(page, { x: 0, o: 0, draw: 0 }, "after reset-score");
    await letTimePass(page);
    await page.waitForTimeout(SETTLE_MS);
    check(errors.length === 0, errors.slice(0, 5).join("\n"));
  } finally {
    await page.close().catch(() => {});
  }
});

await ready?.then((a) => a.close(), () => {});
done();
