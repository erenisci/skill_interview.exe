import { z } from 'zod';
import { appError, err, ok } from '@shared/result';
import type { StructuredSchema } from './adapter';

/**
 * Builds a StructuredSchema from a zod type: the JSON Schema constrains decoding,
 * the zod parse narrows the output. Parsing at the boundary is a coding standard —
 * model output is never cast (docs/engineering/coding-standards.md).
 */
export function structured<T>(name: string, type: z.ZodType<T>): StructuredSchema<T> {
  return {
    name,
    jsonSchema: z.toJSONSchema(type) as Record<string, unknown>,
    parse: (raw: unknown) => {
      const parsed = type.safeParse(raw);
      if (parsed.success) return ok(parsed.data);
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ');
      return err(
        appError('validation', 'schema-mismatch', `${name} failed validation — ${detail}`),
      );
    },
  };
}
