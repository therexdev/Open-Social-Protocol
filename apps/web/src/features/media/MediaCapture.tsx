import { useEffect, useRef, useState } from "react";
import { HOSTED_FILE_MAX_BYTES, MUSIC_MAX_BYTES, VOICE_MAX_BYTES, VOICE_MAX_DURATION, type ClipKind } from "@osp/sdk";
import { useOptionalServices } from "../../api/services";
import { usesExternalMedia } from "../../api/mediaStorage";
import { Icon } from "../../components/Icon";
import { Button, Notice } from "../../components/ui";

export type { ClipKind } from "@osp/sdk";
export interface CapturedMedia {
  file: File;
  durationMs: number;
  mime: string;
}

const videoLimit = 30_000;
const voiceLimit = VOICE_MAX_DURATION;
const maxBytes = { video: MUSIC_MAX_BYTES, voice: VOICE_MAX_BYTES };
const formats = {
  voice: ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"],
  video: ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"],
};

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const hours = Math.floor(s / 3600), minutes = Math.floor(s / 60) % 60;
  return `${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fileSize = (bytes: number) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GiB` : bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(0)} KiB`;

export function checkClipDuration(kind: ClipKind, ms: number, hosted = false) {
  if (hosted) { if (!Number.isSafeInteger(ms) || ms <= 0) throw Error("The recording duration is unavailable."); return; }
  if (kind === "video" && (!Number.isFinite(ms) || ms < 10_000 || ms > videoLimit)) {
    throw new Error("Choose a video between 10 and 30 seconds long.");
  }
  if (kind === "voice" && (!Number.isFinite(ms) || ms <= 0 || ms > voiceLimit)) {
    throw new Error("Voice messages can be up to 2 minutes long.");
  }
}

/** Read duration without rewriting the selected file. Some WebM encoders omit the duration field. */
export function readVideo(file: File, signal: AbortSignal, limit = maxBytes.video, hosted = false): Promise<CapturedMedia> {
  return readRecording(file, signal, "video", limit, hosted);
}
export function readRecording(file: File, signal: AbortSignal, kind: ClipKind, limit: number, hosted = false): Promise<CapturedMedia> {
  if (!file.size || file.size > limit) throw new Error(`Choose a recording up to ${Math.floor(limit / 1048576)} MiB.`);
  const type = file.type.split(";")[0]?.toLowerCase();
  const mime = ({ "audio/x-m4a": "audio/mp4", "audio/x-wav": "audio/wav", "audio/mp3": "audio/mpeg" }[type ?? ""] ?? type) ||
    (kind === "video" ? (/\.mp4$/i.test(file.name) ? "video/mp4" : /\.webm$/i.test(file.name) ? "video/webm" : "") :
      ({ mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", webm: "audio/webm", ogg: "audio/ogg", wav: "audio/wav" }[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? ""));
  if (kind === "video" ? mime !== "video/mp4" && mime !== "video/webm" : !["audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/wav"].includes(mime))
    throw new Error(kind === "video" ? "Choose an MP4 or WebM video." : "Choose MP3, M4A, WebM, Ogg or WAV audio.");
  return new Promise((resolve, reject) => {
    const video = document.createElement(kind === "video" ? "video" : "audio");
    const url = URL.createObjectURL(file);
    const finish = (error?: Error) => {
      const durationMs = Math.round(video.duration * 1000);
      const hasPicture = kind !== "video" || (video instanceof HTMLVideoElement && video.videoWidth > 0 && video.videoHeight > 0);
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      video.onloadedmetadata = video.ontimeupdate = video.ondurationchange = video.onerror = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      if (error) { reject(error); return; }
      try {
        if (!hasPicture) throw new Error("This file has no playable video track.");
        checkClipDuration(kind, durationMs, hosted);
        resolve({ file, mime, durationMs });
      } catch (e) { reject(e); }
    };
    const cancel = () => finish(new Error("Selection cancelled."));
    const timeout = setTimeout(() => finish(new Error("Your browser could not read the video duration.")), 12_000);
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration)) { finish(); return; }
      const tryDuration = () => { if (Number.isFinite(video.duration)) finish(); };
      video.ontimeupdate = video.ondurationchange = tryDuration;
      try { video.currentTime = 1e10; } catch { finish(new Error("This video's duration could not be read.")); }
    };
    video.onerror = () => finish(new Error("This browser cannot read the selected video."));
    video.src = url;
  });
}

function LocalPreview({ value, kind }: { value: CapturedMedia; kind: ClipKind }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const blob = URL.createObjectURL(value.file);
    setUrl(blob);
    return () => URL.revokeObjectURL(blob);
  }, [value.file]);
  if (!url) return null;
  return <>
    {kind === "video" ? <video src={url} controls playsInline preload="metadata" aria-label="Video preview"/> :
      <audio src={url} controls preload="metadata" aria-label="Voice preview"/>}
    <div className="row"><span className="hint">{clock(value.durationMs)} · {fileSize(value.file.size)}</span>
</div>
  </>;
}

export function MediaCapture({ kind, value, onChange, disabled = false, onBusyChange, hosted: hostedOverride }: {
  kind: ClipKind;
  hosted?: boolean;
  value?: CapturedMedia;
  onChange: (value: CapturedMedia | undefined) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const services = useOptionalServices();
  const hosted = hostedOverride ?? (!!services?.protocol && usesExternalMedia(services.protocol));
  const [state, setState] = useState<"idle" | "requesting" | "recording" | "reading">("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const stopRecording = useRef<(() => void) | undefined>(undefined);
  const dispose = useRef<(() => void) | undefined>(undefined);
  const generation = useRef(0);
  const publish = useRef(onChange);
  publish.current = onChange;
  const signalBusy = useRef(onBusyChange);
  signalBusy.current = onBusyChange;
  useEffect(() => {
    signalBusy.current?.(state !== "idle");
  }, [state]);
  useEffect(() => () => {
    ++generation.current;
    dispose.current?.();
    signalBusy.current?.(false);
  }, [kind]);

  const cancel = () => {
    ++generation.current;
    dispose.current?.();
    dispose.current = undefined;
    stopRecording.current = undefined;
    setState("idle");
  };

  const inspectVideo = async (file: File) => {
    const ticket = ++generation.current;
    const controller = new AbortController();
    dispose.current = () => controller.abort();
    setError("");
    setState("reading");
    try {
      const clip = await readRecording(file, controller.signal, kind, hosted ? HOSTED_FILE_MAX_BYTES : maxBytes[kind], hosted);
      if (ticket === generation.current) publish.current(clip);
    } catch (e) {
      if (ticket === generation.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (ticket === generation.current) { dispose.current = undefined; setState("idle"); }
    }
  };

  const start = async () => {
    if (disabled || state !== "idle") return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording requires a browser with microphone or camera access over HTTPS.");
      return;
    }
    const ticket = ++generation.current;
    setState("requesting");
    setElapsed(0);
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true, video: kind === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } } : false,
      });
      const stopTracks = () => stream?.getTracks().forEach(track => track.stop());
      if (ticket !== generation.current) { stopTracks(); return; }
      const mimeType = formats[kind].find(mime => MediaRecorder.isTypeSupported(mime));
      if (!mimeType) throw new Error("This browser has no supported recording format.");
      const recorder = new MediaRecorder(stream, {
        mimeType, audioBitsPerSecond: kind === "voice" ? 48_000 : 96_000,
        ...(kind === "video" && { videoBitsPerSecond: 1_800_000 }),
      });
      const chunks: Blob[] = [];
      const limit = hosted ? Infinity : kind === "video" ? videoLimit : voiceLimit;
      const byteLimit = hosted ? HOSTED_FILE_MAX_BYTES : maxBytes[kind];
      let recordedBytes = 0;
      let started = performance.now(), durationMs = 0;
      let timer: ReturnType<typeof setInterval>, deadline: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        if (recorder.state === "inactive") return;
        durationMs = Math.max(1, Math.round(performance.now() - started));
        recorder.stop();
        stopTracks();
      };
      const cleanup = () => {
        clearInterval(timer);
        clearTimeout(deadline);
        recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
        if (recorder.state !== "inactive") recorder.stop();
        stopTracks();
        if (preview.current) preview.current.srcObject = null;
      };
      dispose.current = cleanup;
      stopRecording.current = stop;
      recorder.ondataavailable = e => { if (e.data.size) { chunks.push(e.data); recordedBytes += e.data.size; if (recordedBytes >= byteLimit - 1024 * 1024) stop(); } };
      recorder.onerror = () => { cancel(); setError("Recording stopped unexpectedly. Check the device and try again."); };
      recorder.onstop = () => {
        const measured = durationMs || Math.round(performance.now() - started);
        // Allow the auto-stop timer a little scheduling jitter; a suspended tab may run much later.
        const duration = measured > limit && measured <= limit + 250 ? limit : measured;
        const mime = (chunks[0]?.type || recorder.mimeType).split(";")[0]!.toLowerCase();
        const ext = mime.endsWith("mp4") ? (kind === "voice" ? "m4a" : "mp4") : mime.split("/")[1];
        const file = new File(chunks, `${kind}-${Date.now()}.${ext}`, { type: mime });
        cleanup();
        dispose.current = stopRecording.current = undefined;
        if (generation.current !== ticket) return;
        if (kind === "video") { void inspectVideo(file); return; }
        setState("idle");
        try {
          checkClipDuration(kind, duration, hosted);
          if (!file.size || file.size > byteLimit) throw new Error("The recording exceeds the size limit or contains no data.");
          publish.current({ file, mime, durationMs: duration });
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      };
      recorder.start(250);
      started = performance.now();
      if (kind === "video" && preview.current) preview.current.srcObject = stream;
      setState("recording");
      timer = setInterval(() => setElapsed(Math.min(limit, performance.now() - started)), 200);
      // Stop before the video limit to leave room for the final encoder frame.
      if (Number.isFinite(limit)) deadline = setTimeout(stop, kind === "video" ? limit - 150 : limit);
    } catch (e) {
      stream?.getTracks().forEach(track => track.stop());
      if (generation.current !== ticket) return;
      cancel();
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      setError(denied ? (location.protocol === "chrome-extension:" ? "Open Microphone / camera at the top of the extension, allow access in that tab, then return and try again." : "Recording permission was denied. Allow access in your browser and try again.") : e instanceof Error ? e.message : String(e));
    }
  };

  return <div className="media-capture" aria-label={kind === "video" ? "Video attachment" : "Voice attachment"}>
    {kind === "video" && <video ref={preview} hidden={state !== "recording"} autoPlay muted playsInline aria-label="Live camera preview"/>}
    {value && <LocalPreview kind={kind} value={value}/>}
    <div className="row">
      {value ? <Button variant="ghost" disabled={disabled} onClick={() => { setError(""); onChange(undefined); }}>Remove {kind === "video" ? "video" : "recording"}</Button> :
        state === "idle" ? <>
          <Button disabled={disabled} onClick={() => void start()}><Icon name={kind === "video" ? "camera" : "mic"}/>{kind === "video" ? "Record video" : "Record voice"}</Button>
          {(kind === "video" || hosted) && <Button disabled={disabled} onClick={() => fileInput.current?.click()}><Icon name="upload"/>{kind === "video" ? "Choose video" : "Choose audio"}</Button>}
        </> : <>
          {state === "recording" && <Button variant="primary" onClick={() => stopRecording.current?.()}><Icon name="stop"/>Stop · {clock(elapsed)}</Button>}
          {state === "requesting" && <span role="status">Waiting for device access…</span>}
          {state === "reading" && <span role="status">Checking video…</span>}
          <Button variant="ghost" onClick={cancel}>Cancel</Button>
        </>}
    </div>
    {(kind === "video" || hosted) && <input ref={fileInput} type="file" accept={kind === "video" ? "video/mp4,video/webm,.mp4,.webm" : "audio/mpeg,audio/mp4,audio/webm,audio/ogg,audio/wav,.mp3,.m4a,.webm,.ogg,.wav"} className="visually-hidden" tabIndex={-1} aria-label={kind === "video" ? "Choose a video file" : "Choose an audio file"} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file && !disabled && state === "idle") void inspectVideo(file); }}/>}
    {error && <Notice kind="error">{error}</Notice>}
  </div>;
}
