import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { REACTION } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui";
import { humanizeError, submitAction } from "../../tx/submit";
import { bytesOf } from "../../util/bytes";
import { useCanAct, useMe, useSubmitContext } from "../session";

const choices = [
  { code: REACTION.LOVE, label: "Love", icon: "❤️" },
  { code: REACTION.HAPPY, label: "Happy", icon: "😊" },
  { code: REACTION.SAD, label: "Sad", icon: "😢" },
  { code: REACTION.WORRIED, label: "Worried", icon: "😟" },
  { code: REACTION.SURPRISED, label: "Surprised", icon: "😮" },
];

type Props = { id: string; reactions: PostView["reactions"]; disabled?: boolean; onChanged?: () => void };

export function ReactionPicker(props: Props) {
  const me = useMe();
  return <Picker key={`${props.id}:${me?.account ?? ""}`} {...props}/>;
}

function Picker({ id, reactions, disabled, onChanged }: Props) {
  const can = useCanAct(), ctx = useSubmitContext();
  const [position, setPosition] = useState<{ left: number; top: number }>(), [busy, setBusy] = useState(false);
  const open = !!position;
  const [confirmed, setConfirmed] = useState<number>(), [error, setError] = useState("");
  const trigger = useRef<HTMLDivElement>(null), bubble = useRef<HTMLDivElement>(null), bubbleId = useId();
  const indexed = reactions.viewer?.[0] ?? 0, selected = confirmed ?? indexed;
  const choice = choices.find(item => item.code === selected);
  const count = Math.max(0, reactions.total + (confirmed === undefined ? 0 : Number(!!confirmed) - (reactions.viewer?.length ?? 0)));
  useEffect(() => { if (indexed === confirmed) setConfirmed(undefined); }, [indexed, confirmed]);
  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(204, window.innerWidth - 16);
    setPosition({ left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)),
      top: rect.top >= 56 ? rect.top - 52 : rect.bottom + 4 });
  };
  useEffect(() => {
    if (!open) return;
    const menu = bubble.current;
    (menu?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? menu?.querySelector("button"))?.focus();
    const outside = (event: Event) => {
      if (!trigger.current?.contains(event.target as Node) && !menu?.contains(event.target as Node)) setPosition(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPosition(undefined); trigger.current?.querySelector("button")?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const choose = async (code: number) => {
    if (!ctx || disabled || !can.ok || busy) return;
    setBusy(true); setPosition(undefined); setError("");
    try {
      const remove = selected === code;
      const op = await ctx.client.ops.publications.react({ actor: ctx.signer.getAddress(), post_id: bytesOf(id), reaction: code, remove });
      await submitAction(ctx, [op], { label: "Saving your reaction", success: remove ? "Reaction removed" : "Reaction saved", waitForReceipt: true, quietProgress: true });
      setConfirmed(remove ? 0 : code); onChanged?.();
    } catch (e) { setError(humanizeError(e)); }
    finally { setBusy(false); }
  };
  const summary = choices.map(c => reactions.byType[String(c.code)] ? `${c.label} ${reactions.byType[String(c.code)]}` : "").filter(Boolean).join(", ");
  return <div className="reaction-picker" ref={trigger}>
    <Button variant="ghost" className="engagement-icon" title={can.reason ?? (summary || "React")}
      aria-label={choice ? `Change reaction, ${choice.label}` : "React"} aria-expanded={open} aria-controls={bubbleId}
      disabled={!can.ok || disabled} busy={busy} onClick={() => open ? setPosition(undefined) : place()}>
      {choice ? <span aria-hidden="true">{choice.icon}</span> : <Icon name="heart" size={18}/>} {count || ""}
    </Button>
    {position && createPortal(<div ref={bubble} style={position} id={bubbleId} className="reaction-options" role="group" aria-label="Choose a reaction">
      {choices.map(c => <button key={c.code} type="button" aria-pressed={selected === c.code}
        aria-label={selected === c.code ? `Remove ${c.label} reaction` : c.label} title={c.label}
        onClick={() => void choose(c.code)}>{c.icon}</button>)}
    </div>, document.body)}
    {error && <span className="reaction-error" role="alert">{error}</span>}
  </div>;
}
