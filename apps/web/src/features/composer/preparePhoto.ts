import { readMediaResponse } from "@osp/sdk";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const cancelled = () => new Error("Photo upload cancelled");
export class PhotoReadError extends Error {
  constructor(reason = "empty file") {
    super(`The browser could not read this photo (${reason}). Try Choose from files, or save a local copy and select it again.`);
    this.name = "PhotoReadError";
  }
}
const unreadable = (reason?: string) => new PhotoReadError(reason);

function readFile(blob: Blob, asDataUrl: boolean, signal?: AbortSignal): Promise<ArrayBuffer | string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reader.onload = reader.onerror = reader.onabort = null; };
    const fail = (error: Error) => { cleanup(); reader.abort(); reject(error); };
    const abort = () => fail(cancelled());
    const timer = setTimeout(() => fail(unreadable("file read timed out")), 20_000);
    reader.onload = () => { const result = reader.result; cleanup(); result === null ? reject(unreadable()) : resolve(result); };
    reader.onerror = () => fail(unreadable(reader.error?.name ?? "file access failed"));
    reader.onabort = () => fail(cancelled());
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { asDataUrl ? reader.readAsDataURL(blob) : reader.readAsArrayBuffer(blob); }
    catch (error) { fail(unreadable(error instanceof Error ? error.name : "file access failed")); }
  });
}

/** Stream first; mobile document providers do not always expose a reliable size
 * or support FileReader on the returned handle. All reads stay local and bounded. */
export async function readPhotoSource(file: File, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw cancelled();
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Choose a photo smaller than 20 MB.");
  if (typeof file.stream === "function") {
    const controller = new AbortController(), abort = () => controller.abort();
    const timer = setTimeout(abort, 8_000);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const bytes = await readMediaResponse(new Response(file.stream()), MAX_SOURCE_BYTES, controller.signal);
      if (bytes.length) return bytes;
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      if (error instanceof Error && error.message === "Image is too large") throw new Error("Choose a photo smaller than 20 MB.");
      // Try FileReader if streaming is unsupported or the provider fails a read.
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.abort(); }
  }
  const bytes = new Uint8Array(await readFile(file, false, signal) as ArrayBuffer);
  if (!bytes.length) throw unreadable();
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error("Choose a photo smaller than 20 MB.");
  // A stale/zero size from a document provider must not reject successfully read bytes.
  return bytes;
}

// Android document providers can supply a blank or incorrect MIME type. Use the
// bytes, not the filename, and never pass SVG/HTML through to an image decoder.
function photoMime(bytes: Uint8Array): string {
  const starts = (...values: number[]) => values.every((value, i) => bytes[i] === value);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(4, 4) === "ftyp") {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    const brands = [ascii(8, 4)];
    for (let i = 16; i + 4 <= Math.min(size, bytes.length, 256); i += 4) brands.push(ascii(i, 4));
    if (brands.includes("avif")) return "image/avif";
    if (brands.some(b => ["heic", "heix", "mif1"].includes(b))) return "image/heic";
  }
  throw new Error("Choose a JPEG, PNG, WebP, AVIF, or HEIC photo. GIF and SVG files are not supported.");
}

type DecodedPhoto = { source: CanvasImageSource; width: number; height: number; dispose: () => void };

async function decodePhoto(blob: Blob, signal?: AbortSignal): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === "function") {
    try {
      // Decode a memory-backed Blob: no dependence on a mobile file-provider URL.
      return await new Promise<DecodedPhoto>((resolve, reject) => {
        let finished = false;
        const cleanup = () => { finished = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); };
        const abort = () => { cleanup(); reject(cancelled()); };
        const timer = setTimeout(() => { cleanup(); reject(new Error("Photo decoding timed out")); }, 8_000);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        Promise.resolve().then(() => createImageBitmap(blob)).then(bitmap => {
          if (finished) { bitmap.close(); return; }
          cleanup(); resolve({ source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() });
        }, error => { cleanup(); reject(error); });
      });
    } catch { if (signal?.aborted) throw cancelled(); }
  }
  // Some mobile codecs work through <img> but not createImageBitmap/decode().
  // A data URL also avoids blob URL loading failures in mobile browsers.
  const url = await readFile(blob, true, signal) as string;
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); image.onload = image.onerror = null; };
    const fail = () => { cleanup(); image.removeAttribute("src"); reject(new Error("This photo could not be decoded. Try another photo or export this one as JPEG or PNG.")); };
    const abort = () => { cleanup(); image.removeAttribute("src"); reject(cancelled()); };
    const timer = setTimeout(fail, 15_000);
    image.onload = () => { cleanup(); resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => image.removeAttribute("src") }); };
    image.onerror = fail;
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    image.src = url;
  });
}

/** Read locally and re-encode: strips metadata and bounds dimensions/upload size. */
export async function preparePhoto(file: File, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw cancelled();
  const bytes = await readPhotoSource(file, signal);
  const mime = photoMime(bytes);
  const image = await decodePhoto(new Blob([new Uint8Array(bytes)], { type: mime }), signal);
  const canvas = document.createElement("canvas");
  try {
    if (!image.width || !image.height || image.width * image.height > 50_000_000) throw new Error("This photo's dimensions are too large. Resize it first.");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo processing is unavailable in this browser.");
    for (const [longest, quality] of [[2048,0.86],[2048,0.72],[1536,0.82],[1536,0.65],[1024,0.72]] as const) {
      if (signal?.aborted) throw cancelled();
      const scale = Math.min(1, longest / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
      // Stay below common reverse proxies' 1 MiB request limit.
      if (blob && blob.type === "image/jpeg" && blob.size <= 900_000) return new Uint8Array(await readFile(blob, false, signal) as ArrayBuffer);
    }
    throw new Error("This photo is still too large after resizing. Choose a smaller image.");
  } finally { image.dispose(); canvas.width = canvas.height = 0; }
}
