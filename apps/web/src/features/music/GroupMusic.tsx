import { useEffect, useRef, useState } from "react";
import { fromBase64url, musicConfig, toBase64url, type MusicRecord } from "@osp/sdk";
import { useServices } from "../../api/services";
import { useVault } from "../../vault/context";
import { Button, Card, Empty, Notice, Spinner } from "../../components/ui";
import { MusicTrack } from "./MusicTrack";
export function GroupMusic({ groupId }: { groupId: string }) {
  const { protocol } = useServices(),
    session = useVault((s) => s.session);
  const [items, setItems] = useState<Array<{ id: string; record: MusicRecord }>>([]),
    [after, setAfter] = useState<Uint8Array>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const requestVersion = useRef(0);
  const load = async (cursor?: Uint8Array) => {
    if (!protocol || !session) return;
    const ticket = ++requestVersion.current;
    setLoading(true);
    setError("");
    try {
      if ((await musicConfig(protocol)).version < 2) return;
      const page = await protocol.reads.publications.list_music({
        group_id: fromBase64url(groupId),
        after: cursor,
      });
      const found: Array<{ id: string; record: MusicRecord }> = [];
      for (const id of page?.ids ?? []) {
        const record = (await protocol.reads.publications.get_music({ id }))?.value;
        const access = await protocol.reads.publications.get_music_access({
          id,
          buyer: session.identity.account,
        });
        if (
          record &&
          record.audience === 2 &&
          toBase64url(record.group_id!) === groupId &&
          access?.eligible
        )
          found.push({ id: toBase64url(id), record });
      }
      if (ticket !== requestVersion.current) return;
      setItems((old) =>
        cursor ? [...old, ...found.filter((x) => !old.some((y) => y.id === x.id))] : found
      );
      setAfter(page?.ids.length === 20 ? page.ids[19] : undefined);
    } catch (e) {
      if (ticket === requestVersion.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (ticket === requestVersion.current) setLoading(false);
    }
  };
  useEffect(() => {
    setItems([]);
    void load();
    return () => {
      requestVersion.current++;
    };
  }, [protocol, session, groupId]);
  if (!session) return null;
  return (
    <Card title="Group music">
      {items.map((x) => (
        <MusicTrack key={x.id} {...x} />
      ))}
      {loading ? (
        <Spinner />
      ) : (
        !items.length && (
          <Empty>
            No group tracks yet. Choose this group when uploading from your profile’s Music tab.
          </Empty>
        )
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {after && (
        <Button disabled={loading} onClick={() => void load(after)}>
          More group tracks
        </Button>
      )}
    </Card>
  );
}
