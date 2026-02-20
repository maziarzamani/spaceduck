export type SttErrorCode =
  | "BINARY_NOT_FOUND"
  | "TIMEOUT"
  | "MODEL_NOT_FOUND"
  | "INVALID_AUDIO"
  | "PARSE_ERROR"
  | "TOO_LARGE"
  | "UNKNOWN";

export class SttError extends Error {
  readonly code: SttErrorCode;

  constructor(code: SttErrorCode, message: string) {
    super(message);
    this.name = "SttError";
    this.code = code;
  }
}
