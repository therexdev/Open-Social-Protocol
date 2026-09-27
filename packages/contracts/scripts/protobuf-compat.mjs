// @koinos/as-proto-gen 1.0.0 decodes repeated uint32 as unpacked only.
// Protobuf requires readers to accept both encodings, regardless of the writer:
// https://protobuf.dev/programming-guides/encoding/#repeated
// Keep this correction in generation, rather than editing generated bindings.
export function repairRepeatedUint32(source, schema) {
  const fields = [...schema.matchAll(/\brepeated\s+uint32\s+(\w+)\s*=/g)].map(match => match[1]);
  for (const field of new Set(fields)) {
    const pattern = new RegExp(`^( +)message\\.${field}\\.push\\(reader\\.uint32\\(\\)\\);$`, "gm");
    let repaired = 0;
    source = source.replace(pattern, (_match, indent) => {
      repaired += 1;
      return [
        "if ((tag & 7) == 2) {",
        "  const packedLength = reader.uint32();",
        "  assert(reader.ptr <= end && <usize>packedLength <= end - reader.ptr);",
        "  const packedEnd = reader.ptr + packedLength;",
        "  while (reader.ptr < packedEnd) {",
        `    message.${field}.push(reader.uint32());`,
        "  }",
        "  assert(reader.ptr == packedEnd);",
        "} else {",
        "  assert((tag & 7) == 0);",
        `  message.${field}.push(reader.uint32());`,
        "}",
      ].map(line => indent + line).join("\n");
    });
    if (repaired !== fields.filter(name => name === field).length) {
      throw new Error(`generated repeated uint32 decoder changed for ${field}; review Protobuf compatibility before building`);
    }
  }
  return source;
}
