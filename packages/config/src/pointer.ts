export class PointerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PointerError";
  }
}

/**
 * Validate a JSON Pointer string per RFC 6901.
 * Must start with `/`. No empty segments (trailing slash).
 * Only `~0` and `~1` escape sequences allowed.
 */
export function validatePointer(path: string): void {
  if (path === "") {
    throw new PointerError("JSON Pointer must not be empty (use '/' prefix)");
  }
  if (!path.startsWith("/")) {
    throw new PointerError(`JSON Pointer must start with '/': "${path}"`);
  }

  const raw = path.slice(1);
  if (raw === "") {
    throw new PointerError(`JSON Pointer must have at least one segment: "${path}"`);
  }

  const segments = raw.split("/");
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === "") {
      throw new PointerError(
        `Empty segment at position ${i} in pointer "${path}" (trailing or double slash)`,
      );
    }
    validateEscapes(seg, path);
  }
}

/**
 * Decode a validated JSON Pointer into path segments.
 * Calls validatePointer first, then decodes `~1` -> `/` and `~0` -> `~`.
 */
export function decodePointer(path: string): string[] {
  validatePointer(path);
  return path
    .slice(1)
    .split("/")
    .map(decodeSegment);
}

function decodeSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function validateEscapes(segment: string, fullPath: string): void {
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] === "~") {
      const next = segment[i + 1];
      if (next !== "0" && next !== "1") {
        throw new PointerError(
          `Invalid escape sequence '~${next ?? ""}' in pointer "${fullPath}"`,
        );
      }
    }
  }
}
