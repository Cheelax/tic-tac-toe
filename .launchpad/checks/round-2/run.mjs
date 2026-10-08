// .launchpad/checks/round-2/run.mjs: round 2's checks, "Play the computer". Run them from the
// repository's root (once per machine before: npx playwright-core install chromium-headless-shell):
//   node .launchpad/checks/round-2/run.mjs
//
// They build the entry (npm run build), serve dist/ and play it in headless Chromium, against the computer.
// Every page runs on Playwright's fake clock: the page's timers fire only when a check lets time pass, so
// "within 1 second" is exact, and a click "while it is the computer's turn" lands before the computer can
// answer. A move made off the page's clock (in a worker, say) gets up to 1 more second of real time.
// The entry's code runs only in the build's child process and in the browser, never in this process: the
// report is this process's alone. Under the gate every process this one starts (the build, Chromium) runs
// as the entry's user, so Chromium gets a profile directory anyone can write.
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve, sep } from "node:path";
import { check, harness } from "./lib/harness.mjs";
import { entry, ROOT, succeeds, workspace } from "./lib/entry.mjs";

const { test, done } = harness();

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const WAIT_MS = 2_000; // how long the page has to show a click or a new game (real time)
const SETTLE_MS = 300; // how long a refused click is watched for a change (real time)
const COMPUTER_MS = 1_000; // the computer's time to move, on the page's clock
const OFF_CLOCK_MS = 1_000; // then, real time for a move made off the page's clock
const SELECTS = { mode: ["pvp", "cpu"], difficulty: ["easy", "hard"], first: ["human", "computer"] };
const DEFAULTS = { mode: "pvp", difficulty: "easy", first: "human" };

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
const show = (board) => `${board.slice(0, 3)}/${board.slice(3, 6)}/${board.slice(6)}`;
const other = (player) => (player === "X" ? "O" : "X");

/** The value of `board` for the player to move, both sides playing perfectly: 1 a win, 0 a draw, -1 a loss. */
const values = new Map();
function value(board) {
  let v = values.get(board);
  if (v !== undefined) return v;
  if (winnerOf(board)) v = -1; // the last move won
  else if (!board.includes(".")) v = 0;
  else v = Math.max(...empties(board).map((cell) => -value(put(board, cell, toMove(board)))));
  values.set(board, v);
  return v;
}
/** The human's best moves on `board`: every move that keeps the best outcome the position allows. */
function bestMoves(board) {
  const scored = empties(board).map((cell) => [cell, -value(put(board, cell, toMove(board)))]);
  const top = Math.max(...scored.map(([, v]) => v));
  return scored.filter(([, v]) => v === top).map(([cell]) => cell);
}
/** A seeded random generator (mulberry32): the human's choices are the same on every run. */
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

/** A fresh page on the game, its board on screen; `listen(page)` runs before it loads. */
async function open(listen) {
  const { browser, origin } = await app();
  const page = await browser.newPage();
  listen?.(page, origin);
  await page.goto(`${origin}/`, { waitUntil: "load", timeout: 15_000 });
  await page.locator('[data-testid="board"]').first().waitFor({ state: "attached", timeout: 5_000 })
    .catch(() => { throw new Error('the page has no [data-testid="board"] 5 s after it loaded'); });
  return page;
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

/** The game as the checks see it: { board, status } or { problem }. */
const read = (page) => page.evaluate(() => {
  const only = (id) => {
    const all = document.querySelectorAll(`[data-testid="${id}"]`);
    return all.length === 1 ? all[0] : `${all.length} elements with data-testid="${id}" (expected 1)`;
  };
  const board = only("board");
  if (typeof board === "string") return { problem: board };
  let cells = "";
  for (let i = 0; i < 9; i++) {
    const cell = only(`cell-${i}`);
    if (typeof cell === "string") return { problem: cell };
    if (cell.tagName !== "BUTTON") return { problem: `cell-${i} is a <${cell.tagName.toLowerCase()}>, not a <button>` };
    if (!board.contains(cell)) return { problem: `cell-${i} is not inside the board` };
    const text = (cell.textContent ?? "").trim();
    if (text !== "X" && text !== "O" && text !== "") return { problem: `cell-${i} reads ${JSON.stringify(text)}: a cell's text is exactly X, O or empty` };
    cells += text || ".";
  }
  const status = only("status");
  if (typeof status === "string") return { problem: status };
  return { board: cells, status: (status.textContent ?? "").trim() };
});

/** The three selects: { mode: { value, options } | { problem }, … }. */
const readSelects = (page) => page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
  const all = document.querySelectorAll(`[data-testid="${id}"]`);
  if (all.length !== 1) return [id, { problem: `${all.length} elements with data-testid="${id}" (expected 1)` }];
  const el = all[0];
  if (el.tagName !== "SELECT") return [id, { problem: `${id} is a <${el.tagName.toLowerCase()}>, not a <select>` }];
  return [id, { value: el.value, options: [...el.options].map((o) => o.value) }];
})), Object.keys(SELECTS));

const describe = (s) => s.problem ?? `board ${show(s.board)}, status ${JSON.stringify(s.status)}`;

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

// ---- Playing -------------------------------------------------------------------------------------------

const click = (page, cell) => page.locator(`[data-testid="cell-${cell}"]`).click({ force: true, timeout: WAIT_MS });
const newGame = (page) => page.locator('[data-testid="new-game"]').click({ timeout: WAIT_MS });
const choose = (page, id, value) => page.locator(`[data-testid="${id}"]`).selectOption(value, { timeout: WAIT_MS });

/** Lets 1 second pass on the page's clock. */
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

/** Against the computer: mode cpu, then `difficulty`, then `first`, each change a new game. Returns the board, the computer's first move made. */
async function vsComputer(page, difficulty, first) {
  await choose(page, "mode", "cpu");
  await expectGame(page, EMPTY, "after mode changed to cpu");
  await choose(page, "difficulty", difficulty);
  await expectGame(page, EMPTY, `after difficulty changed to ${difficulty}`);
  if (first === "human") return EMPTY;
  await choose(page, "first", "computer");
  return computerMove(page, EMPTY, "X", "after first changed to computer, the computer plays X");
}

/**
 * The human plays `cell` on `board`; unless that ends the game, the computer answers within 1 second. With
 * `refuse`, every other empty cell is clicked while the computer still has to answer, and nothing may change.
 * Returns the board after both moves, and whether a click landed on the computer's turn.
 */
async function turn(page, board, cell, what, refuse = false) {
  const human = toMove(board);
  const mine = put(board, cell, human);
  await click(page, cell);
  const s = await until(page, (now) => now.board[cell] === human, `${what}: after the human plays ${cell}, expected ${human} there`);
  if (over(mine)) {
    await letTimePass(page);
    await expectUnchanged(page, { board: mine, status: statusOf(mine) }, `${what}: the game ended on the human's move ${cell}`);
    return { board: mine, refused: false };
  }
  let refused = false;
  if (refuse && s.board === mine) {
    for (const empty of empties(mine)) await click(page, empty);
    await expectUnchanged(page, s, `${what}: clicks on every empty cell while the computer has to answer ${cell}`);
    refused = true;
  }
  return { board: await computerMove(page, mine, other(human), `${what}: the computer's answer to ${cell}`), refused };
}

/** The human picks with `human(board)` until the game ends. Returns the final board and the human's cells. */
async function playOut(page, board, human, what, refuse = false) {
  const cells = [];
  let refused = 0;
  while (!over(board)) {
    const cell = human(board);
    cells.push(cell);
    const t = await turn(page, board, cell, `${what}, the human's cells ${cells.join(", ")}`, refuse);
    board = t.board;
    if (t.refused) refused++;
  }
  return { board, cells, refused };
}

// ---- The tests -----------------------------------------------------------------------------------------

await test("the mode, difficulty and first selects offer their options and start on pvp, easy and human", () =>
  onPage(async (page) => {
    const selects = await readSelects(page);
    for (const [id, values] of Object.entries(SELECTS)) {
      const s = selects[id];
      check(!s.problem, s.problem);
      check(s.options.length === values.length && values.every((v) => s.options.includes(v)),
        `${id} offers the values ${JSON.stringify(s.options)}; expected exactly ${values.join(" and ")}`);
      check(s.value === DEFAULTS[id], `${id} is ${JSON.stringify(s.value)} on a fresh page; expected ${DEFAULTS[id]}`);
    }
    await expectGame(page, EMPTY, "on a fresh page");
  }));

await test("with two players, the default, the computer never moves, whoever is first", () =>
  onPage(async (page) => {
    const board = await play(page, [4]);
    await letTimePass(page, 2 * COMPUTER_MS);
    await expectUnchanged(page, { board, status: statusOf(board) }, "two players, 2 s after X played 4");
    await choose(page, "first", "computer");
    await expectGame(page, EMPTY, "after first changed to computer, with two players");
    await letTimePass(page, 2 * COMPUTER_MS);
    await expectUnchanged(page, { board: EMPTY, status: statusOf(EMPTY) }, "two players with first on computer, 2 s after the new game");
    await play(page, [4, 0, 8]);
  }));

await test("changing mode, difficulty or first starts a new game", () =>
  onPage(async (page) => {
    await play(page, [4, 0]);
    await choose(page, "difficulty", "hard");
    await expectGame(page, EMPTY, "after difficulty changed to hard in the middle of a game");
    await play(page, [4]);
    await choose(page, "first", "computer");
    await expectGame(page, EMPTY, "after first changed to computer in the middle of a game");
    await play(page, [4]);
    await choose(page, "first", "human");
    await expectGame(page, EMPTY, "after first changed back to human in the middle of a game");
    await play(page, [4, 0, 8]);
    await choose(page, "mode", "cpu");
    await expectGame(page, EMPTY, "after mode changed to cpu in the middle of a game");
    await letTimePass(page, 2 * COMPUTER_MS);
    await expectUnchanged(page, { board: EMPTY, status: statusOf(EMPTY) }, "against the computer with the human first, 2 s after the new game");
    const { board } = await turn(page, EMPTY, 4, "against the computer");
    await play(page, [empties(board)[0]], board);
    await choose(page, "difficulty", "easy");
    await expectGame(page, EMPTY, "after difficulty changed to easy in the middle of a game against the computer");
    await turn(page, EMPTY, 0, "against easy");
    await choose(page, "mode", "pvp");
    await expectGame(page, EMPTY, "after mode changed back to pvp in the middle of a game");
    await play(page, [4, 0]);
  }));

await test("against the computer, it answers each move of the human with one legal move within 1 second", async () => {
  const rng = seeded(2);
  for (const difficulty of ["easy", "hard"])
    for (let game = 0; game < 3; game++)
      await onPage(async (page) => {
        const board = await vsComputer(page, difficulty, "human");
        await playOut(page, board, (b) => pick(rng, empties(b)), `against ${difficulty}, the human playing X`);
      });
});

await test("when the computer goes first, it plays X within 1 second of each new game, then answers each move", async () => {
  const rng = seeded(3);
  for (const difficulty of ["easy", "hard"])
    await onPage(async (page) => {
      let board = await vsComputer(page, difficulty, "computer");
      board = (await playOut(page, board, (b) => pick(rng, empties(b)), `against ${difficulty}, the human playing O`)).board;
      await newGame(page);
      board = await computerMove(page, EMPTY, "X", `against ${difficulty}, after New game once a game ended`);
      board = (await turn(page, board, empties(board)[0], `against ${difficulty}, the next game`)).board;
      await newGame(page);
      await computerMove(page, EMPTY, "X", `against ${difficulty}, after New game in the middle of a game`);
    });
});

await test("while it is the computer's turn, clicks on the board change nothing", async () => {
  const rng = seeded(4);
  let windows = 0;
  for (const difficulty of ["easy", "hard"])
    for (const first of ["human", "computer"])
      await onPage(async (page) => {
        let board = EMPTY;
        await choose(page, "mode", "cpu");
        await expectGame(page, EMPTY, "after mode changed to cpu");
        await choose(page, "difficulty", difficulty);
        await expectGame(page, EMPTY, `after difficulty changed to ${difficulty}`);
        if (first === "computer") {
          await choose(page, "first", "computer");
          const s = await read(page);
          if (!s.problem && s.board === EMPTY) {
            for (let cell = 0; cell < 9; cell++) await click(page, cell);
            await expectUnchanged(page, s, `against ${difficulty}, clicks on every cell before the computer's first move`);
            windows++;
          }
          board = await computerMove(page, EMPTY, "X", `against ${difficulty}, the computer's first move`);
        }
        const { refused } = await playOut(page, board, (b) => pick(rng, empties(b)), `against ${difficulty}, the human ${first === "human" ? "X" : "O"}`, true);
        windows += refused;
      });
  // An entry whose computer answers with no pause leaves no click to refuse: then there is nothing to check.
  process.stderr.write(`clicks refused on ${windows} computer's turns\n`);
});

await test("Easy plays at random: its answers to the same move vary", () =>
  onPage(async (page) => {
    await vsComputer(page, "easy", "human");
    const answers = new Set();
    for (let game = 0; game < 12; game++) {
      if (game) {
        await newGame(page);
        await expectGame(page, EMPTY, "after New game");
      }
      const { board } = await turn(page, EMPTY, 4, `game ${game + 1} against easy`);
      answers.add(empties(EMPTY).find((cell) => cell !== 4 && board[cell] === "O"));
    }
    check(answers.size >= 2, `easy answered X in the centre with the same cell in 12 games (${[...answers].join(", ")}); it plays any legal move, at random`);
  }));

await test("Hard never loses, as X or as O, whatever the human's first two moves", () =>
  onPage(async (page) => {
    const rng = seeded(5);
    // The human's first two moves go through every choice; then it plays its best, at random among equals,
    // which wins any position the computer has let slip.
    const best = (b) => pick(rng, bestMoves(b));
    const lost = [];
    await vsComputer(page, "hard", "human");
    for (let a = 0; a < 9; a++)
      for (let b = 0; b < 7; b++) {
        await newGame(page);
        let board = await expectGame(page, EMPTY, "after New game, the human first").then((s) => s.board);
        board = (await turn(page, board, a, `hard, the human X opening on ${a}`)).board;
        const second = empties(board)[b];
        board = (await turn(page, board, second, `hard, the human X on ${a} then ${second}`)).board;
        const end = await playOut(page, board, best, `hard, the human X on ${a} then ${second}`);
        if (winnerOf(end.board) === "X") lost.push(`as O: X played ${[a, second, ...end.cells].join(", ")}, ending ${show(end.board)}`);
      }
    await choose(page, "first", "computer");
    let opening = await computerMove(page, EMPTY, "X", "hard, the computer first");
    for (let a = 0; a < 8; a++)
      for (let b = 0; b < 6; b++) {
        if (a || b) {
          await newGame(page);
          opening = await computerMove(page, EMPTY, "X", "hard, after New game, the computer first");
        }
        const first = empties(opening)[a];
        let board = (await turn(page, opening, first, `hard, the human O on ${first}`)).board;
        if (over(board)) continue;
        const second = empties(board)[b];
        board = (await turn(page, board, second, `hard, the human O on ${first} then ${second}`)).board;
        const end = await playOut(page, board, best, `hard, the human O on ${first} then ${second}`);
        if (winnerOf(end.board) === "O") lost.push(`as X: O played ${[first, second, ...end.cells].join(", ")}, ending ${show(end.board)}`);
      }
    check(lost.length === 0, `hard lost ${lost.length} game(s) of 111:\n${lost.slice(0, 5).join("\n")}`);
  }));

await test("a game against the computer plays with no console error and no request outside the page's own server", async () => {
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
    const rng = seeded(6);
    let board = await vsComputer(page, "easy", "human");
    await playOut(page, board, (b) => pick(rng, empties(b)), "against easy");
    await choose(page, "difficulty", "hard");
    await choose(page, "first", "computer");
    board = await computerMove(page, EMPTY, "X", "against hard, the computer first");
    await playOut(page, board, (b) => pick(rng, empties(b)), "against hard");
    await letTimePass(page);
    await page.waitForTimeout(SETTLE_MS);
    check(errors.length === 0, errors.slice(0, 5).join("\n"));
  } finally {
    await page.close().catch(() => {});
  }
});

await ready?.then((a) => a.close(), () => {});
done();
