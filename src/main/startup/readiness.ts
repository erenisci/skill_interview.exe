import type { LlmReadiness } from '@shared/domain';
import type { AppContext } from '../context';

/**
 * Distinguishes the failure modes that need different fixes.
 *
 * "Ollama is not installed", "Ollama is running but no model is pulled", and "the selected
 * model is gone" look alike from the code's side and are completely different problems for
 * the user. Conflating them is the single easiest way to make the setup screen useless
 * (docs/operations/error-handling.md).
 */
export async function checkLlmReadiness(ctx: AppContext): Promise<LlmReadiness> {
  if (ctx.llm.id === 'stub') return { state: 'stub' };

  const models = await ctx.llm.listModels();
  if (!models.ok) {
    return {
      state: 'unreachable',
      url: ctx.settings.get('ollama_url') ?? '',
      detail: models.error.message,
    };
  }

  const selected = ctx.settings.get('ollama_model');
  if (!selected || !models.value.includes(selected)) {
    return { state: 'no-model', models: models.value };
  }

  return { state: 'ready', models: models.value, selected };
}
