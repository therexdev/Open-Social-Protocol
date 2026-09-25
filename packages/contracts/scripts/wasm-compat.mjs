import binaryen from "assemblyscript/binaryen";

// Fizzy executes WebAssembly 1.0. Modern AssemblyScript enables these extensions.
export const KOINOS_DISABLED_FEATURES = ["sign-extension", "bulk-memory", "nontrapping-f2i", "mutable-globals"];

/** Reject incompatible deployment artifacts before they can consume Mana on chain. */
export function assertKoinosWasm(bytes, label = "contract") {
  const fail = message => { throw new Error(`${label}: incompatible Koinos WebAssembly: ${message}`); };
  if (bytes.length < 8 || Buffer.from(bytes.subarray(0, 8)).toString("hex") !== "0061736d01000000") fail("invalid WASM 1.0 header");
  let pos = 8;
  while (pos < bytes.length) {
    const section = bytes[pos++];
    if (section > 11) fail(`unsupported section ${section} (requires a post-MVP feature)`);
    let size = 0;
    let shift = 0;
    let byte;
    do {
      if (pos >= bytes.length || shift >= 35) fail("invalid section length");
      byte = bytes[pos++];
      if (shift === 28 && (byte & 0xf0)) fail("section length exceeds uint32");
      size += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    if (pos + size > bytes.length) fail("truncated section");
    pos += size;
  }
  const module = binaryen.readBinary(bytes);
  try {
    module.setFeatures(binaryen.Features.MVP);
    if (!module.validate()) fail("instructions or types require a post-MVP feature");
  } finally {
    module.dispose();
  }
}
