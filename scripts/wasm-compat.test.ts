import test from "node:test";
import assert from "node:assert/strict";
import binaryen from "assemblyscript/binaryen";
import { assertKoinosWasm } from "../packages/contracts/scripts/wasm-compat.mjs";

const header = Buffer.from("0061736d01000000", "hex");
test("accepts a valid MVP module and rejects the data-count section Fizzy cannot parse", () => {
  const valid = binaryen.parseText('(module (func (export "_start")))');
  try { assert.doesNotThrow(() => assertKoinosWasm(valid.emitBinary())); }
  finally { valid.dispose(); }
  assert.throws(() => assertKoinosWasm(Buffer.concat([header, Buffer.from([12, 1, 0])])), /unsupported section 12/);
  assert.throws(() => assertKoinosWasm(Buffer.from("not wasm")), /invalid WASM/);
  assert.throws(() => assertKoinosWasm(Buffer.concat([header, Buffer.from([1, 5])])), /truncated section/);
});

test("requires explicit Koinos startup after host initialization", () => {
  assert.throws(() => assertKoinosWasm(header), /missing exported _start/);
  const automatic = binaryen.parseText('(module (func $init) (start $init) (export "_start" (func $init)))');
  try { assert.throws(() => assertKoinosWasm(automatic.emitBinary()), /automatic start section/); }
  finally { automatic.dispose(); }
});

test("rejects post-MVP instructions even without a data-count section", () => {
  const module = binaryen.parseText('(module (func (export "extended") (param i32) (result i32) (i32.extend8_s (local.get 0))))');
  try {
    module.setFeatures(binaryen.Features.SignExt);
    assert.throws(() => assertKoinosWasm(module.emitBinary()), /post-MVP feature/);
  } finally {
    module.dispose();
  }
});
