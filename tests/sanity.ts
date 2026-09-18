import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";

describe("sanity: validator/runner is up", () => {
  it("provider can fetch the current slot", async () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const slot = await provider.connection.getSlot();
    expect(slot).to.be.a("number");
  });
});
