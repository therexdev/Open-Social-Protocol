// as-pect 8 configuration. Run through ../scripts/test.mjs, which resolves the
// as-pect assembly entry (OSP_ASPECT_ASSEMBLY_INDEX) and generates the asconfig.
const { MockVM } = require("@koinos/mock-vm");

const aspectIndex = process.env.OSP_ASPECT_ASSEMBLY_INDEX;

module.exports = {
  entries: ["assembly/__tests__/**/*.spec.ts"],
  include: ["assembly/__tests__/**/*.include.ts", ...(aspectIndex ? [aspectIndex] : [])],
  flags: { "--runtime": ["incremental"] },
  disclude: [/node_modules/],
  async instantiate(memory, createImports, instantiate, binary) {
    const mockVM = new MockVM();
    require("../scripts/mock-vm-storage.cjs").fixMockStorageOrdering(mockVM);
    // The mock DB retains protobuf byte views into WASM memory. Real chain storage copies
    // writes; copy here too, or GC overwrites stored records during long lifecycle tests.
    const putObject = mockVM.db.putObject.bind(mockVM.db);
    mockVM.db.putObject = (space, key, value) => putObject(space, key, Uint8Array.from(value));
    const myImports = {
      wasi_snapshot_preview1: { fd_write: () => {}, proc_exit: () => {} },
      env: { ...mockVM.getImports() },
    };
    const instance = await instantiate(binary, createImports(myImports));
    instance.exports.memory.grow(512);
    mockVM.setInstance(instance);
    return instance;
  },
  outputBinary: false,
};
