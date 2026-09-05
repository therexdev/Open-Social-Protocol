import { webcrypto } from "node:crypto";
import { installNoEvalProtobuf } from "../shared/protobufNoEval";
import { installChromeMock } from "./chromeMock";

// jsdom has no SubtleCrypto; the extension uses WebCrypto for the key cache.
if (!(globalThis.crypto as Crypto | undefined)?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// Every test runs through the same protobuf runtime as the MV3 service worker (no code generation).
installNoEvalProtobuf();
installChromeMock();
