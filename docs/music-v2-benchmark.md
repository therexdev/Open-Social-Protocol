# Good Vibes upload comparison — November 3, 2026

The original `OpenSocial-Good-Vibes-330.mp3` is 8,403,298 bytes, SHA-256
`7a8fe18649ab8677a30876c3a51d12370d0917e314c6c3387c61c3392aa84031`.
The byte and transaction-count comparison uses that exact file.

| Encoding | File bytes | Previous upload transactions | Batched upload transactions | Current upload fee |
| --- | ---: | ---: | ---: | ---: |
| Original 320 kbps MP3 | 8,403,298 | 514 | 130 | 724 KOIN/tKOIN |
| Re-encoded 192 kbps MP3 | 5,041,885 | 309 | 78 | 435 KOIN/tKOIN |
| Re-encoded 128 kbps MP3 | 3,361,271 | 207 | 53 | 290 KOIN/tKOIN |

Each count includes one upload-payment transaction and excludes optional access
key deliveries, purchases and comments. The 192/128 kbps samples were encoded
with FFmpeg/libmp3lame from the original Good Vibes MP3, removing metadata. These
are lossy re-encodes, not equivalent-quality originals. No automatic transcoding
was added to the uploader and no listening-quality equivalence is claimed.

The original file has 513 chunks. Four-chunk batches need 129 append transactions,
versus 513 previously: 74.85% fewer append transactions. The original audio bytes
and quality are unchanged. Private/paid encryption adds a 16-byte authentication
tag; this file still fits in 513 chunks.

For the fixed benchmark metadata in `scripts/benchmark-music.ts`, the previous
implementation serializes/writes 9,033,803 bytes of track manifests across appends.
The new implementation writes 356 bytes of progress messages across batches.
This measures repeated processing, not extra disk occupied: rewriting an object
in place did not allocate another full copy in active chain state. The new
implementation still reads the manifest once per batch and stores every audio
byte. Transaction signatures and other overhead also change.

**No measured Mana reduction is claimed.** Both existing audio test accounts had
zero testnet Mana, and no funded deployer credential was present in this working
session. The 724/435/290 values are the current application price formula, not
measured resource charges. No upload-price reduction or production deployment
was performed as part of this comparison.

## Reproduce

```bash
npm run build -w packages/proto -w packages/sdk
node --import tsx scripts/benchmark-music.ts --audio /path/to/OpenSocial-Good-Vibes-330.mp3 --output music-byte-results.json
```

For controlled node resource simulations, retain the pre-change publications WASM
and set `KOINOS_HARBINGER_DEPLOYER_WIF` through the existing secure environment to
a funded **testnet** payer. The script asserts the Harbinger chain id and always
passes `broadcast=false`:

```bash
node --import tsx scripts/benchmark-music.ts --audio /path/to/OpenSocial-Good-Vibes-330.mp3 --baseline-wasm /path/to/publications-before.wasm --simulate --output music-resource-results.json
```

It simulates 0, 1, 4 and 16 real chunks against each contract version. Each version
has a zero-chunk control that includes deployment, registration and reservation;
subtract that control to isolate append work. Report disk, network, compute and
Mana separately. These batch simulations are not a complete-file broadcast test;
transaction base costs and resource-price changes must be accounted for before
projecting a whole song's Mana use. Run a full upload on the target test network
before setting a new public price.

## Local validation

The affected suites passed: publications 129, OSAT token 37, sponsorship registry
43, SDK 124, sponsor service 72, and web 366 (two existing skips). Browser checks
used synthetic identities and mocked chain reads: the original public song and
the encrypted/delivered song each loaded with a 210-second duration and started playback. Upload, locked purchase
and delivered screens fit a 390-pixel mobile viewport without overflow or page
errors. The public track page also passed at 1280 pixels. These checks do not
replace the funded testnet deployment and paid-unlock integration check.
