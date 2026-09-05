# @osp/proto

Normative Protobuf schemas for Open Social Protocol v1.

| File | Interpreted by | Purpose |
| --- | --- | --- |
| `osp/identity.proto` | `identity` contract | Identity registration, encryption keys, device authorities, guardian recovery |
| `osp/relationships.proto` | `relationships` contract | Friend requests, follows, blocks, audience epochs |
| `osp/publications.proto` | `publications` contract | Versioned publications, lifecycle, reactions, key distribution, cross-post outcomes |
| `osp/communities.proto` | `communities` contract | Scoped roles, policies, labels, time-locked ownership |
| `osp/sponsorship.proto` | `sponsorship` contract | Sponsor discovery, policies and user grants |
| `osp/registry.proto` | `registry` contract | Time-locked contract set registry |
| `osp/envelope.proto` | clients only | Content envelope, AEAD associated data, sealed keys, profile, proof manifest |

`npm run build` generates, into `dist/`:

- `descriptors/<name>.json` - protobufjs JSON descriptors (snake_case preserved) for every schema
- `abi/<name>.json` - koilib ABIs for the six contracts (entry point = first 4 bytes of sha256(method))
- `index.js` / `index.d.ts` - typed exports of the above plus `PROTOCOL_VERSION` and event name constants

The generator is deterministic: two independent builds of the same schemas produce byte-identical output.
Conventions: every `*_arguments` message is a contract method, annotated with `// @description` and
`// @read-only true|false`; no `map<>` fields in signed structures; addresses use `(koinos.btype) = ADDRESS`.
