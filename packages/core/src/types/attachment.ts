// Attachment metadata exposed to clients and the LLM context.
// localPath is intentionally omitted — it stays server-side only (see AttachmentStore).

export interface Attachment {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
}
