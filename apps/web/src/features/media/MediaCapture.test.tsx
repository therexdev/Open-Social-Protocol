import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaCapture, checkClipDuration } from "./MediaCapture";

let host: HTMLDivElement, root: Root | undefined;
const originalDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host.remove();
  vi.unstubAllGlobals();
  if (originalDevices) Object.defineProperty(navigator, "mediaDevices", originalDevices);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});
const click = async (label: string) => {
  const button = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.includes(label));
  expect(button).toBeTruthy();
  await act(async () => button!.click());
};

it("allows full-length hosted recordings and exposes an audio file picker", async () => {
  expect(() => checkClipDuration("video", 3_600_000, true)).not.toThrow();
  expect(() => checkClipDuration("voice", 7_200_000, true)).not.toThrow();
  expect(() => checkClipDuration("voice", 7_200_000)).toThrow("2 minutes");
  await act(async () => root!.render(<MediaCapture kind="voice" hosted onChange={vi.fn()}/>));
  expect(host.textContent).toContain("Choose audio");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Choose an audio file"]')?.accept).toContain(".mp3");
});

it("releases a late camera permission result after the user cancels", async () => {
  let accept!: (stream: MediaStream) => void;
  const stop = vi.fn(), send = vi.fn();
  const getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { accept = resolve; }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const recorder = vi.fn();
  vi.stubGlobal("MediaRecorder", recorder);
  await act(async () => root!.render(<MediaCapture kind="video" onChange={send}/>));
  await click("Record video");
  await click("Cancel");
  await act(async () => accept({ getTracks: () => [{ stop }] } as unknown as MediaStream));
  expect(stop).toHaveBeenCalledOnce();
  expect(recorder).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("stops a running recorder and microphone when leaving a conversation", async () => {
  const stop = vi.fn(), stopRecorder = vi.fn(), send = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: async () => ({ getTracks: () => [{ stop }] }),
  } });
  vi.stubGlobal("MediaRecorder", class {
    state = "inactive";
    static isTypeSupported() { return true; }
    start() { this.state = "recording"; }
    stop() { stopRecorder(); this.state = "inactive"; }
  });
  await act(async () => root!.render(<MediaCapture kind="voice" onChange={send}/>));
  await click("Record voice");
  expect(host.textContent).toContain("Stop");
  await act(async () => root!.unmount());
  root = undefined;
  expect(stopRecorder).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
});
