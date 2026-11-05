import { voiceStorageUnits, VOICE_MAX_BYTES } from "@osp/sdk";
import { useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Button, Notice } from "../../components/ui";
import { MediaCapture, type CapturedMedia } from "../media/MediaCapture";

export function MessageComposer({ disabled, onSend }: {
  disabled: boolean;
  onSend: (text: string, voice?: CapturedMedia) => Promise<void>;
}) {
  const [text, setText] = useState(""), [voice, setVoice] = useState<CapturedMedia>();
  const [capturing, setCapturing] = useState(false), [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const storedBytes = voice ? voice.file.size + 16 : 0;
  const tooLarge = storedBytes > VOICE_MAX_BYTES;
  const storageUnits = storedBytes && !tooLarge ? voiceStorageUnits(storedBytes) : 0;
  async function send() {
    if (submitting.current || disabled || capturing || tooLarge || (!voice && !text.trim())) return;
    submitting.current = true;
    setSending(true);
    setError("");
    try {
      await onSend(text, voice);
      setText("");
      setVoice(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }
  return <form className="chat-composer message-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
    <textarea rows={2} maxLength={2500} spellCheck aria-label="Your message" placeholder="Write a message…" value={text}
      disabled={sending} onChange={e => setText(e.target.value)} />
    <div className="message-compose-tools">
      <MediaCapture kind="voice" value={voice} onChange={setVoice} disabled={disabled || sending} onBusyChange={setCapturing}/>
      <Button type="submit" variant="primary" busy={sending} disabled={disabled || capturing || tooLarge || (!text.trim() && !voice)}>
        <Icon name="send" size={18}/> Send message
      </Button>
    </div>
    {tooLarge && <Notice kind="error">The encrypted recording exceeds 1 MiB. Remove it and record a shorter message.</Notice>}
    {storageUnits > 0 && <small className="hint">Recording storage uses {storageUnits} usage {storageUnits === 1 ? "credit" : "credits"}. Your account is visible on the encrypted upload. Only this conversation receives the playback key.</small>}
    {error && <Notice kind="error">{error}</Notice>}
  </form>;
}
