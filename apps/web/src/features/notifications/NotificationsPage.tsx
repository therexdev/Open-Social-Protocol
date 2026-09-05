import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { NotificationView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { AccountLink, Button, Empty, Notice, Spinner } from "../../components/ui";
import { errorMessage, timeAgo } from "../../util/format";
import { useVault } from "../../vault/context";
import { useProfileName } from "../profile/useProfileName";
import { getSeenCursor, setSeenCursor } from "./badge";

function wording(n: NotificationView): string {
  switch (n.kind) {
    case "friend_request":
      return "sent you a friend request";
    case "friend_accepted":
      return "accepted your friend request";
    case "reaction":
      return "liked your post";
    case "reply":
      return "replied to your post";
    case "keys":
      return "shared a reading key with you";
    case "role":
      return "changed your role in a community";
    case "label":
      return "labeled your post";
    case "recovery":
      return "acted on your account recovery";
    case "device":
      return "changed a device on your account";
    default:
      return n.kind;
  }
}

function Item({ n, fresh }: { n: NotificationView; fresh: boolean }) {
  const name = useProfileName(n.actor);
  return (
    <li className={`list-item notification ${fresh ? "fresh" : ""}`.trim()}>
      <div>
        <AccountLink account={n.actor} name={name} /> {wording(n)}
        {n.postId && (
          <>
            {" "}
            · <Link to={`/post/${n.postId}`}>open post</Link>
          </>
        )}
        {n.kind === "friend_request" && (
          <>
            {" "}
            · <Link to="/friends">respond</Link>
          </>
        )}
      </div>
      <span className="muted">{timeAgo(n.timestamp)}</span>
    </li>
  );
}

export function NotificationsPage() {
  const { indexer } = useServices();
  const account = useVault((s) => s.account);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [seen, setSeen] = useState<string | undefined>(() => (account ? getSeenCursor(account) : undefined));

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError(undefined);
    try {
      const page = await indexer.notifications(account, { limit: 50 });
      setItems([...page.items].reverse());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [account, indexer]);

  useEffect(() => {
    void load();
  }, [load]);

  const newest = items[0]?.id;
  const markSeen = () => {
    if (!account || !newest) return;
    setSeenCursor(account, newest);
    setSeen(newest);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Activity</h1>
        <Button variant="ghost" onClick={markSeen} disabled={!newest || newest === seen}>
          Mark all as seen
        </Button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {loading && <Spinner />}
      {!loading && items.length === 0 && <Empty>Nothing yet. Friend requests, likes and replies show up here.</Empty>}
      <ul className="list">
        {items.map((n) => (
          <Item key={n.id} n={n} fresh={seen === undefined || Number(n.id) > Number(seen)} />
        ))}
      </ul>
    </div>
  );
}
