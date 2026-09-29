import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preparePhoto } from "./preparePhoto";

const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let close: ReturnType<typeof vi.fn>, bitmap: ReturnType<typeof vi.fn>;
let imageUrls: string[], disposeImage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  close = vi.fn();
  bitmap = vi.fn(async () => ({ width: 2600, height: 1800, close }));
  vi.stubGlobal("createImageBitmap", bitmap);
  imageUrls = []; disposeImage = vi.fn();
  vi.stubGlobal("Image", class {
    naturalWidth = 1200; naturalHeight = 900;
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(url: string) { imageUrls.push(url); queueMicrotask(() => this.onload?.()); }
    removeAttribute = disposeImage;
    decode() { throw new Error("Mobile decode() failure"); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function(this: HTMLCanvasElement, callback, type) {
    expect(this.width).toBeLessThanOrEqual(2048);
    expect(this.height).toBeLessThanOrEqual(2048);
    expect(type).toBe("image/jpeg");
    callback(new Blob([jpeg], { type: "image/jpeg" }));
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("mobile photo preparation", () => {
  it.each(["", "application/octet-stream", "image/heic"])("recognizes JPEG bytes despite a file-provider MIME of %s", async type => {
    expect(await preparePhoto(new File([jpeg], "photo", { type }))).toEqual(jpeg);
    expect(bitmap.mock.calls[0]![0].type).toBe("image/jpeg");
    expect(close).toHaveBeenCalledOnce();
  });
  it("uses a data URL and load events when bitmap decoding fails; decode() and blob URLs are unnecessary", async () => {
    bitmap.mockRejectedValue(new Error("Unsupported decoder"));
    expect(await preparePhoto(new File([png], "photo.png", { type: "image/png" }))).toEqual(jpeg);
    expect(imageUrls[0]).toMatch(/^data:image\/png;base64,/);
    expect(disposeImage).toHaveBeenCalledWith("src");
  });
  it("supports browsers without createImageBitmap", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    expect(await preparePhoto(new File([jpeg], "photo.jpg"))).toEqual(jpeg);
    expect(imageUrls).toHaveLength(1);
  });
  it("rejects active content even when it is labeled as a photo", async () => {
    await expect(preparePhoto(new File(["<svg onload='alert(1)'></svg>"], "photo.jpg", { type: "image/jpeg" }))).rejects.toThrow(/SVG/);
    expect(bitmap).not.toHaveBeenCalled();
  });
  it("reports unreadable files separately from unsupported codecs", async () => {
    vi.spyOn(FileReader.prototype, "readAsArrayBuffer").mockImplementation(function(this: FileReader) { this.dispatchEvent(new ProgressEvent("error")); });
    await expect(preparePhoto(new File([jpeg], "photo.jpg"))).rejects.toThrow(/could not read this file/);
    expect(bitmap).not.toHaveBeenCalled();
  });
  it("reports an actual decoder failure after both decoding routes fail", async () => {
    bitmap.mockRejectedValue(new Error("corrupt"));
    vi.stubGlobal("Image", class {
      onload = null; onerror: (() => void) | null = null;
      set src(_url: string) { queueMicrotask(() => this.onerror?.()); }
      removeAttribute() {}
    });
    await expect(preparePhoto(new File([jpeg], "corrupt.jpg"))).rejects.toThrow(/could not be decoded/);
  });
  it("releases the decoded image on dimension rejection", async () => {
    bitmap.mockResolvedValue({ width: 10000, height: 10000, close });
    await expect(preparePhoto(new File([jpeg], "huge.jpg"))).rejects.toThrow(/dimensions/);
    expect(close).toHaveBeenCalledOnce();
  });
  it("cancels decoding when locked and disposes of a bitmap that arrives later", async () => {
    let finish!: (value: unknown) => void;
    bitmap.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const result = preparePhoto(new File([jpeg], "photo.jpg"), controller.signal);
    const rejected = expect(result).rejects.toThrow(/cancelled/);
    await vi.waitFor(() => expect(bitmap).toHaveBeenCalledOnce());
    controller.abort(); await rejected;
    finish({ width: 1200, height: 900, close });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(imageUrls).toHaveLength(0);
  });
  it("rejects an empty file and a cancelled selection before decoding", async () => {
    await expect(preparePhoto(new File([], "empty.jpg"))).rejects.toThrow(/could not read/);
    const controller = new AbortController(); controller.abort();
    await expect(preparePhoto(new File([jpeg], "photo.jpg"), controller.signal)).rejects.toThrow(/cancelled/);
    expect(bitmap).not.toHaveBeenCalled();
  });
});
