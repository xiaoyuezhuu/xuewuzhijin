import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { z } from "zod";
import { LLM, type PassName } from "./config.ts";
import { log } from "./util.ts";

/**
 * One structured-output call, over whichever provider a pass is configured
 * for. Both paths return a value already validated against the Zod schema, so
 * callers never handle raw JSON.
 *
 * Meta's Model API speaks the OpenAI Chat Completions protocol; its
 * Anthropic-compatible Messages endpoint is not documented to support
 * structured output, so the OpenAI shape is the one used here.
 */
export interface StructuredRequest<T> {
  pass: PassName;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Identifies the schema to the provider; must be a bare identifier. */
  schemaName: string;
}

const META_BASE_URL = process.env.META_BASE_URL ?? "https://api.meta.ai/v1";

let anthropicClient: Anthropic | undefined;
let metaClient: OpenAI | undefined;

function anthropic(): Anthropic {
  if (!anthropicClient) {
    // An org-level key must name a workspace on every request; a
    // workspace-scoped key already carries it.
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    anthropicClient = new Anthropic(
      workspaceId
        ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } }
        : {},
    );
  }
  return anthropicClient;
}

function meta(): OpenAI {
  if (!metaClient) {
    const apiKey = process.env.MODEL_API_KEY ?? process.env.META_API_KEY;
    if (!apiKey) {
      throw new Error(
        "MODEL_API_KEY is not set — the Meta Model API needs one. " +
          "Set LLM_PROVIDER=anthropic to use Claude instead.",
      );
    }
    metaClient = new OpenAI({ apiKey, baseURL: META_BASE_URL });
  }
  return metaClient;
}

/** Providers reject the $schema key that Zod emits by default. */
function jsonSchemaOf(schema: z.ZodType<unknown>): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

async function viaAnthropic<T>(req: StructuredRequest<T>): Promise<T> {
  const { model, effort, maxTokens } = LLM[req.pass];
  const response = await anthropic().messages.parse({
    model,
    max_tokens: maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    output_config: { effort, format: zodOutputFormat(req.schema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`${req.pass}: the model declined this request`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(`${req.pass}: hit max_tokens before finishing`);
  }
  if (!response.parsed_output) {
    throw new Error(`${req.pass}: could not parse the model's output`);
  }
  return response.parsed_output;
}

async function viaMeta<T>(req: StructuredRequest<T>): Promise<T> {
  const { model, effort, maxTokens } = LLM[req.pass];
  const response = await meta().chat.completions.create({
    model,
    max_tokens: maxTokens,
    reasoning_effort: effort,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: req.schemaName, schema: jsonSchemaOf(req.schema) },
    },
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);

  const choice = response.choices[0];
  if (choice?.finish_reason === "length") {
    throw new Error(
      `${req.pass}: hit max_tokens (${maxTokens}) before finishing — ` +
        "reasoning tokens count against it, so raise maxTokens in config.ts",
    );
  }
  if (choice?.finish_reason === "content_filter") {
    throw new Error(`${req.pass}: the model declined this request`);
  }

  const content = choice?.message?.content;
  if (!content) throw new Error(`${req.pass}: empty response`);

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error(`${req.pass}: response was not valid JSON`);
  }

  // Validated here rather than trusted: json_schema adherence is a strong
  // hint, not a guarantee, and a shape error should name its field.
  const parsed = req.schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${req.pass}: response did not match the schema — ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const usage = response.usage;
  if (usage) {
    const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0;
    log(
      req.pass,
      `${model} · ${usage.prompt_tokens} in, ${usage.completion_tokens} out` +
        (reasoning ? ` (${reasoning} reasoning)` : ""),
    );
  }
  return parsed.data;
}

export async function generate<T>(req: StructuredRequest<T>): Promise<T> {
  return LLM[req.pass].provider === "anthropic"
    ? viaAnthropic(req)
    : viaMeta(req);
}
