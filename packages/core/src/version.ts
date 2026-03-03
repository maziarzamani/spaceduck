import gatewayPkg from "../../gateway/package.json";
import cliPkg from "../../../apps/cli/package.json";
import uiPkg from "../../ui/package.json";

export const GATEWAY_VERSION: string = gatewayPkg.version;
export const CLI_VERSION: string = cliPkg.version;
export const APP_VERSION: string = uiPkg.version;

/**
 * Manually bumped when the HTTP/WS contract between gateway and CLI
 * changes in a breaking way. Aligns with WS protocol envelope `v: 1`.
 */
export const API_VERSION = 1;

export const GIT_SHA: string = process.env.GIT_SHA ?? "dev";
