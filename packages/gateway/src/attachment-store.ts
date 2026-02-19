// Server-side only store that maps opaque attachment IDs to local file paths.
// The LLM and client never see localPath — this is the key security boundary.

import { existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface AttachmentEntry {
  localPath: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: number;
}

const DEFAULT_UPLOAD_DIR = "data/uploads";
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface AttachmentStoreOptions {
  uploadDir?: string;
  ttlMs?: number;
}

export class AttachmentStore {
  private readonly entries = new Map<string, AttachmentEntry>();
  private readonly uploadDir: string;
  private readonly ttlMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: AttachmentStoreOptions = {}) {
    this.uploadDir = opts.uploadDir ?? DEFAULT_UPLOAD_DIR;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;

    if (!existsSync(this.uploadDir)) {
      mkdirSync(this.uploadDir, { recursive: true });
    }

    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }

  getUploadDir(): string {
    return this.uploadDir;
  }

  register(id: string, entry: Omit<AttachmentEntry, "createdAt">): void {
    this.entries.set(id, { ...entry, createdAt: Date.now() });
  }

  resolve(id: string): string | null {
    const entry = this.entries.get(id);
    if (!entry) return null;

    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.remove(id);
      return null;
    }

    return entry.localPath;
  }

  get(id: string): AttachmentEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;

    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.remove(id);
      return null;
    }

    return entry;
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      try {
        unlinkSync(entry.localPath);
      } catch {
        // File may already be gone
      }
      this.entries.delete(id);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (now - entry.createdAt > this.ttlMs) {
        this.remove(id);
      }
    }

    // Also clean orphaned files on disk not tracked in memory
    try {
      for (const file of readdirSync(this.uploadDir)) {
        const filePath = join(this.uploadDir, file);
        try {
          const stat = statSync(filePath);
          if (now - stat.mtimeMs > this.ttlMs) {
            unlinkSync(filePath);
          }
        } catch {
          // Skip files we can't stat
        }
      }
    } catch {
      // Upload dir may not exist yet
    }
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}
