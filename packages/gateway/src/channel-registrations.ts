import type { Channel, Logger } from "@spaceduck/core";
import type { SpaceduckProductConfig } from "@spaceduck/config";

/**
 * Build a Channel array from config.
 * Pure function: only depends on config snapshot, Bun.env, and injected deps.
 */
export function buildChannels(
  config: SpaceduckProductConfig,
  logger: Logger,
): Channel[] {
  const channels: Channel[] = [];

  if (config.channels.whatsapp.enabled) {
    const { WhatsAppChannel } = require("@spaceduck/channel-whatsapp");
    channels.push(
      new WhatsAppChannel({
        logger,
        authDir: Bun.env.WHATSAPP_AUTH_DIR,
      }),
    );
  }

  return channels;
}
