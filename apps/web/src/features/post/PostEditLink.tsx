import { Link } from "react-router-dom";
import { LIFECYCLE } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { useMe } from "../session";

export function PostEditLink({ post }: { post: PostView }) {
  const me = useMe();
  if (me?.account !== post.author || post.poll || post.state !== LIFECYCLE.ACTIVE) return null;
  return <> · <Link to={`/post/${post.postId}?edit=1`}>Edit</Link></>;
}
