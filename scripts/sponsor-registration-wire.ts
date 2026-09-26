// Independent wire encodings for release-WASM and live registration rehearsals.
// Numeric repeated fields must accept packed, unpacked, and concatenated chunks.
import protobuf from "protobufjs";
import { utils } from "koilib";
import { encode, type SetSponsorArgs } from "@osp/sdk";

export function sponsorPolicyBytes(policy: SetSponsorArgs, format: "packed" | "unpacked" | "mixed"): Uint8Array {
  const base = encode("sponsorship.set_sponsor_arguments", { ...policy, allowed: [] });
  const writer = protobuf.Writer.create();
  for (const entry of policy.allowed ?? []) {
    writer.uint32(42).fork().uint32(10).bytes(utils.decodeBase58(String(entry.contract_id)));
    const points = entry.entry_points ?? [];
    if (format === "unpacked") {
      for (const point of points) writer.uint32(16).uint32(point);
    } else if (format === "packed") {
      writer.uint32(18).fork();
      for (const point of points) writer.uint32(point);
      writer.ldelim();
    } else {
      // Two packed chunks, an unpacked value, and an empty packed chunk.
      writer.uint32(18).fork();
      if (points.length) writer.uint32(points[0]!);
      writer.ldelim();
      if (points.length > 1) writer.uint32(16).uint32(points[1]!);
      writer.uint32(18).fork();
      for (const point of points.slice(2)) writer.uint32(point);
      writer.ldelim().uint32(18).uint32(0);
    }
    writer.ldelim();
  }
  return new Uint8Array(Buffer.concat([base, writer.finish()]));
}
