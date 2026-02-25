import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  type AudioStream,
  type LanguageCode,
} from "@aws-sdk/client-transcribe-streaming";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { SttError } from "./stt-error";

export interface TranscribeResult {
  text: string;
  language: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface TranscribeOptions {
  languageHint?: string;
  timeoutMs?: number;
}

export interface AvailabilityResult {
  ok: boolean;
  reason?: string;
}

interface AwsTranscribeConfig {
  region?: string;
  languageCode?: string;
  timeoutMs?: number;
  profile?: string | null;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

const DEFAULT_REGION = "us-east-1";
const DEFAULT_LANGUAGE = "en-US";
const DEFAULT_TIMEOUT_MS = 60_000;
const SAMPLE_RATE = 16_000;
const CHUNK_SIZE = 6400; // 200ms of 16kHz 16-bit mono PCM

/**
 * Convert an audio file to PCM s16le via ffmpeg, returning the raw bytes.
 * AWS Transcribe Streaming recommends PCM signed 16-bit little-endian.
 */
function audioFileToPcm(
  filePath: string,
  timeoutMs: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-i", filePath,
      "-f", "s16le",
      "-ar", String(SAMPLE_RATE),
      "-ac", "1",
      "-loglevel", "error",
      "pipe:1",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(new SttError("TIMEOUT", `ffmpeg conversion timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").slice(-500);
        reject(new SttError("INVALID_AUDIO", `ffmpeg exited with code ${code}: ${stderr}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new SttError("INVALID_AUDIO", `ffmpeg error: ${err.message}`));
    });
  });
}

/**
 * Yield PCM data as AudioStream events in chunks suitable for AWS Transcribe.
 */
async function* pcmToAudioStream(pcmData: Buffer): AsyncGenerator<AudioStream> {
  for (let offset = 0; offset < pcmData.length; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, pcmData.length);
    yield { AudioEvent: { AudioChunk: pcmData.subarray(offset, end) } };
  }
}

export class AwsTranscribeStt {
  private readonly client: TranscribeStreamingClient;
  private readonly languageCode: string;
  private readonly timeoutMs: number;

  constructor(config?: AwsTranscribeConfig) {
    const region = config?.region
      ?? this.env("AWS_REGION")
      ?? this.env("SPACEDUCK_AWS_TRANSCRIBE_REGION")
      ?? DEFAULT_REGION;

    this.languageCode = config?.languageCode
      ?? this.env("SPACEDUCK_AWS_TRANSCRIBE_LANGUAGE")
      ?? DEFAULT_LANGUAGE;

    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const clientOpts: ConstructorParameters<typeof TranscribeStreamingClient>[0] = {
      region,
    };

    const profile = config?.profile ?? this.env("AWS_PROFILE");
    if (config?.credentials) {
      clientOpts.credentials = config.credentials;
    } else if (profile) {
      clientOpts.credentials = fromIni({ profile });
    }

    this.client = new TranscribeStreamingClient(clientOpts);
  }

  private env(key: string): string | undefined {
    return typeof Bun !== "undefined" ? Bun.env[key] : process.env[key];
  }

  /**
   * Check if AWS credentials are available by attempting to resolve them
   * through the SDK's credential provider chain. When a profile is specified,
   * uses fromIni to read ~/.aws/credentials directly.
   */
  static async isAvailable(opts?: { region?: string; profile?: string | null }): Promise<AvailabilityResult> {
    try {
      const env = typeof Bun !== "undefined" ? Bun.env : process.env;
      const region = opts?.region ?? env.AWS_REGION ?? "us-east-1";
      const profile = opts?.profile ?? env.AWS_PROFILE;

      const clientOpts: ConstructorParameters<typeof TranscribeStreamingClient>[0] = { region };
      if (profile) {
        clientOpts.credentials = fromIni({ profile });
      }

      const client = new TranscribeStreamingClient(clientOpts);
      const creds = await client.config.credentials();
      if (creds.accessKeyId) {
        return { ok: true };
      }
      return {
        ok: false,
        reason: "AWS credentials resolved but appear empty.",
      };
    } catch (err) {
      return {
        ok: false,
        reason: `No AWS credentials found: ${err instanceof Error ? err.message : String(err)}. ` +
          "Ensure ~/.aws/credentials exists, set awsTranscribe.profile in config, or provide AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.",
      };
    }
  }

  /**
   * Transcribe a local audio file using AWS Transcribe Streaming.
   * The file is first converted to PCM s16le via ffmpeg, then streamed to AWS.
   */
  async transcribeFile(
    localPath: string,
    opts?: TranscribeOptions,
  ): Promise<TranscribeResult> {
    const stat = statSync(localPath);
    if (stat.size === 0) {
      throw new SttError("INVALID_AUDIO", "Audio file is empty");
    }

    const pcmData = await audioFileToPcm(localPath, this.timeoutMs);
    if (pcmData.length === 0) {
      throw new SttError("INVALID_AUDIO", "ffmpeg produced no PCM output");
    }

    const languageCode = (opts?.languageHint
      ? this.isoToTranscribeLanguage(opts.languageHint)
      : this.languageCode) as LanguageCode;

    const command = new StartStreamTranscriptionCommand({
      LanguageCode: languageCode,
      MediaEncoding: "pcm",
      MediaSampleRateHertz: SAMPLE_RATE,
      AudioStream: pcmToAudioStream(pcmData),
    });

    const timeout = opts?.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await this.client.send(command, {
        abortSignal: controller.signal,
      });

      if (!response.TranscriptResultStream) {
        throw new SttError("PARSE_ERROR", "No TranscriptResultStream in response");
      }

      const segments: Array<{ start: number; end: number; text: string }> = [];
      const finalTexts: string[] = [];

      for await (const event of response.TranscriptResultStream) {
        if (event.TranscriptEvent?.Transcript?.Results) {
          for (const result of event.TranscriptEvent.Transcript.Results) {
            if (result.IsPartial) continue;
            const transcript = result.Alternatives?.[0]?.Transcript;
            if (transcript) {
              finalTexts.push(transcript);
              segments.push({
                start: result.StartTime ?? 0,
                end: result.EndTime ?? 0,
                text: transcript,
              });
            }
          }
        }
      }

      const text = finalTexts.join(" ").trim();
      return {
        text,
        language: languageCode,
        segments: segments.length > 0 ? segments : undefined,
      };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof SttError) throw err;
      if (controller.signal.aborted) {
        throw new SttError("TIMEOUT", `AWS Transcribe timed out after ${timeout}ms`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("credential") || msg.includes("Credential")) {
        throw new SttError("CREDENTIALS_MISSING", msg);
      }
      throw new SttError("SERVICE_ERROR", msg);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Map ISO 639-1 language codes (e.g. "en", "de") to AWS Transcribe
   * language codes (e.g. "en-US", "de-DE").
   */
  private isoToTranscribeLanguage(iso: string): string {
    if (iso.includes("-")) return iso;

    const map: Record<string, string> = {
      en: "en-US", es: "es-US", fr: "fr-FR", de: "de-DE",
      it: "it-IT", pt: "pt-BR", nl: "nl-NL", ja: "ja-JP",
      ko: "ko-KR", zh: "zh-CN", ar: "ar-SA", hi: "hi-IN",
      da: "da-DK", sv: "sv-SE", no: "no-NO", fi: "fi-FI",
      pl: "pl-PL", ru: "ru-RU", tr: "tr-TR", he: "he-IL",
      th: "th-TH", vi: "vi-VN", id: "id-ID", ms: "ms-MY",
    };

    return map[iso.toLowerCase()] ?? `${iso}-${iso.toUpperCase()}`;
  }
}
