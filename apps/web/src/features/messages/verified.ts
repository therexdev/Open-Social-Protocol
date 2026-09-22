import { bytesEqual, decryptDirectMessage, deriveEncryptionSecret, fromBase64url, type Identity, type ProtocolClient } from "@osp/sdk";
import type { MessageView } from "../../api/indexer";
/** No plaintext reaches the UI until the RPC has independently verified this record. */
export async function openVerifiedMessage(
  client: ProtocolClient,
  me: Identity,
  peer: string,
  row: MessageView
): Promise<{ id: string; text: string; sender: string; timestamp: string; sequence: string }> {
  if (![me.account, peer].includes(row.sender)) throw new Error("Unexpected sender");
  const id = fromBase64url(row.message_id);
  if (id.length !== 32) throw new Error("Invalid message id");
  const record = (await client.reads.messaging.get_message({ sender: row.sender, message_id: id }))?.value;
  if (
    !record ||
    record.sender !== row.sender ||
    !bytesEqual(record.message_id, id) ||
    record.recipient !== (row.sender === me.account ? peer : me.account)
  )
    throw new Error("Message is not verified on chain");
  const text = decryptDirectMessage(
    {
      chainId: client.deployment.chainId,
      contract: client.deployment.contracts.messaging.address,
      sender: record.sender,
      recipient: record.recipient,
      messageId: id,
      generation: record.generation,
    },
    fromBase64url(row.envelope),
    record.content_hash,
    me.account,
    (v) => deriveEncryptionSecret(me.seed, v)
  );
  return { id: row.sender + row.message_id, text, sender: record.sender, timestamp: record.timestamp, sequence: record.sequence };
}
