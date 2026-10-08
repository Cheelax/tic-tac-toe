// The report harness of the Launchpad check kit: records named tests and writes the report the gate
// reads, {"tests":[{"name","status"}]} at $LAUNCHPAD_GATE_OUT. Node built-ins only.
//
// The report is never empty and never green by accident:
// - as soon as the harness starts, the report holds one failed test, "the checks ran to the end";
// - done() replaces it with the results, and a check that ran no test reports that as a failure;
// - if the process ends before done() (a crash, an unsettled await, an early process.exit), the report
//   keeps the results so far plus that failed test, and the exit code is 1.
// The entry's code must never run in this process: start it with entry.mjs, in a child process.
import { renameSync, writeFileSync } from "node:fs";

export const FINISHED = "the checks ran to the end";
export const NO_TEST = "the checks ran at least one test";

/** Throws `msg` unless `cond` holds: the assertion every test uses. */
export function check(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * A harness: `await test(name, fn)` for each test, then `done()`. `out` is the report's path
 * ($LAUNCHPAD_GATE_OUT by default; nothing is written without one, the summary still prints).
 */
export function harness({ out = process.env.LAUNCHPAD_GATE_OUT } = {}) {
  const results = [];
  let finished = false;
  const write = (tests) => {
    if (!out) return;
    // Written whole, then renamed: the gate never reads half a report.
    const tmp = `${out}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ tests }));
    renameSync(tmp, out);
  };
  write([{ name: FINISHED, status: "failed" }]);
  process.on("exit", () => {
    if (finished) return;
    console.error(`FAIL ${FINISHED}: the check stopped before done()`);
    write([...results, { name: FINISHED, status: "failed" }]);
    process.exitCode = 1;
  });
  return {
    results,
    /** Runs one test: it passes if `fn` returns (or resolves) and fails if it throws. Names are unique. */
    async test(name, fn) {
      name = String(name);
      if (finished) throw new Error(`test "${name}" after done()`);
      if (results.some((r) => r.name === name)) {
        results.push({ name: `${name} (duplicate name)`, status: "failed" });
        console.error(`FAIL ${name}\n  two tests have this name: the gate matches tests by name`);
        return;
      }
      try {
        await fn();
        results.push({ name, status: "passed" });
      } catch (e) {
        results.push({ name, status: "failed" });
        console.error(`FAIL ${name}\n  ${String(e instanceof Error ? e.message : e).split("\n").join("\n  ")}`);
      }
    },
    /** Writes the report and exits: 1 if a test failed or none ran, else 0. */
    done() {
      finished = true;
      const tests = results.length ? results : [{ name: NO_TEST, status: "failed" }];
      write(tests);
      const failed = tests.filter((r) => r.status !== "passed").length;
      console.log(`${tests.length - failed}/${tests.length} checks passed`);
      process.exit(failed ? 1 : 0);
    },
  };
}
