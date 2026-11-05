/** A small browser-generated JPEG. The original encoded video is never rewritten. */
export function createVideoPoster(file: Blob, signal: AbortSignal): Promise<Uint8Array | undefined> {
  return new Promise(resolve => {
    const video = document.createElement("video"), url = URL.createObjectURL(file);
    let done = false, capturing = false;
    const finish = (bytes?: Uint8Array) => {
      if (done) return; done = true;
      clearTimeout(timer); signal.removeEventListener("abort", cancel);
      video.onloadeddata = video.onseeked = video.onerror = null;
      video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
      resolve(bytes);
    };
    const cancel = () => finish();
    const timer = setTimeout(cancel, 10000);
    const capture = async () => {
      if (capturing || done) return; capturing = true;
      try {
        if (!video.videoWidth || !video.videoHeight) return finish();
        const canvas = document.createElement("canvas");
        for (const width of [640, 480, 320]) {
          const scale = Math.min(1, width / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const context = canvas.getContext("2d"); if (!context) return finish();
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.72));
          if (signal.aborted || done) return finish();
          // One photo usage block, including private-image authentication bytes.
          if (blob && blob.size <= 32768 - 16) return finish(new Uint8Array(await blob.arrayBuffer()));
        }
        finish();
      } catch { finish(); }
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) return finish();
    video.preload = "auto"; video.muted = true; video.playsInline = true;
    video.onloadeddata = () => {
      if (done || capturing) return;
      if (video.currentTime === 0 && Number.isFinite(video.duration) && video.duration > 0.1) video.currentTime = Math.min(0.5, video.duration / 2);
      else void capture();
    };
    video.onseeked = () => void capture();
    video.onerror = () => finish(); video.src = url;
  });
}

// At most two passive video loads at once, including older clips without posters.
const lanes: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
let nextLane = 0;
export function queueVideoPreview<T>(load: () => Promise<T>): Promise<T> {
  const lane = nextLane++ % lanes.length;
  const result = lanes[lane]!.catch(() => undefined).then(load);
  lanes[lane] = result.catch(() => undefined);
  return result;
}
