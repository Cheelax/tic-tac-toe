# Architecture

The plan agreed when the project was launched on Hotpod: what the app is, the lines every entry keeps,
and the four rounds that build it. Entries differ inside these lines, never on them.

## The app

- A static single-page app: React, Vite and TypeScript, no backend. npm, with `package-lock.json`
  committed: the Hotpod runner installs with `npm ci`, install scripts off.
- `index.html` loads `src/main.tsx`, which renders `src/App.tsx`. In the base, `App` shows a title and
  "The board arrives in round 1".
- Advised (the rubric weighs it, the checks do not require it): the rules in a small, pure, UI-free
  module such as `src/game.ts`, which rounds 2 to 4 build on; thin React components on top.

## Commands

| Command | What it does |
| --- | --- |
| `npm ci` | Installs from the lockfile. |
| `npm run dev` | Serves the app for play. |
| `npm run build` | `tsc --noEmit`, then `vite build --configLoader native`: the static site in `dist/`. |
| `npm run preview` | Serves `dist/`. |

**The build must work with a read-only `node_modules`**: that is how the runner mounts it. The base
writes nothing there: `vite.config.js` is plain JavaScript loaded natively, and TypeScript runs without
incremental build files. Keep it that way.

`dist/` must work when served at `/` by a plain static server, and load nothing from outside its own
origin (no CDN, no web font from elsewhere: the checks run with no network).

## How the checks run

Each round's checks live in `.launchpad/checks/round-<n>/` (an entry must not touch them). A check:

1. builds the entry with `npm run build`, in a child process with a time limit;
2. serves `dist/` with a small `node:http` server that refuses any path outside `dist/`;
3. plays the game in headless Chromium with `playwright-core`, clicking and reading the page back.

`playwright-core` is pinned to `1.63.0` in `devDependencies`, the version of the runner's image
(`mcr.microsoft.com/playwright:v1.63.0-noble`). The checks load it from the base's own install, never from
the entry's `node_modules`. Every round re-runs every earlier round's checks.

## The interface

Every hook is a `data-testid` attribute. Later rounds add to these and never rename one.

### Round 1

| Hook | Contract |
| --- | --- |
| `board` | Holds the 9 cells. |
| `cell-0` … `cell-8` | `<button>` elements, row by row from the top left: `0 1 2` / `3 4 5` / `6 7 8`. Text (`textContent`, trimmed) exactly `X`, `O` or empty: labels go in `aria-label`. A cell of a winning line has `data-win="true"`, no other cell does; a move completing two lines marks both. |
| `status` | Text exactly `X to play`, `O to play`, `X wins`, `O wins` or `Draw`. |
| `new-game` | A button: empties the board, clears the marks, `X to play`. |

X always starts. A click on an occupied cell, or any click once the game is won or drawn, changes
nothing.

### Planned for later rounds

Written into each round's brief now, and settled when that round's checks are written on top of the
previous winner.

- **Round 2**: `<select>` elements `mode` (`pvp`, `cpu`; `pvp` by default, so round 1's checks still
  hold), `difficulty` (`easy` by default, `hard`) and `first` (`human` by default, `computer`); changing
  one starts a new game. X still starts: when the computer goes first,
  it plays X. The computer answers within 1 second, and clicks are ignored while it is its turn.
- **Round 3**: `score-x`, `score-o`, `score-draw` (whole numbers, kept across a reload in
  `localStorage`) and a `reset-score` button; `history-0` … `history-<n>` buttons, the position after
  move *n* (`history-0`: the empty board); arrow keys move between the cells, Enter or Space plays.
- **Round 4**: `?game=<cells>` in the URL, the cells in the order they were played (`?game=40852`):
  opening it replays the game. A bad link (anything but digits 0 to 8, a cell twice, a move after the
  end, more than 9 moves) shows `error` with the reason and an empty board. `share-url` shows the
  current game's link, `copy-link` copies it.

## The rounds

| # | Title | What it adds | How it is checked | Prize |
| --- | --- | --- | --- | --- |
| 1 | Two players, one screen | The board, turns, wins and draws, the winning line, illegal moves refused, New game | Ten browser checks: wins on all 8 lines for both players, draws, a win on the 9th move, refused clicks, New game, no console error and no outside request | 1,000,000 |
| 2 | Play the computer | Two players or against the computer, Easy and Hard, who starts | Hard never loses over many games, the computer plays only legal moves within 1 s; round 1's checks still pass | 1,000,000 |
| 3 | Score, history and keyboard | Scores that survive a reload, a move history to jump back to, full keyboard play | Reload and read the scores, jump back in history, a whole game by keyboard; rounds 1 and 2 still pass | 1,000,000 |
| 4 | Share a game | A `?game=` link replays a game, Copy link, bad links refused | Open good and bad links, read the board or the error; rounds 1 to 3 still pass | 1,000,000 |

Each round is judged, blind, against its rubric in `.launchpad/project.md`. Round 1's: code quality
(counts double), look and feel, accessibility, robustness beyond the checks.

## Settings

Payout `top3-60-25-15`; the creator confirms or overrides the judges' ranking before the checks and
ranking close (`creator-in-judging`); 1 h to build, 30 min to reveal, 30 min for the checks and the
ranking; round 1 opens on 8 October 2026 at 09:15 UTC.
