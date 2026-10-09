# The Launchpad check kit

Helpers for a round's checks, with Node built-ins only. Copy them into the round's check directory
(`.launchpad/checks/round-<n>/lib/`) and import them from its `run.mjs`. The guide is the page
`/docs/writing-checks` on the launchpad site you got the kit from (`<site>/docs/writing-checks`): it
covers `check.json`, the report, these helpers and how to prove your checks with the gate script.

| File | What it gives |
| --- | --- |
| `harness.mjs` | `harness()`: `await test(name, fn)` for each test, then `done()`, which writes `{"tests":[{"name","status"}]}` to `$LAUNCHPAD_GATE_OUT` and exits 1 if a test failed. `check(cond, msg)`. |
| `entry.mjs` | `entry(command, args)`: runs the entry in a child process with a clean environment, a time limit and an output limit. `input(value)`: an input file any user can read. `succeeds()`, `refuses()`. |
| `xml.mjs` | `parseXml()`: a strict XML parser (no DOCTYPE, no bare `&` or `<`), with `walk()`, `textOf()`, `localName()`. |

What they guarantee, whichever gate runs them (the one that runs the check as the entry's user, or the
one that runs it as root and the entry as user 1000):

- **The entry's code runs only in child processes.** It can exit 0, print anything or write files: the
  test that ran it fails, and the report is the harness's own.
- **The report is never empty.** It holds a failed test from the moment the harness starts until
  `done()`; a check that runs no test, crashes or stops early reports a failure and exits 1.
- **Inputs are readable by another user.** The entry may run as another user than the check: inputs
  are mode 644 in a directory of mode 755, and the entry gets its own writable `HOME` and `TMPDIR`.
- **What a run leaves behind ends with it.** Each run is its own process group, killed when the entry
  exits or times out. A process that starts its own session (`setsid`, `detached`) leaves the group: the
  gate ends it with the check's container, and in the runner it cannot reach the report.

```js
// .launchpad/checks/round-1/run.mjs
import { check, harness } from "./lib/harness.mjs";
import { entry, input, refuses, succeeds } from "./lib/entry.mjs";

const { test, done } = harness();
const cli = entry("node", ["cli.mjs"]);

await test("sums two numbers", async () => {
  const r = await succeeds(cli, [input({ a: 2, b: 3 })]);
  check(r.out.trim() === "5", `printed ${JSON.stringify(r.out)}, expected "5"`);
});
await test("refuses a file that is not JSON", async () => {
  await succeeds(cli, [input({ a: 1, b: 1 })]); // an entry that refuses everything does not pass
  await refuses(cli, [input("{ nope")], "invalid JSON");
});

done();
```

The site serves the current version of each file at `<site>/kit/checks/<file>` (`harness.mjs`,
`entry.mjs`, `xml.mjs`, this `README.md`): fetch them again to update a copy.
