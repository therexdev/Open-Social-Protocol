import { describe, expect, it } from "vitest";
import { SponsorClient, SponsorError } from "./sponsor.js";

describe("interrupted sponsor responses", () => {
  it("classifies a response body aborted after headers as a retryable transport failure", async () => {
    const interrupted = new DOMException("Fetch is aborted", "AbortError");
    const client = new SponsorClient({ endpoint: "https://sponsor.test", fetch: async () =>
      new Response(new ReadableStream({ start(controller) { controller.error(interrupted); } })) });
    const error = await client.allocatePrivateUsage({ reservationId: "saved", actor: "alias", signature: "proof" }).catch(e => e);
    expect(error).toBeInstanceOf(SponsorError);
    expect(error.category).toBe("temporarily_unavailable");
    expect(error.cause).toBe(interrupted);
  });
});
