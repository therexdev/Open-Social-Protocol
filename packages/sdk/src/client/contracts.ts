/**
 * koilib Contract instances for the six protocol contracts plus typed operation builders
 * and read-only callers for every ABI method.
 */
import { Contract } from "koilib";
import type { Abi, CallContractOperationJson, OperationJson, ProviderInterface } from "koilib";
import { ABIS } from "@osp/proto";
import { CONTRACT_NAMES, type ContractName } from "../constants.js";
import { decode, EncodingError, fromBase64url, toKoilibJson, type ProtoObject } from "../encoding.js";
import type { Deployment } from "./deployments.js";
import type { ContractReadMethods, ContractWriteMethods } from "./types.js";

export interface AbiMethod {
  entry_point: number;
  argument: string;
  return: string;
  read_only: boolean;
  description: string;
}

/** `ops.<contract>.<method>(args)` builds an unsigned `call_contract` operation. */
export type OperationBuilders<M> = { [K in keyof M]: (args: M[K]) => Promise<OperationJson> };
/** `reads.<contract>.<method>(args)` calls a read-only method; `undefined` when the node returns nothing. */
export type ReadCallers<M> = {
  [K in keyof M]: M[K] extends [infer A, infer R] ? (args?: A) => Promise<R | undefined> : never;
};

export type ProtocolOperationBuilders = { [C in ContractName]: OperationBuilders<ContractWriteMethods[C]> };
export type ProtocolReadCallers = { [C in ContractName]: ReadCallers<ContractReadMethods[C]> };

export interface DecodedProtocolOperation {
  contract: ContractName;
  address: string;
  method: string;
  entryPoint: number;
  readOnly: boolean;
  args: ProtoObject;
}

export class ContractError extends Error {
  override name = "ContractError";
}

export class ProtocolContracts {
  readonly deployment: Deployment;
  readonly provider: ProviderInterface | undefined;
  /** koilib Contract per protocol contract (abi + address; provider when given). */
  readonly contracts: Record<ContractName, Contract>;
  /** Typed operation builders for write methods (and admin methods). */
  readonly ops: ProtocolOperationBuilders;
  /** Typed read-only callers (require a provider). */
  readonly reads: ProtocolReadCallers;

  constructor(deployment: Deployment, provider?: ProviderInterface) {
    this.deployment = deployment;
    this.provider = provider;
    const contracts = {} as Record<ContractName, Contract>;
    const ops = {} as Record<ContractName, Record<string, (args: ProtoObject) => Promise<OperationJson>>>;
    const reads = {} as Record<ContractName, Record<string, (args?: ProtoObject) => Promise<unknown>>>;
    for (const name of CONTRACT_NAMES) {
      contracts[name] = new Contract({
        id: deployment.contracts[name].address,
        abi: ABIS[name] as unknown as Abi,
        ...(provider && { provider }),
      });
      ops[name] = {};
      reads[name] = {};
      for (const [method, def] of Object.entries(ABIS[name].methods)) {
        if (def.read_only) {
          reads[name][method] = (args: ProtoObject = {}) => this.read(name, method, args);
        } else {
          ops[name][method] = (args: ProtoObject) => this.operation(name, method, args);
        }
      }
    }
    this.contracts = contracts;
    this.ops = ops as unknown as ProtocolOperationBuilders;
    this.reads = reads as unknown as ProtocolReadCallers;
  }

  /** The koilib Contract for `name`. */
  get(name: ContractName): Contract {
    return this.contracts[name];
  }

  /** ABI method definition. */
  method(name: ContractName, method: string): AbiMethod {
    const def = (ABIS[name].methods as Record<string, AbiMethod | undefined>)[method];
    if (!def) throw new ContractError(`${name}.${method} is not a contract method`);
    return def;
  }

  /** Method names of a contract. */
  methods(name: ContractName): string[] {
    return Object.keys(ABIS[name].methods);
  }

  /** Builds `{ call_contract }` for any method through koilib (`onlyOperation`). */
  async operation(name: ContractName, method: string, args: ProtoObject): Promise<OperationJson> {
    const def = this.method(name, method);
    const json = toKoilibJson(def.argument, args);
    const fn = this.contracts[name].functions[method];
    if (!fn) throw new ContractError(`${name}.${method} is not a contract method`);
    const { operation } = await fn(json, { onlyOperation: true });
    return operation;
  }

  /** Calls a read-only method through `provider.readContract` and decodes the result. */
  async read<T = ProtoObject>(name: ContractName, method: string, args: ProtoObject = {}): Promise<T | undefined> {
    const def = this.method(name, method);
    if (!def.read_only) throw new ContractError(`${name}.${method} is not read-only`);
    if (!this.provider) throw new ContractError("a provider is required for read-only calls");
    const operation = await this.operation(name, method, args);
    const call = operation.call_contract;
    if (!call) throw new ContractError("koilib did not return a call_contract operation");
    const { result } = await this.provider.readContract(call);
    if (!result) return undefined;
    return decode<T>(def.return, fromBase64url(result));
  }

  /** Decodes a `call_contract` operation addressed to a protocol contract; undefined otherwise. */
  decodeOperation(operation: OperationJson | CallContractOperationJson): DecodedProtocolOperation | undefined {
    const call = "call_contract" in operation ? operation.call_contract : (operation as CallContractOperationJson);
    if (!call || typeof call.contract_id !== "string") return undefined;
    const name = CONTRACT_NAMES.find((n) => this.deployment.contracts[n].address === call.contract_id);
    if (!name) return undefined;
    const entry = Object.entries(ABIS[name].methods).find(([, def]) => def.entry_point === call.entry_point);
    if (!entry) return undefined;
    const [method, def] = entry;
    let args: ProtoObject;
    try {
      args = decode(def.argument, call.args ? fromBase64url(call.args) : new Uint8Array(0));
    } catch (error) {
      if (error instanceof EncodingError) return undefined;
      throw error;
    }
    return { contract: name, address: call.contract_id, method, entryPoint: def.entry_point, readOnly: def.read_only, args };
  }
}
