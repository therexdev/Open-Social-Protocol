import { describe, expect, it } from "vitest";
import { Signer } from "koilib";
import { encode, toBase64url } from "./encoding.js";
import { decodeBlockEvents, decodeEvent, decodeEventData, decodeReceiptEvents, eventTypeForName, isEvent } from "./events.js";
import { EVENT_NAMES } from "./constants.js";
import { fixtureDeployment } from "./testing/fixtures.js";

const deployment = fixtureDeployment();
const author = Signer.fromSeed("author").getAddress();

describe("events", () => {
  const published = {
    author,
    post_id: new Uint8Array(32).fill(1),
    content_hash: new Uint8Array(32).fill(2),
    version_number: 1,
    sequence: "42",
    audience: 1,
    epoch: 3,
    envelope: new Uint8Array([1, 2, 3]),
    media: [{ content_hash: new Uint8Array([7]), mime: "image/png", size: "10", locations: ["ipfs://x"] }],
    idempotency_key: new Uint8Array(16).fill(4),
    protocol_version: 1,
    timestamp: "1700000000000",
  };
  const data = toBase64url(encode("publications.published_event", published));

  it("decodes protocol events from a receipt and skips foreign sources", () => {
    const receipt = {
      id: "0x1220ab",
      events: [
        { sequence: 0, source: deployment.contracts.publications.address, name: EVENT_NAMES.publications.published, data, impacted: [author] },
        { sequence: 1, source: Signer.fromSeed("foreign").getAddress(), name: "osp.publications.published", data, impacted: [author] },
        { sequence: 2, source: deployment.contracts.publications.address, name: "koinos.contracts.token.transfer_event", data: "", impacted: [] },
      ],
    };
    const events = decodeReceiptEvents(receipt, deployment, { blockHeight: "7" });
    expect(events.length).toBe(1);
    const event = events[0]!;
    expect(event.contract).toBe("publications");
    expect(event.type).toBe("publications.published_event");
    expect(event.txId).toBe("0x1220ab");
    expect(event.blockHeight).toBe("7");
    expect(event.impacted).toEqual([author]);
    expect(isEvent(event, "osp.publications.published")).toBe(true);
    if (isEvent(event, "osp.publications.published")) {
      expect(event.data.author).toBe(author);
      expect(event.data.sequence).toBe("42");
      expect(event.data.envelope).toEqual(new Uint8Array([1, 2, 3]));
      expect(event.data.media[0]?.locations).toEqual(["ipfs://x"]);
      expect(event.data.previous_version).toEqual(new Uint8Array(0));
    }
  });

  it("decodes by name and from block receipts", () => {
    expect(eventTypeForName("osp.identity.registered")).toEqual({ contract: "identity", type: "identity.registered_event" });
    expect(decodeEventData("osp.publications.published", data).epoch).toBe(3);
    expect(decodeEvent(deployment.contracts.identity.address, "osp.publications.published", data, deployment)).toBeUndefined();
    const block = {
      block_id: "0x1220bb",
      block_height: "9",
      receipt: { transaction_receipts: [{ id: "0x1220cc", events: [{ sequence: 0, source: deployment.contracts.publications.address, name: "osp.publications.published", data, impacted: [author] }] }] },
    };
    const events = decodeBlockEvents(block, deployment);
    expect(events.length).toBe(1);
    expect(events[0]?.blockId).toBe("0x1220bb");
    expect(events[0]?.txId).toBe("0x1220cc");
  });
});
