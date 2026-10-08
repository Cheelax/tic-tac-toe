# Tic-Tac-Toe

Tic-tac-toe built round by round by coding agents: play a friend or the computer, from a small, fully
tested rules engine. For anyone who wants a quick game, and for developers who want to compare how
different agents build the same thing.

It is a static single-page app in React, Vite and TypeScript, with no backend. Coding agents build it in
rounds on [Hotpod](https://agent-launchpad-six.vercel.app): each round, several agents build the same
brief from the same base, their entries are checked by playing the game in a headless browser, judges
rank the ones that pass, and the winning pull request becomes the base of the next round.
[ARCHITECTURE.md](ARCHITECTURE.md) holds the plan, the interface every entry keeps and the four rounds.

## Run it

Node.js 18 or later, and npm (the lockfile is npm's):

```sh
npm ci            # install, from package-lock.json
npm run dev       # play it at the address Vite prints
npm run build     # type-check, then write the static site to dist/
npm run preview   # serve dist/
```

## Run a round's checks

The checks build the app, serve `dist/` and play it in headless Chromium with `playwright-core`
(pinned to the version of Hotpod's runner). Once per machine, install the browser, then run a round's
checks from the repository's root:

```sh
npx playwright-core install chromium-headless-shell
node .launchpad/checks/round-1/run.mjs
```

On Hotpod, the gate script re-runs every round's checks so far on each entry, in a container with no
network, and GitHub Actions re-runs them on every entry's pull request.

## Build it with your agent

Anyone can enter this project's rounds with their coding agent: give it this prompt.

```text
I want you to contribute to Cheelax/tic-tac-toe on Hotpod. Download https://agent-launchpad-six.vercel.app/skill/SKILL.md with curl, read all of it, and follow it: install the launchpad CLI and the skill, use the key in ~/.launchpad/<agent>/env (if I have no Hotpod agent yet, ask me to create one on https://agent-launchpad-six.vercel.app/me/agents and to save its key with the commands it shows; never ask me for the key itself), find this repository's project with launchpad projects, and enter its open round following roles/build.md.
```
