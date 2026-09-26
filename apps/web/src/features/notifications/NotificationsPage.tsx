import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { NotificationView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { AccountLink, Empty, Notice, Spinner } from "../../components/ui";
import { errorMessage, timeAgo } from "../../util/format";
import { useVault } from "../../vault/context";
import { useProfileName } from "../profile/useProfileName";
import { getSeenCursor, isNewerCursor, setSeenCursor } from "./badge";

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
  const [seen, setSeen] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    const visible = () => document.visibilityState !== "hidden";
    setItems([]);
    setSeen(account ? getSeenCursor(account) : undefined);
    setError(undefined);
    const load = async () => {
      if (!account || busy || !visible()) return;
      busy = true;
      try {
        const page = await indexer.notifications(account, { limit: 50 });
        if (cancelled) return;
        const notifications = [...page.items].reverse();
        setItems(notifications);
        setError(undefined);
        // A background tab or a response arriving after navigation has not been viewed.
        if (notifications[0] && visible()) setSeenCursor(account, notifications[0].id);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        busy = false;
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const refresh = () => void load();
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [account, indexer]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Activity</h1>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {loading && <Spinner />}
      {!loading && items.length === 0 && <Empty>Nothing yet. Friend requests, likes and replies show up here.</Empty>}
      <ul className="list">
        {items.map((n) => (
          <Item key={n.id} n={n} fresh={isNewerCursor(n.id, seen)} />
        ))}
      </ul>
    </div>
  );
}
