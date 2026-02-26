export type SttErrorCode =
  | "CREDENTIALS_MISSING"
  | "TIMEOUT"
  | "INVALID_AUDIO"
  | "SERVICE_ERROR"
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
