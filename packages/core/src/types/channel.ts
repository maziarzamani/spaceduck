// Channel interface for messaging adapters

import type { Message } from "./message";
import type { Lifecycle } from "./lifecycle";

export interface ChannelMessage {
  readonly channelId: string;
  readonly senderId: string;
  readonly content: string;
  readonly requestId: string;
}

export interface ChannelResponse {
  readonly conversationId: string;
  readonly requestId: string;
}

export interface Channel extends Lifecycle {
  readonly name: string;

  /**
   * Called by gateway to register a handler for incoming messages.
   * The channel calls this handler whenever a user sends a message.
   */
  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void;

  /**
   * Send a response back to the user through this channel.
   */
  sendText(senderId: string, text: string, response: ChannelResponse): Promise<void>;

  /**
   * Send a stream delta back to the user.
   */
  sendDelta(senderId: string, delta: string, response: ChannelResponse): Promise<void>;

  /**
   * Signal that streaming is complete.
   */
  sendDone(senderId: string, messageId: string, response: ChannelResponse): Promise<void>;

  /**
   * Signal that an error occurred.
   */
  sendError(senderId: string, code: string, message: string, response: ChannelResponse): Promise<void>;
}
