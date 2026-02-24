import { describe, it, expect } from "bun:test";
import { GATEWAY_VERSION, CLI_VERSION, API_VERSION, GIT_SHA } from "../version";

describe("version constants", () => {
  it("GATEWAY_VERSION is a valid semver string", () => {
    expect(typeof GATEWAY_VERSION).toBe("string");
    expect(GATEWAY_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("CLI_VERSION is a valid semver string", () => {
    expect(typeof CLI_VERSION).toBe("string");
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("API_VERSION is a positive integer", () => {
    expect(Number.isInteger(API_VERSION)).toBe(true);
    expect(API_VERSION).toBeGreaterThan(0);
  });

  it("GIT_SHA is a non-empty string", () => {
    expect(typeof GIT_SHA).toBe("string");
    expect(GIT_SHA.length).toBeGreaterThan(0);
  });

  it("versions read from package.json match actual package versions", () => {
    const gatewayPkg = require("../../../gateway/package.json");
    const cliPkg = require("../../../../apps/cli/package.json");
    expect(GATEWAY_VERSION).toBe(gatewayPkg.version);
    expect(CLI_VERSION).toBe(cliPkg.version);
  });
});
