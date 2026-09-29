import { Fragment } from "react";
import { Link } from "react-router-dom";
import { splitPostText, tagHref } from "../util/postText";

export function RichText({ text }: { text: string }) {
  return <>{splitPostText(text).map((part, index) => <Fragment key={index}>
    {part.kind === "url" ? <a className="text-link" href={part.href} target="_blank" rel="noopener noreferrer ugc">{part.text}</a>
      : part.kind === "tag" ? <Link className="text-link hashtag-link" to={tagHref(part.tag)}>{part.text}</Link>
        : part.text}
  </Fragment>)}</>;
}
