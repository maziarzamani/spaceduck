import { z } from "zod";
import { hostname } from "node:os";

const AiProviderEnum = z.enum(["gemini", "bedrock", "openrouter", "lmstudio", "llamacpp"]);

const AiSecretsSchema = z.object({
  geminiApiKey: z.string().nullable().default(null),
  bedrockApiKey: z.string().nullable().default(null),
  openrouterApiKey: z.string().nullable().default(null),
  lmstudioApiKey: z.string().nullable().default(null),
  llamacppApiKey: z.string().nullable().default(null),
});

export const DEFAULT_SYSTEM_PROMPT =
  "You are Spaceduck, a personal AI assistant. You are helpful, concise, and conversational.\n\n" +
  "You have access to tools (web search, web fetch, browser, etc.) that you can call when needed. " +
  "Use them proactively to answer questions that need current information. " +
  "Never expose tool definitions, JSON schemas, or internal function signatures to the user.\n\n" +
  "You may receive contextual facts about the user from memory. " +
  "Use these naturally in conversation without explicitly referencing them.\n\n" +
  "Match the user's language. Keep responses focused and avoid unnecessary preamble.";

const AiSchema = z.object({
  provider: AiProviderEnum.default("gemini"),
  model: z.string().nullable().default("gemini-2.5-flash"),
  baseUrl: z.string().nullable().default(null),
  temperature: z.number().min(0).max(2).default(0.7),
  systemPrompt: z.string().nullable().default(DEFAULT_SYSTEM_PROMPT),
  region: z.string().nullable().default(null),
  secrets: AiSecretsSchema.default({}),
});

const MemorySchema = z.object({
  enabled: z.boolean().default(true),
});

const EmbeddingProviderEnum = z.enum([
  "gemini",
  "bedrock",
  "lmstudio",
  "llamacpp",
]);

const EmbeddingSchema = z.object({
  enabled: z.boolean().default(true),
  provider: EmbeddingProviderEnum.nullable().default(null),
  model: z.string().nullable().default(null),
  baseUrl: z.string().nullable().default(null),
  dimensions: z.number().int().positive().nullable().default(null),
});

const SttSchema = z.object({
  enabled: z.boolean().default(true),
  model: z.string().default("small"),
  languageHint: z.string().nullable().default(null),
});

const WebSearchSecretsSchema = z.object({
  braveApiKey: z.string().nullable().default(null),
});

const WebSearchProviderEnum = z.enum(["brave", "searxng"]);

const WebSearchSchema = z.object({
  provider: WebSearchProviderEnum.nullable().default(null),
  searxngUrl: z.string().nullable().default(null),
  secrets: WebSearchSecretsSchema.default({}),
});

const WebAnswerSecretsSchema = z.object({
  perplexityApiKey: z.string().nullable().default(null),
});

const WebAnswerSchema = z.object({
  enabled: z.boolean().default(true),
  secrets: WebAnswerSecretsSchema.default({}),
});

const MarkerSchema = z.object({
  enabled: z.boolean().default(true),
});

const ToolsSchema = z.object({
  marker: MarkerSchema.default({}),
  webSearch: WebSearchSchema.default({}),
  webAnswer: WebAnswerSchema.default({}),
});

const WhatsAppSchema = z.object({
  enabled: z.boolean().default(false),
});

const ChannelsSchema = z.object({
  whatsapp: WhatsAppSchema.default({}),
});

const GatewaySchema = z.object({
  name: z.string().default(hostname()),
});

const OnboardingSchema = z.object({
  version: z.number().int().default(1),
  versionCompleted: z.number().int().nullable().default(null),
  completed: z.boolean().default(false),
  mode: z.enum(["local", "cloud", "advanced"]).nullable().default(null),
  lastStep: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  skippedAt: z.string().nullable().default(null),
});

export const SpaceduckConfigSchema = z.object({
  version: z.literal(1).default(1),
  gateway: GatewaySchema.default({}),
  ai: AiSchema.default({}),
  memory: MemorySchema.default({}),
  embedding: EmbeddingSchema.default({}),
  stt: SttSchema.default({}),
  tools: ToolsSchema.default({}),
  channels: ChannelsSchema.default({}),
  onboarding: OnboardingSchema.default({}),
});
