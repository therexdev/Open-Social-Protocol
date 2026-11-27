import { Link, useLocation } from "react-router-dom";
import { useVault } from "../vault/context";

export function PublicJoinPrompt({ comment = false }: { comment?: boolean }) {
  const status = useVault(s => s.status), location = useLocation();
  if (status !== "empty" && status !== "locked") return null;
  const locked = status === "locked";
  return <div className="public-join-prompt"><p>{locked ? "Unlock your account" : "Join Open Social"} {comment ? "to add a comment or reaction." : "to post, comment and react. Public posts are free to explore."}</p>
    <Link className="btn btn-primary" to="/welcome" state={{ from: `${location.pathname}${location.search}${comment ? '#post-comments' : location.hash}` }}>{locked ? "Unlock" : "Join Open Social"}</Link>
  </div>;
}
