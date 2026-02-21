// ThinkStripper — strips <think>…</think> blocks from model output in real-time.
//
// Qwen3 and similar thinking models stream reasoning blocks inline as
// <think>…</think>. This class buffers the raw stream and emits only the
// visible (non-thinking) text, discarding the reasoning content.

const enum ThinkState {
  Normal,
  InsideThink,
}

export class ThinkStripper {
  private state = ThinkState.Normal;
  private buf = "";

  /** Feed a raw text chunk. Returns the visible (non-think) text to emit. */
  feed(text: string): string {
    let out = "";
    this.buf += text;

    while (this.buf.length > 0) {
      if (this.state === ThinkState.Normal) {
        const openIdx = this.buf.indexOf("<think>");
        if (openIdx === -1) {
          const safeEnd = this.findSafeFlush(this.buf, "<think>");
          out += this.buf.slice(0, safeEnd);
          this.buf = this.buf.slice(safeEnd);
          break;
        }
        out += this.buf.slice(0, openIdx);
        this.buf = this.buf.slice(openIdx + 7); // skip "<think>"
        this.state = ThinkState.InsideThink;
      } else {
        const closeIdx = this.buf.indexOf("</think>");
        if (closeIdx === -1) {
          if (this.buf.length > 8) {
            this.buf = this.buf.slice(-7);
          }
          break;
        }
        this.buf = this.buf.slice(closeIdx + 8); // skip "</think>"
        this.state = ThinkState.Normal;
      }
    }

    return out;
  }

  /** Flush any remaining buffer at end of stream. */
  flush(): string {
    if (this.state === ThinkState.Normal) {
      const rest = this.buf;
      this.buf = "";
      return rest;
    }
    this.buf = "";
    return "";
  }

  private findSafeFlush(buf: string, tag: string): number {
    for (let overlap = Math.min(tag.length - 1, buf.length); overlap > 0; overlap--) {
      if (tag.startsWith(buf.slice(-overlap))) {
        return buf.length - overlap;
      }
    }
    return buf.length;
  }
}
