// The entry runner of the Launchpad check kit: runs the entry's command in a child process, never in the
// check's own, with a clean environment, a time limit and an output limit, and writes the inputs it
// reads where any user can read them. Node built-ins only.
//
// Why: the gate trusts only the report the check writes. Code that runs in the check's process could
// write that report itself or exit 0 early; code in a child can only answer. Under the gate the check
// may run as root and the entry as another user (1000): inputs are made readable by anyone, and the
// entry gets its own writable HOME and scratch directory. Each run's whole process group is killed when
// the entry exits or times out, so what it left running in that group ends with it. A process that
// leaves the group (setsid, detached) is beyond a check's reach: the gate ends it with the check's
// container. Under the gate it cannot reach the report either way.
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The entry's root: the gate runs a check from it. */
export const ROOT = process.cwd();

let dirs;
/** The kit's directories: `inputs` (readable by anyone), `home` and `scratch` (writable by anyone). */
export function workspace() {
  if (dirs) return dirs;
  const base = mkdtempSync(join(tmpdir(), "launchpad-check-"));
  dirs = { base, inputs: join(base, "inputs"), home: join(base, "home"), scratch: join(base, "scratch") };
  // Every mode is set explicitly, whatever the umask: the entry may run as another user.
  chmodSync(base, 0o755);
  for (const [d, mode] of [[dirs.inputs, 0o755], [dirs.home, 0o1777], [dirs.scratch, 0o1777]]) {
    mkdirSync(d);
    chmodSync(d, mode);
  }
  return dirs;
}

let inputs = 0;
/**
 * Writes an input file the entry will read (an object or array as JSON, a string or Buffer as is) and
 * returns its absolute path. `name` keeps an extension the entry may look at (`input-3.csv`).
 */
export function input(value, name) {
  const { inputs: dir } = workspace();
  const path = join(dir, name ?? `input-${++inputs}.json`);
  writeFileSync(path, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2));
  chmodSync(path, 0o644);
  return path;
}

const live = new Set();
const killGroup = (pid) => {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {}
};
process.on("exit", () => {
  for (const pid of live) killGroup(pid);
});

/**
 * The entry's command, ready to run: `const card = entry("node", ["card.mjs"])`, then
 * `await card(["in.json"])` gives `{ code, signal, out, err, cmd }`. "node" is the Node running the
 * check. Options (at creation, or per run): `cwd` (the entry's root), `timeoutMs` (10 s), `maxBytes`
 * of stdout and of stderr (1 MB), `env` (added to the clean environment), `stdin` (a string or Buffer).
 * A run that times out or writes too much throws: the test that started it fails.
 */
export function entry(command, baseArgs = [], defaults = {}) {
  return (args = [], o = {}) => runEntry(command, [...baseArgs, ...args], { ...defaults, ...o });
}

/** One run of `command args` (see entry()). */
export function runEntry(command, args, { cwd = ROOT, timeoutMs = 10_000, maxBytes = 1024 * 1024, env = {}, stdin } = {}) {
  const ws = workspace();
  const cmd = [command, ...args].join(" ");
  const clean = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: ws.home, TMPDIR: ws.scratch, LANG: "C.UTF-8", TZ: "UTC", ...env };
  return new Promise((resolve, reject) => {
    const child = spawn(command === "node" ? process.execPath : command, args, { cwd, env: clean, detached: true, stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    if (child.pid) live.add(child.pid);
    const out = [], err = [];
    let outBytes = 0, errBytes = 0, why = null;
    const stop = (reason) => {
      why ??= reason;
      if (child.pid) killGroup(child.pid);
    };
    const timer = setTimeout(() => stop(`${cmd} took more than ${timeoutMs / 1000} s`), timeoutMs);
    child.stdout.on("data", (d) => {
      if ((outBytes += d.length) > maxBytes) return stop(`${cmd} wrote more than ${maxBytes} bytes on stdout`);
      out.push(d);
    });
    child.stderr.on("data", (d) => {
      if ((errBytes += d.length) > maxBytes) return stop(`${cmd} wrote more than ${maxBytes} bytes on stderr`);
      err.push(d);
    });
    if (stdin !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(stdin);
    }
    child.on("error", (e) => {
      clearTimeout(timer);
      if (child.pid) live.delete(child.pid);
      reject(new Error(`${cmd}: ${e.message}`));
    });
    // Whatever the entry started in the background ends with it: killed as soon as the entry exits,
    // or a process holding its output would keep the run open until the time limit.
    child.on("exit", () => {
      if (child.pid) killGroup(child.pid);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (child.pid) {
        killGroup(child.pid);
        live.delete(child.pid);
      }
      if (why) return reject(new Error(why));
      resolve({ code, signal, out: Buffer.concat(out).toString("utf8"), err: Buffer.concat(err).toString("utf8"), cmd });
    });
  });
}

/** Runs the entry and throws unless it exits 0; returns the run. */
export async function succeeds(run, args, what = "") {
  const r = await run(args);
  if (r.code !== 0) throw new Error(`${what ? `${what}: ` : ""}${r.cmd} exited with ${r.code ?? r.signal}${r.err.trim() ? `: ${r.err.trim().slice(0, 300)}` : ""}`);
  return r;
}

/**
 * Runs the entry on bad input: it must exit non-zero, say why on stderr, and print nothing on stdout.
 * Pair it with a run that must succeed on good input, or an entry that refuses everything passes.
 */
export async function refuses(run, args, what) {
  const r = await run(args);
  if (r.code === 0) throw new Error(`${what}: exited with 0`);
  if (r.out !== "") throw new Error(`${what}: printed something on stdout`);
  if (r.err.trim() === "") throw new Error(`${what}: no reason on stderr`);
  return r;
}
