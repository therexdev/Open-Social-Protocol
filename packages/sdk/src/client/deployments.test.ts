import { expect, it } from "vitest";
import { loadDeployment } from "./deployments.js";
import { fixtureDeployment } from "../testing/fixtures.js";

it("preserves the explicit token-free mode and a reserved future token address", () => {
  const d=fixtureDeployment(); d.economy="token-free"; d.contracts.token={address:d.contracts.token.address,reserved:true};
  expect(loadDeployment(JSON.stringify(d))).toMatchObject({economy:"token-free",contracts:{token:{reserved:true}}});
});
it("rejects ambiguous reserved modules and unknown economy modes", () => {
  const d=fixtureDeployment(); d.contracts.token={address:d.contracts.token.address,reserved:true};
  expect(() => loadDeployment(d)).toThrow("Only the token address");
  d.economy="token-free"; d.contracts.identity.reserved=true;
  expect(() => loadDeployment(d)).toThrow("Only the token address");
  delete d.contracts.identity.reserved; d.contracts.token.txId="pretend-upload";
  expect(() => loadDeployment(d)).toThrow("cannot have an upload");
  expect(() => loadDeployment({...fixtureDeployment(),economy:"unknown"})).toThrow("Invalid economy mode");
});
