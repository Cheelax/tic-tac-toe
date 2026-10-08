// .launchpad/checks/round-1/run.mjs: round 1's checks, "Two players, one screen". Run them from the
// repository's root (once per machine before: npx playwright-core install chromium-headless-shell):
//   node .launchpad/checks/round-1/run.mjs
//
// They build the entry (npm run build), serve dist/ and play the game in headless Chromium. The entry's
// code runs only in the build's child process and in the browser, never in this process: the report is
// this process's alone. Under the gate every process this one starts (the build, Chromium) runs as the
// entry's user, so Chromium gets a profile directory anyone can write.
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve, sep } from "node:path";
import { check, harness } from "./lib/harness.mjs";
import { entry, ROOT, succeeds, workspace } from "./lib/entry.mjs";

const { test, done } = harness();

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const WAIT_MS = 2_000; // how long the page has to show a move
const SETTLE_MS = 300; // how long a refused click is watched for a change

// ---- The game, as the checks expect it (never the entry's code) --------------------------------------

/** The board after `moves` (cells in play order, X first): a 9-character string of X, O and "." */
const boardOf = (moves) => {
  const b = Array(9).fill(".");
  moves.forEach((cell, k) => (b[cell] = k % 2 ? "O" : "X"));
  return b.join("");
};
/** The cells of every completed line on `board`, as a 9-character string of 1 (marked) and 0. */
const marksOf = (board) => {
  const m = Array(9).fill("0");
  for (const l of LINES) if (board[l[0]] !== "." && l.every((c) => board[c] === board[l[0]])) for (const c of l) m[c] = "1";
  return m.join("");
};
const show = (board) => `${board.slice(0, 3)}/${board.slice(3, 6)}/${board.slice(6)}`;

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
/** Builds the entry, serves dist/ and starts Chromium, once: every test waits for it, and fails with it. */
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
  return {
    origin,
    browser,
    async close() {
      await browser.close().catch(() => {});
      server.close();
    },
  };
})());

/** A fresh page on the game, its board on screen. */
async function open() {
  const { browser, origin } = await app();
  const page = await browser.newPage();
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

/** The page as the checks see it: { board, marks, status } or { problem }. */
const read = (page) => page.evaluate(() => {
  const only = (id) => {
    const all = document.querySelectorAll(`[data-testid="${id}"]`);
    return all.length === 1 ? all[0] : `${all.length} elements with data-testid="${id}" (expected 1)`;
  };
  const board = only("board");
  if (typeof board === "string") return { problem: board };
  let cells = "", marks = "";
  for (let i = 0; i < 9; i++) {
    const cell = only(`cell-${i}`);
    if (typeof cell === "string") return { problem: cell };
    if (cell.tagName !== "BUTTON") return { problem: `cell-${i} is a <${cell.tagName.toLowerCase()}>, not a <button>` };
    if (!board.contains(cell)) return { problem: `cell-${i} is not inside the board` };
    const text = (cell.textContent ?? "").trim();
    if (text !== "X" && text !== "O" && text !== "") return { problem: `cell-${i} reads ${JSON.stringify(text)}: a cell's text is exactly X, O or empty` };
    cells += text || ".";
    marks += cell.getAttribute("data-win") === "true" ? "1" : "0";
  }
  const status = only("status");
  if (typeof status === "string") return { problem: status };
  return { board: cells, marks, status: (status.textContent ?? "").trim() };
});

const describe = (s, want) =>
  s.problem ?? [`board ${show(s.board)}`, want.status !== undefined && `status ${JSON.stringify(s.status)}`,
    want.marks !== undefined && `marked ${show(s.marks)}`].filter(Boolean).join(", ");
const wanted = (want) =>
  [`board ${show(want.board)}`, want.status !== undefined && `status ${JSON.stringify(want.status)}`,
    want.marks !== undefined && `marked ${show(want.marks)}`].filter(Boolean).join(", ");
const matches = (s, want) =>
  !s.problem && s.board === want.board && (want.status === undefined || s.status === want.status) && (want.marks === undefined || s.marks === want.marks);

/** Waits until the page shows `want` ({ board, status?, marks? }); throws with what it shows instead. */
async function expectPage(page, want, what) {
  const until = Date.now() + WAIT_MS;
  let s;
  do {
    s = await read(page);
    if (matches(s, want)) return s;
    await page.waitForTimeout(25);
  } while (Date.now() < until);
  throw new Error(`${what}: expected ${wanted(want)}; the page shows ${describe(s, want)}`);
}

/** Watches the page for SETTLE_MS after a click that must change nothing. */
async function expectUnchanged(page, want, what) {
  const until = Date.now() + SETTLE_MS;
  do {
    const s = await read(page);
    if (!matches(s, want)) throw new Error(`${what}: the page changed to ${describe(s, want)}, expected it to stay ${wanted(want)}`);
    await page.waitForTimeout(25);
  } while (Date.now() < until);
}

const click = (page, cell) => page.locator(`[data-testid="cell-${cell}"]`).click({ force: true, timeout: WAIT_MS });

/** Plays `moves` from the empty board, each shown before the next. */
async function play(page, moves) {
  for (let k = 0; k < moves.length; k++) {
    await click(page, moves[k]);
    await expectPage(page, { board: boardOf(moves.slice(0, k + 1)) }, `after the moves ${moves.slice(0, k + 1).join(", ")}`);
  }
}

/** For each line, a game X wins on it at the 5th move, O on cells off the line. */
const xWins = LINES.map((l) => {
  const off = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !l.includes(c));
  return [l[0], off[0], l[1], off[1], l[2]];
});
/** For each line, a game O wins on it at the 6th move, X on three cells off the line that make no line. */
const oWins = LINES.map((l) => {
  const off = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !l.includes(c));
  for (let a = 0; a < off.length; a++)
    for (let b = a + 1; b < off.length; b++)
      for (let c = b + 1; c < off.length; c++) {
        const xs = [off[a], off[b], off[c]];
        if (!LINES.some((m) => m.every((x) => xs.includes(x)))) return [xs[0], l[0], xs[1], l[1], xs[2], l[2]];
      }
  throw new Error("no game for this line");
});
const DRAW = [0, 1, 2, 4, 3, 5, 7, 6, 8]; // X 0 2 3 7 8, O 1 4 5 6: no line
const NINTH_MOVE_WIN = [0, 1, 2, 4, 3, 5, 7, 8, 6]; // X completes 0 3 6 on the last cell
const DOUBLE_LINE_WIN = [1, 4, 2, 5, 3, 7, 6, 8, 0]; // X's last move completes 0 1 2 and 0 3 6

// ---- The tests -----------------------------------------------------------------------------------------

await test("the page shows an empty board of 9 buttons and the status X to play", () =>
  onPage(async (page) => {
    await expectPage(page, { board: ".........", status: "X to play", marks: "000000000" }, "on a fresh page");
  }));

await test("X and O take turns, and the status names who plays next", () =>
  onPage(async (page) => {
    const moves = [4, 0, 8, 2];
    for (let k = 0; k < moves.length; k++) {
      await click(page, moves[k]);
      await expectPage(page, { board: boardOf(moves.slice(0, k + 1)), status: k % 2 ? "X to play" : "O to play" },
        `after the moves ${moves.slice(0, k + 1).join(", ")}`);
    }
  }));

await test("X wins with three in a row on each of the 8 lines, and the status says X wins", async () => {
  for (const moves of xWins)
    await onPage(async (page) => {
      await play(page, moves);
      await expectPage(page, { board: boardOf(moves), status: "X wins" }, `after the moves ${moves.join(", ")}`);
    });
});

await test("O wins with three in a row on each of the 8 lines, and the status says O wins", async () => {
  for (const moves of oWins)
    await onPage(async (page) => {
      await play(page, moves);
      await expectPage(page, { board: boardOf(moves), status: "O wins" }, `after the moves ${moves.join(", ")}`);
    });
});

await test("only the cells of the winning lines have data-win set to true", async () => {
  for (const moves of [xWins[0], xWins[6], oWins[4], DOUBLE_LINE_WIN])
    await onPage(async (page) => {
      await play(page, moves.slice(0, -1));
      await expectPage(page, { board: boardOf(moves.slice(0, -1)), marks: "000000000" }, `before the winning move, after ${moves.slice(0, -1).join(", ")}`);
      await click(page, moves.at(-1));
      const board = boardOf(moves);
      await expectPage(page, { board, marks: marksOf(board) }, `after the winning move, the moves ${moves.join(", ")}`);
    });
});

await test("a full board with no line is a draw, and a win on the ninth move is a win", async () => {
  await onPage(async (page) => {
    await play(page, DRAW);
    await expectPage(page, { board: boardOf(DRAW), status: "Draw", marks: "000000000" }, `after the moves ${DRAW.join(", ")}`);
  });
  for (const moves of [NINTH_MOVE_WIN, DOUBLE_LINE_WIN])
    await onPage(async (page) => {
      await play(page, moves);
      await expectPage(page, { board: boardOf(moves), status: "X wins" }, `after the moves ${moves.join(", ")}`);
    });
});

await test("a click on an occupied cell changes nothing", () =>
  onPage(async (page) => {
    await click(page, 4);
    await expectPage(page, { board: boardOf([4]), status: "O to play" }, "after X plays 4");
    await click(page, 4);
    await expectUnchanged(page, { board: boardOf([4]), status: "O to play" }, "O clicks 4, X's cell");
    await click(page, 0);
    await expectPage(page, { board: boardOf([4, 0]), status: "X to play" }, "after O plays 0, an empty cell");
    await click(page, 0);
    await expectUnchanged(page, { board: boardOf([4, 0]), status: "X to play" }, "X clicks 0, O's cell");
    await click(page, 8);
    await expectPage(page, { board: boardOf([4, 0, 8]), status: "O to play" }, "after X plays 8, an empty cell");
  }));

await test("no move is accepted once the game is won", async () => {
  for (const moves of [xWins[0], oWins[3]])
    await onPage(async (page) => {
      // While the game is on, an empty cell takes a move.
      await play(page, moves);
      const board = boardOf(moves);
      const status = moves.length % 2 ? "X wins" : "O wins";
      await expectPage(page, { board, status }, `after the moves ${moves.join(", ")}`);
      for (const cell of [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => board[c] === ".")) {
        await click(page, cell);
        await expectUnchanged(page, { board, status }, `a click on the empty cell ${cell} once the game is won`);
      }
    });
});

await test("New game clears the board and the marks, and X plays first again", () =>
  onPage(async (page) => {
    const newGame = page.locator('[data-testid="new-game"]');
    await play(page, xWins[0]);
    await expectPage(page, { board: boardOf(xWins[0]), status: "X wins", marks: marksOf(boardOf(xWins[0])) }, "after X wins");
    await newGame.click({ timeout: WAIT_MS });
    await expectPage(page, { board: ".........", status: "X to play", marks: "000000000" }, "after New game, once X won");
    await play(page, [4]);
    await expectPage(page, { board: boardOf([4]), status: "O to play" }, "after X plays 4 in the new game");
    await newGame.click({ timeout: WAIT_MS });
    await expectPage(page, { board: ".........", status: "X to play", marks: "000000000" }, "after New game, with O to play");
    await play(page, [0]);
    await expectPage(page, { board: boardOf([0]), status: "O to play" }, "after the first move of the next game");
  }));

await test("a whole game plays with no console error and no request outside the page's own server", async () => {
  const { browser, origin } = await app();
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`console error: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
  page.on("request", (r) => {
    const url = r.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    let at = null;
    try {
      at = new URL(url).origin;
    } catch {}
    if (at !== origin) errors.push(`request outside the page's server: ${url}`);
  });
  page.on("response", (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} for ${r.url()}`));
  try {
    await page.goto(`${origin}/`, { waitUntil: "load", timeout: 15_000 });
    await page.locator('[data-testid="board"]').first().waitFor({ state: "attached", timeout: 5_000 })
      .catch(() => { throw new Error('the page has no [data-testid="board"] 5 s after it loaded'); });
    await play(page, DRAW);
    await expectPage(page, { board: boardOf(DRAW), status: "Draw" }, `after the moves ${DRAW.join(", ")}`);
    await page.locator('[data-testid="new-game"]').click({ timeout: WAIT_MS });
    await play(page, xWins[3]);
    await expectPage(page, { board: boardOf(xWins[3]), status: "X wins" }, `after the moves ${xWins[3].join(", ")}`);
    await page.waitForTimeout(SETTLE_MS);
    check(errors.length === 0, errors.slice(0, 5).join("\n"));
  } finally {
    await page.close().catch(() => {});
  }
});

await ready?.then((a) => a.close(), () => {});
done();
