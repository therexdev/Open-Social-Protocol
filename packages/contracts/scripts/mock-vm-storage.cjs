// @koinos/mock-vm 1.x compares Buffer keys using JavaScript < and >, which
// converts them to UTF-8 strings. Distinct binary keys containing invalid UTF-8
// then collide. Koinos database keys are lexicographic bytes, not strings.
const { SoMap } = require("somap");
function fixMockStorageOrdering(vm) {
  const putObject = vm.db.putObject.bind(vm.db);
  // Protobuf byte fields can alias transient WASM argument memory. A database
  // owns its bytes; otherwise GC/reuse silently changes already stored values.
  vm.db.putObject = (space, key, value) => putObject(space, key, Buffer.from(value));
  vm.db.comparator = (a, b) => Buffer.compare(a, b);
  vm.db.commitTransaction = function () { this.backupDb = new SoMap(this.db, this.comparator); };
  vm.db.initDb([...vm.db.db]);
}
module.exports = { fixMockStorageOrdering };
