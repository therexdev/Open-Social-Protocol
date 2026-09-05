/**
 * First import of the service worker: protobufjs must not generate code under the MV3 CSP.
 * Import order is evaluation order, so this runs before @osp/sdk or koilib encode anything.
 */
import { installNoEvalProtobuf } from "../shared/protobufNoEval";

installNoEvalProtobuf();
