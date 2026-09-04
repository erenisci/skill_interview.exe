import type { LlmReadiness } from '@shared/domain';
import type { AppContext } from '../context';
import type { LlmAdapter } from '../llm/adapter';
import { OllamaLlmAdapter } from '../llm/ollama';

/**
 * Distinguishes the failure modes that need different fixes.
 *
 * "Ollama is not installed", "Ollama is running but no model is pulled", and "the selected
 * model is gone" look alike from the code's side and are completely different problems for
 * the user. Conflating them is the single easiest way to make the setup screen useless
 * (docs/operations/error-handling.md).
 */

/**
 * Builds something that can ask Ollama what it has, given only a URL.
 *
 * Injected rather than constructed inline so this check is testable without a network:
 * the interesting branch is the one taken when no model has been selected, and hard-wiring
 * a real adapter there would make that branch reachable only with Ollama actually running.
 * `model` is unused — listing hits `/api/tags`, which does not take one.
 */
export type LlmProbe = (url: string) => LlmAdapter;

const defaultProbe: LlmProbe = (url) => new OllamaLlmAdapter({ url, model: '' });

export async function checkLlmReadiness(
  ctx: Pick<AppContext, 'llm' | 'settings'>,
  probe: LlmProbe = defaultProbe,
): Promise<LlmReadiness> {
  const url = ctx.settings.get('ollama_url') ?? '';

  // `ctx.llm` is the stub exactly when no model has been selected yet — which is the one
  // case this check exists to resolve. Asking the stub what models exist would only ever
  // answer with itself, so Ollama is asked directly instead.
  const source = ctx.llm.id === 'stub' ? probe(url) : ctx.llm;

  const models = await source.listModels();
  if (!models.ok) {
    return { state: 'unreachable', url, detail: models.error.message };
  }

  const selected = ctx.settings.get('ollama_model');
  if (!selected || !models.value.includes(selected)) {
    return { state: 'no-model', models: models.value };
  }

  return { state: 'ready', models: models.value, selected };
}
