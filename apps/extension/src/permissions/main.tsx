import { useState } from "react";
import { createRoot } from "react-dom/client";

function Permissions() {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const request = async (video: boolean) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
      stream.getTracks().forEach(track => track.stop());
      setMessage("Access enabled. Return to Open Social and tap Record. You can close this tab.");
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message} Check Chrome's microphone/camera permissions for this extension, then try again.` : "Access was not enabled. Try again when your microphone or camera is available.");
    } finally { setBusy(false); }
  };
  return <main className="content" style={{ maxWidth: 600, margin: "2rem auto" }}>
    <h1>Record voice and video</h1><p>Allow your microphone for voice messages, or your camera and microphone for video. This check stops the devices immediately and does not record or upload anything.</p>
    <div className="row"><button disabled={busy} onClick={() => void request(false)}>Enable microphone</button><button disabled={busy} onClick={() => void request(true)}>Enable camera and microphone</button></div>
    {busy && <p role="status">Waiting for permission…</p>}{message && <p role="status">{message}</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Permissions/>);
