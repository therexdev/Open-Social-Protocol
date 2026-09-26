import { describe, expect, it } from "vitest";
import { decodeProfileUri, encodeProfile, normalizeNickname, PROFILE_URI_PREFIX, searchPeople } from "./profile.js";
import { toBase64url } from "./encoding.js";
const person = (account: string, name: string) => ({ account, profileUri: PROFILE_URI_PREFIX + toBase64url(encodeProfile({ display_name: name })) });
describe("public nickname search", () => {
  it("matches partial names, accents and Unicode variants, retaining duplicate names", () => {
    const people = [person("1B", "Café Friends"), person("1A", "CAFÉ"), person("1C", "Café"), person("1D", "Someone Else")];
    expect(searchPeople(people, " cafe ").map(x => x.account)).toEqual(["1A", "1C", "1B"]);
    expect(normalizeNickname("  ＡＮＡ   María  ")).toBe("ana maria");
    expect(searchPeople(people, "friend").map(x => x.account)).toEqual(["1B"]);
  });
  it("keeps address case significant and treats wildcard/markup input as literal text", () => {
    const people = [person("1AB", "<script>hello</script>"), person("1Ab", "100%_real")];
    expect(searchPeople(people, "1Ab").map(x => x.account)).toEqual(["1Ab"]);
    expect(searchPeople(people, "%_").map(x => x.account)).toEqual(["1Ab"]);
    expect(searchPeople(people, "' OR 1=1")).toEqual([]);
    expect(searchPeople(people, "script")[0]?.account).toBe("1AB");
  });
  it("ignores external, malformed and oversized profile documents without throwing", () => {
    for (const uri of [undefined, "https://example.com/profile", PROFILE_URI_PREFIX + "!!!", PROFILE_URI_PREFIX + "_w==", PROFILE_URI_PREFIX + "a".repeat(513)]) expect(decodeProfileUri(uri)).toBeUndefined();
    const bad = { account: "1Bad", profileUri: PROFILE_URI_PREFIX + "!!!!" };
    expect(searchPeople([bad, person("1Good", "Test")], "test").map(x => x.account)).toEqual(["1Good"]);
    expect(searchPeople([bad], "1Bad")).toEqual([bad]);
  });
});
