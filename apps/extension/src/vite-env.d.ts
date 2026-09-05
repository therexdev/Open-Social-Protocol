/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OSP_NETWORK?: string;
  readonly VITE_OSP_RPC_URLS?: string;
  readonly VITE_OSP_INDEXER_URL?: string;
  readonly VITE_OSP_SPONSOR_URL?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
