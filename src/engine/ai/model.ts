// The only thing the AI layer knows about a model (decisions.md D5). Claude,
// a bank's approved internal model and the fake model used in tests all fit
// behind this interface, so swapping one for another changes no other code.

export interface AiPrompt {
  /** Instructions: the rules, how to answer, what not to do. */
  system: string;
  /** The copy to check, its context and what the code rules already found. */
  user: string;
  /**
   * JSON Schema the answer must follow. Models that support structured
   * output can enforce it; the answer is validated again either way.
   */
  schema: Record<string, unknown>;
}

export interface AiModel {
  /** Shown in reports, e.g. "claude-haiku-5-5" or "fake". */
  readonly name: string;
  /**
   * Returns the model's answer as parsed JSON. It may be wrong, incomplete
   * or invented: the caller validates everything before using it. Should
   * stop work when `signal` is aborted.
   */
  respond(prompt: AiPrompt, signal: AbortSignal): Promise<unknown>;
}
