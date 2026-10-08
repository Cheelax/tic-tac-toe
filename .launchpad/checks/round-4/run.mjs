// .launchpad/checks/round-4/run.mjs: round 4's checks, "Share a game". Run them from the repository's root
// (once per machine before: npx playwright-core install chromium-headless-shell):
//   node .launchpad/checks/round-4/run.mjs
//
// They build the entry (npm run build), serve dist/ and open it in headless Chromium: links that replay a game,
// the link the page shows and copies, bad links refused. Every page runs on Playwright's fake clock, paused (the
// computer never has to move here, but round 2's timers must not run away). Each page starts with an empty
// localStorage. The entry's code runs only in the build's child process and in the browser, never in this process:
// the report is this process's alone. Under the gate every process this one starts (the build, Chromium) runs as the
// entry's user, so Chromium gets a profile directory anyone can write.
//
// What the brief settles here (the contract the checks hold an entry to):
// - `?game=<cells>` opens that game in two-player mode (mode pvp, whatever was chosen before) with its history;
//   `?game=` empty, or no `game` at all, is the empty game. The address bar may or may not follow the game.
// - share-url's text (or its value, for an input) is the full link of the position shown: the page's origin and
//   path, and `game=` the cells shown in order; for the empty board, no `game` or an empty one. It follows every
//   move and every jump in the history. copy-link is a button that copies that link with navigator.clipboard.writeText.
// - A bad link shows one element data-testid="error" with a non-empty reason, the empty board, `X to play`, and the
//   page still plays. Bad: any character but the digits 0 to 8, a cell twice, a move after the game ended, more
//   than 9 moves.
// - A game opened from a link counts in the score when it ends on this page, not when it is opened; a link to a
//   finished game counts nothing.
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve, sep } from "node:path";
import { check, harness } from "./lib/harness.mjs";
import { entry, ROOT, succeeds, workspace } from "./lib/entry.mjs";

const { test, done } = harness();

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const WAIT_MS = 2_000; // how long the page has to show a click, a link or a new game (real time)
const SETTLE_MS = 300; // how long a refused click is watched (real time)

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
/** A seeded random generator (mulberry32): the games played are the same on every run. */
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
  await browser.clock.install({ time: 0 });
  await browser.clock.pauseAt(1_000);
  // What copy-link copies is read here: navigator.clipboard.writeText records its text on the page (the real
  // clipboard of a headless browser cannot be read back reliably).
  await browser.addInitScript(() => {
    const real = navigator.clipboard;
    const copied = { text: null };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          copied.text = String(text);
          await real?.writeText?.(text).catch(() => {});
        },
        readText: async () => copied.text ?? "",
        write: async (...args) => real?.write?.(...args),
        read: async (...args) => real?.read?.(...args),
      },
    });
    Object.defineProperty(window, "__copied", { get: () => copied.text });
  });
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
 * A fresh page on the game at `path` (`/` or `/?game=…`), its board on screen, its localStorage empty (the profile is
 * shared by every page: the score of an earlier check must not leak into this one); `listen(page)` runs before it loads.
 */
async function open(path = "/", listen) {
  const { browser, origin } = await app();
  const page = await browser.newPage();
  listen?.(page, origin);
  await page.goto(`${origin}/`, { waitUntil: "load", timeout: 15_000 });
  await page.evaluate(() => localStorage.clear());
  await goto(page, path);
  return page;
}

/** Loads `path` on the page's server. */
async function goto(page, path) {
  const { origin } = await app();
  await page.goto(`${origin}${path}`, { waitUntil: "load", timeout: 15_000 });
  await waitForBoard(page);
}

/** Runs `fn(page)` on a fresh page at `path`, closed afterwards. */
async function onPage(path, fn) {
  const page = await open(path);
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

/** The link share-url shows: { link } or { problem }. An input's value, else the element's text. */
const readShare = (page) => page.evaluate(() => {
  const all = document.querySelectorAll('[data-testid="share-url"]');
  if (all.length !== 1) return { problem: `${all.length} elements with data-testid="share-url" (expected 1)` };
  const el = all[0];
  const value = "value" in el && typeof el.value === "string" && el.value.trim() ? el.value.trim() : (el.textContent ?? "").trim();
  if (!value) return { problem: "share-url is empty: it shows the current game's full link" };
  const copy = document.querySelectorAll('[data-testid="copy-link"]');
  if (copy.length !== 1) return { problem: `${copy.length} elements with data-testid="copy-link" (expected 1)` };
  if (copy[0].tagName !== "BUTTON") return { problem: `copy-link is a <${copy[0].tagName.toLowerCase()}>, not a <button>` };
  return { link: value };
});

/** The error the page shows: { error } (its text) or { error: null } when there is none, or { problem }. */
const readError = (page) => page.evaluate(() => {
  const all = document.querySelectorAll('[data-testid="error"]');
  if (all.length === 0) return { error: null };
  if (all.length > 1) return { problem: `${all.length} elements with data-testid="error" (expected at most 1)` };
  return { error: (all[0].textContent ?? "").trim() };
});

/** The history as the checks see it: { n } (history-0 … history-n) or { problem }; round 3's hooks. */
const readHistory = (page) => page.evaluate(() => {
  const ids = [...document.querySelectorAll('[data-testid^="history-"]')].map((el) => el.getAttribute("data-testid"));
  const indexes = ids.map((id) => (/^history-(\d+)$/.test(id) ? Number(id.slice(8)) : null)).sort((a, b) => a - b);
  for (let k = 0; k < indexes.length; k++) if (indexes[k] !== k) return { problem: `history buttons ${ids.join(", ")}: expected history-0 … history-${indexes.length - 1}` };
  return { n: indexes.length - 1 };
});

const selectValue = (page, id) => page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.value ?? null, id);

/** The score as round 3 shows it: { x, o, draw } or { problem }. */
const readScore = (page) => page.evaluate(() => {
  const out = {};
  for (const [key, id] of [["x", "score-x"], ["o", "score-o"], ["draw", "score-draw"]]) {
    const all = document.querySelectorAll(`[data-testid="${id}"]`);
    if (all.length !== 1) return { problem: `${all.length} elements with data-testid="${id}" (expected 1)` };
    const text = (all[0].textContent ?? "").trim();
    if (!/^\d+$/.test(text)) return { problem: `${id} reads ${JSON.stringify(text)}: its text is a whole number` };
    out[key] = Number(text);
  }
  return out;
});

const describe = (s) => s.problem ?? `board ${show(s.board)}, status ${JSON.stringify(s.status)}${s.wins?.length ? `, winning cells ${s.wins.join(", ")}` : ""}`;

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

/** Waits until the page shows `board`, its status and exactly its winning marks. */
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

/** The `game` a link carries, as moves: [] for none or empty; null when the link is not a URL of the page's origin. */
async function movesOfLink(page, link) {
  const { origin } = await app();
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const game = url.searchParams.get("game") ?? "";
  return [...game].map(Number);
}

/** Waits until share-url shows the link of `moves` (the page's origin, `game=` those cells; none or empty for no move). Returns the link. */
async function expectLink(page, moves, what) {
  const end = Date.now() + WAIT_MS;
  let s;
  do {
    s = await readShare(page);
    if (!s.problem) {
      const got = await movesOfLink(page, s.link);
      if (got && got.join("") === moves.join("")) return s.link;
    }
    await page.waitForTimeout(25);
  } while (Date.now() < end);
  const { origin } = await app();
  throw new Error(`${what}: expected share-url to show ${origin}/…?game=${moves.join("")} (the page's origin, game= the cells shown); ${s.problem ?? `it shows ${JSON.stringify(s.link)}`}`);
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

/** Waits until the score reads `want`. */
async function expectScore(page, want, what) {
  const end = Date.now() + WAIT_MS;
  let s;
  do {
    s = await readScore(page);
    if (!s.problem && s.x === want.x && s.o === want.o && s.draw === want.draw) return s;
    await page.waitForTimeout(25);
  } while (Date.now() < end);
  throw new Error(`${what}: expected the score X ${want.x}, O ${want.o}, draws ${want.draw}; ${s.problem ?? `the page shows X ${s.x}, O ${s.o}, draws ${s.draw}`}`);
}

/** Waits until the page shows an error with a reason, the empty board and X to play. Returns the reason. */
async function expectBadLink(page, what) {
  await expectGame(page, EMPTY, `${what}: a bad link shows the empty board`);
  const end = Date.now() + WAIT_MS;
  let e;
  do {
    e = await readError(page);
    if (!e.problem && e.error) return e.error;
    await page.waitForTimeout(25);
  } while (Date.now() < end);
  throw new Error(`${what}: ${e.problem ?? 'expected one [data-testid="error"] with the reason the link is refused; the page shows none'}`);
}

// ---- Playing -------------------------------------------------------------------------------------------

const click = (page, cell) => page.locator(`[data-testid="cell-${cell}"]`).click({ force: true, timeout: WAIT_MS });
const newGame = (page) => page.locator('[data-testid="new-game"]').click({ timeout: WAIT_MS });
const copyLink = (page) => page.locator('[data-testid="copy-link"]').click({ timeout: WAIT_MS });
const jump = (page, k) => page.locator(`[data-testid="history-${k}"]`).click({ timeout: WAIT_MS });
const choose = (page, id, value) => page.locator(`[data-testid="${id}"]`).selectOption(value, { timeout: WAIT_MS });

/** Two players: plays `moves` from `board`, each shown before the next. Returns the board. */
async function play(page, moves, board = EMPTY) {
  for (const cell of moves) {
    board = put(board, cell, toMove(board));
    await click(page, cell);
    await expectGame(page, board, `after a click on ${cell}`);
  }
  return board;
}

/** The cells of a whole random game, X first, until it ends. */
function randomGame(rng) {
  const moves = [];
  let board = EMPTY;
  while (!over(board)) {
    const cell = pick(rng, empties(board));
    moves.push(cell);
    board = put(board, cell, toMove(board));
  }
  return moves;
}

const X_WINS = [0, 3, 1, 4, 2]; // X on the top row
const DRAW = [0, 1, 2, 4, 3, 5, 7, 6, 8];
const SHARED = [4, 0, 8, 5, 2]; // the brief's example, X 4, O 0, X 8, O 5, X 2

// ---- The tests -----------------------------------------------------------------------------------------

await test("?game=<cells> opens that game in two-player mode, with its board, status, marks and history, and play goes on from there", async () => {
  await onPage(`/?game=${SHARED.join("")}`, async (page) => {
    await expectPosition(page, boardAfter(SHARED), "opening ?game=40852");
    check((await selectValue(page, "mode")) === "pvp", `opening a link, mode is ${JSON.stringify(await selectValue(page, "mode"))}; expected pvp (two players)`);
    await expectHistory(page, 5, "opening ?game=40852");
    const e = await readError(page);
    check(!e.problem && e.error === null, e.problem ?? `opening a valid link, the page shows an error: ${JSON.stringify(e.error)}`);
    await play(page, [1], boardAfter(SHARED));
    await expectHistory(page, 6, "after a move on the opened game");
    await jump(page, 2);
    await expectPosition(page, boardAfter(SHARED.slice(0, 2)), "after a click on history-2 of the opened game");
  });
  await onPage(`/?game=${X_WINS.join("")}`, async (page) => {
    const won = boardAfter(X_WINS);
    const s = await expectPosition(page, won, "opening a link to a won game (X on the top row)");
    await click(page, 5);
    await expectUnchanged(page, s, "a click on a won game opened from a link");
    await expectHistory(page, 5, "opening a link to a won game");
  });
  await onPage(`/?game=${DRAW.join("")}`, async (page) => {
    await expectPosition(page, boardAfter(DRAW), "opening a link to a draw");
  });
  await onPage("/?game=", async (page) => {
    await expectPosition(page, EMPTY, "opening ?game= (empty)");
    const e = await readError(page);
    check(!e.problem && e.error === null, e.problem ?? `opening ?game= (empty), the page shows an error: ${JSON.stringify(e.error)}`);
    await expectHistory(page, 0, "opening ?game= (empty)");
  });
  // The mode chosen before a link is opened does not matter: a link is a two-player game.
  await onPage("/", async (page) => {
    await choose(page, "mode", "cpu");
    await expectGame(page, EMPTY, "after mode changed to cpu");
    await goto(page, `/?game=${SHARED.join("")}`);
    await expectPosition(page, boardAfter(SHARED), "opening ?game=40852 after cpu was chosen");
    check((await selectValue(page, "mode")) === "pvp", `opening a link after cpu was chosen, mode is ${JSON.stringify(await selectValue(page, "mode"))}; expected pvp`);
  });
});

await test("share-url shows the current game's full link, updated after every move and every jump in the history, and copy-link copies it to the clipboard", () =>
  onPage("/", async (page) => {
    await expectLink(page, [], "on a fresh page");
    let board = EMPTY;
    const moves = [];
    for (const cell of SHARED) {
      moves.push(cell);
      board = await play(page, [cell], board);
      await expectLink(page, moves, `after the move ${cell}`);
    }
    const link = await expectLink(page, SHARED, "after 5 moves");
    await copyLink(page);
    const end = Date.now() + WAIT_MS;
    let copied;
    do {
      copied = await page.evaluate(() => window.__copied);
      if (copied === link) break;
      await page.waitForTimeout(25);
    } while (Date.now() < end);
    check(copied === link, `after a click on copy-link, the clipboard holds ${JSON.stringify(copied)}; expected the link share-url shows, ${link} (navigator.clipboard.writeText)`);
    // A jump in the history: the link follows the position shown.
    await jump(page, 2);
    await expectPosition(page, boardAfter(SHARED.slice(0, 2)), "after a click on history-2");
    await expectLink(page, SHARED.slice(0, 2), "after a click on history-2");
    await jump(page, 0);
    await expectLink(page, [], "after a click on history-0");
    await jump(page, 5);
    await expectLink(page, SHARED, "after a click on history-5");
    // A move from the past drops the later moves: the link too.
    await jump(page, 1);
    await play(page, [2], boardAfter([4]));
    await expectLink(page, [4, 2], "after O plays 2 from history-1");
    await newGame(page);
    await expectGame(page, EMPTY, "after New game");
    await expectLink(page, [], "after New game");
  }));

await test("every valid game round-trips through its link: shared after each move, opened on a fresh page, the same position", async () => {
  const rng = seeded(4);
  const { browser } = await app();
  for (let g = 0; g < 3; g++) {
    const moves = randomGame(rng);
    await onPage("/", async (page) => {
      let board = EMPTY;
      for (let k = 0; k < moves.length; k++) {
        board = await play(page, [moves[k]], board);
        const link = await expectLink(page, moves.slice(0, k + 1), `game ${g + 1}, after the move ${moves[k]}`);
        if (k % 2 === 1 || k === moves.length - 1) {
          const other = await browser.newPage();
          try {
            await other.goto(link, { waitUntil: "load", timeout: 15_000 });
            await waitForBoard(other);
            await expectPosition(other, board, `game ${g + 1}, the link ${link} opened on a fresh page`);
            await expectHistory(other, k + 1, `game ${g + 1}, the link ${link} opened on a fresh page`);
            await expectLink(other, moves.slice(0, k + 1), `game ${g + 1}, the link ${link} opened on a fresh page shares the same game`);
          } finally {
            await other.close().catch(() => {});
          }
        }
      }
    });
  }
});

await test("a bad link shows error with the reason, an empty board and X to play, and the page still plays: letters, a 9, a cell twice, a move after the end, more than 9 moves, 50 digits", async () => {
  const bad = [
    ["abc", "letters"], ["4a", "a letter among the digits"], ["4,0", "a comma"], ["9", "the digit 9 (cells are 0 to 8)"], ["44", "the cell 4 played twice"], ["4084", "the cell 4 played twice, later"],
    [`${X_WINS.join("")}8`, "a move after X won"], [`${DRAW.join("")}`.slice(0, 9) + "0", "a tenth move"], ["01234567801234567801234567801234567801234567801234", "50 digits"], ["-1", "a minus sign"], ["4 0", "a space"],
  ];
  const reasons = [];
  for (const [value, what] of bad) {
    await onPage(`/?game=${encodeURIComponent(value)}`, async (page) => {
      const reason = await expectBadLink(page, `opening ?game=${value} (${what})`);
      reasons.push(`${value}: ${reason}`);
      await expectLink(page, [], `opening ?game=${value} (${what}): the link of the empty board`);
      await play(page, [4]);
      await expectLink(page, [4], `after X plays 4 following the bad link ?game=${value}`);
    });
  }
  process.stderr.write(`bad links refused with:\n${reasons.map((r) => `  ${r}`).join("\n")}\n`);
});

await test("a link to a finished game shows it finished and counts nothing; a game opened from a link counts when it ends here; New game empties the link", async () => {
  await onPage(`/?game=${X_WINS.join("")}`, async (page) => {
    await expectPosition(page, boardAfter(X_WINS), "opening a link to a won game");
    await expectScore(page, { x: 0, o: 0, draw: 0 }, "opening a link to a won game: it counts nothing");
    await page.reload({ waitUntil: "load", timeout: 15_000 });
    await waitForBoard(page);
    await expectScore(page, { x: 0, o: 0, draw: 0 }, "after a reload of a link to a won game");
  });
  await onPage(`/?game=${X_WINS.slice(0, 4).join("")}`, async (page) => {
    await expectPosition(page, boardAfter(X_WINS.slice(0, 4)), "opening a link to a game X is about to win");
    await expectScore(page, { x: 0, o: 0, draw: 0 }, "opening a link to an unfinished game");
    await play(page, [2], boardAfter(X_WINS.slice(0, 4)));
    await expectScore(page, { x: 1, o: 0, draw: 0 }, "after X wins the game opened from a link");
    await expectLink(page, X_WINS, "after X wins the game opened from a link");
    await newGame(page);
    await expectGame(page, EMPTY, "after New game");
    await expectLink(page, [], "after New game: the link of the empty board");
    await expectHistory(page, 0, "after New game");
    await expectScore(page, { x: 1, o: 0, draw: 0 }, "after New game");
  });
});

await test("opening links, sharing and bad links log no console error and make no request outside the page's own server", async () => {
  const errors = [];
  const listen = (p, origin) => {
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
  };
  const page = await open(`/?game=${SHARED.join("")}`, listen);
  try {
    await expectPosition(page, boardAfter(SHARED), "opening ?game=40852");
    await play(page, [1], boardAfter(SHARED));
    await copyLink(page);
    await goto(page, "/?game=abc");
    await expectBadLink(page, "opening ?game=abc");
    await goto(page, "/?game=01234567801234567801234567801234567801234567801234");
    await expectBadLink(page, "opening a link of 50 digits");
    await play(page, [4]);
    await goto(page, "/");
    await play(page, X_WINS);
    await copyLink(page);
    await page.waitForTimeout(SETTLE_MS);
    check(errors.length === 0, errors.slice(0, 5).join("\n"));
  } finally {
    await page.close().catch(() => {});
  }
});

await ready?.then((a) => a.close(), () => {});
done();
