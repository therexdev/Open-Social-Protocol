import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "./format";

describe("safeHttpUrl", () => {
  it("accepts only http(s) links of a sane length", () => {
    expect(safeHttpUrl("https://example.org/a?b=1")).toBe("https://example.org/a?b=1");
    expect(safeHttpUrl("http://example.org")).toBe("http://example.org");
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "chrome-extension://abc/index.html", "file:///etc/passwd", "ftp://x", "not a url", "", undefined, 42, "https://example.org/" + "x".repeat(2100)]) {
      expect(safeHttpUrl(bad)).toBeUndefined();
    }
  });
});
