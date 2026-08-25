/**
 * Channel adapter interface for unified message sending and webhook parsing
 * Implementations: WhatsApp, Instagram, Messenger
 */

export interface ParsedMessage {
  from: string;
  channelMessageId: string;
  text: string;
  customerName: string;
  timestamp: string;
}

export interface ChannelAdapter {
  /**
   * Send a message via the channel's API
   */
  sendMessage(params: {
    to: string;
    text: string;
    accessToken: string;
    phoneNumberId?: string;
    pageId?: string;
  }): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }>;

  /**
   * Parse incoming webhook payload
   */
  parseWebhook(body: unknown): ParsedMessage[];

  /**
   * Verify webhook signature
   */
  verifySignature(
    body: string,
    signature: string,
    appSecret: string
  ): boolean;
}
