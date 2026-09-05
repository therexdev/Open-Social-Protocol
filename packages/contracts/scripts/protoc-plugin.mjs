#!/usr/bin/env node
// Transparent wrapper around a protoc plugin binary.
//
// protoc spawns plugins with a pipe on stdin. Under Node 22 a plugin's
// `fs.readFileSync(process.stdin.fd)` can fail with EAGAIN because the pipe is
// non-blocking. This wrapper reads the CodeGeneratorRequest with a retrying
// loop, spools it to a temporary regular file (regular-file reads never return
// EAGAIN) and runs the real plugin with that file as its stdin.
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv[2];
if (!target) {
  process.stderr.write("usage: protoc-plugin.mjs <plugin-path>\n");
  process.exit(2);
}

const chunks = [];
const buf = Buffer.alloc(1 << 16);
const sleeper = new Int32Array(new SharedArrayBuffer(4));
for (;;) {
  let n = 0;
  try {
    n = readSync(0, buf, 0, buf.length, null);
  } catch (err) {
    if (err.code === "EAGAIN") {
      Atomics.wait(sleeper, 0, 0, 5);
      continue;
    }
    if (err.code === "EOF") break;
    throw err;
  }
  if (n === 0) break;
  chunks.push(Buffer.from(buf.subarray(0, n)));
}

const dir = mkdtempSync(join(tmpdir(), "osp-protoc-"));
const reqPath = join(dir, "request.bin");
writeFileSync(reqPath, Buffer.concat(chunks));
const fd = openSync(reqPath, "r");
let result;
try {
  result = spawnSync(target, [], {
    stdio: [fd, "pipe", "inherit"],
    maxBuffer: 1 << 28,
  });
} finally {
  closeSync(fd);
  rmSync(dir, { recursive: true, force: true });
}
if (result.error) {
  process.stderr.write(String(result.error.stack || result.error) + "\n");
  process.exit(1);
}
process.stdout.write(result.stdout);
process.exitCode = result.status ?? 1;
