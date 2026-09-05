/**
 * First setup file (see vitest.config.ts): vitest's jsdom environment copies jsdom's own
 * `Uint8Array` constructor onto the global, while Node's `Buffer`, `TextEncoder`, WebCrypto and
 * the externalized dependencies (protobufjs, koilib, @noble/*) produce Node-realm arrays. Those
 * then fail `instanceof Uint8Array` checks (koilib's sha256 of a protobuf `Buffer`, for example).
 * A browser has a single realm, so this only matters in tests: restore Node's constructor before
 * any dependency captures the global.
 */
import { Buffer } from "node:buffer";

const nodeUint8Array = Object.getPrototypeOf(Buffer.prototype).constructor as Uint8ArrayConstructor;
if (globalThis.Uint8Array !== nodeUint8Array) {
  Object.defineProperty(globalThis, "Uint8Array", { value: nodeUint8Array, configurable: true, writable: true, enumerable: false });
}
