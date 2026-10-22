// Connects Claude to the AI layer through the AiModel interface (D5). This is
// the only file that knows about Anthropic's API; swapping in another model
// means writing another file like this one. Server-side only: it needs the
// API key, which must never reach the browser.

import Anthropic from "@anthropic-ai/sdk";
import type { AiModel, AiPrompt } from "../engine";
import { AiAnswerError } from "../engine/ai/response";

export type Effort = "low" | "medium" | "high";

export interface ClaudeOptions {
  apiKey: string;
  /** Model ID, e.g. "claude-sonnet-5-5". */
  model?: string;
  /** How much the model thinks before answering: more is slower and costs more. */
  effort?: Effort;
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_EFFORT: Effort = "low";

/** Token use and time for the most recent call, for cost and speed reporting. */
export interface CallStats {
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

export interface ClaudeModel extends AiModel {
  lastCall?: CallStats;
}

/** The API rejects the `$schema` keyword's draft URL in some setups; it isn't needed. */
function forApi(schema: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...schema };
  delete copy.$schema;
  return copy;
}

export function createClaudeModel(options: ClaudeOptions): ClaudeModel {
  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? DEFAULT_EFFORT;
  // One retry for brief network blips; the AI layer's own timeout still applies.
  const client = new Anthropic({ apiKey: options.apiKey, maxRetries: 1 });

  const claude: ClaudeModel = {
    name: `${model} (effort: ${effort})`,

    async respond(prompt: AiPrompt, signal: AbortSignal): Promise<unknown> {
      const started = Date.now();
      const response = await client.messages.create(
        {
          model,
          max_tokens: 4000,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
          output_config: {
            effort,
            format: { type: "json_schema", schema: forApi(prompt.schema) },
          },
        },
        { signal },
      );
      claude.lastCall = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        ms: Date.now() - started,
      };

      if (response.stop_reason === "refusal") throw new AiAnswerError("The AI declined to review this copy");
      if (response.stop_reason === "max_tokens") throw new AiAnswerError("The AI's answer was cut off");

      const text = response.content.find((block) => block.type === "text")?.text;
      if (!text) throw new AiAnswerError("The AI gave no answer");
      try {
        return JSON.parse(text);
      } catch {
        throw new AiAnswerError("The AI's answer wasn't valid JSON");
      }
    },
  };
  return claude;
}

const EFFORTS: Effort[] = ["low", "medium", "high"];

/**
 * Builds the model from environment variables, or returns undefined if no
 * key is set (the tool then runs the code checks only).
 *   ANTHROPIC_API_KEY  required
 *   AI_MODEL           optional, default claude-sonnet-5-5
 *   AI_EFFORT          optional: low, medium or high (default low)
 */
export function claudeFromEnv(env: Record<string, string | undefined> = process.env): ClaudeModel | undefined {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return undefined;
  const effort = env.AI_EFFORT?.trim() as Effort | undefined;
  if (effort && !EFFORTS.includes(effort)) {
    throw new Error(`AI_EFFORT must be one of ${EFFORTS.join(", ")}. Got: ${effort}`);
  }
  return createClaudeModel({ apiKey, model: env.AI_MODEL?.trim() || undefined, effort });
}
