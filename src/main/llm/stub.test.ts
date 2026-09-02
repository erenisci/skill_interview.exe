import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { structured } from './schema';
import { StubLlmAdapter } from './stub';

const SHAPE = structured('test', z.object({ answer: z.string() }));

describe('StubLlmAdapter', () => {
  it('returns queued responses in order', async () => {
    const stub = new StubLlmAdapter([{ answer: 'first' }, { answer: 'second' }]);
    const a = await stub.generate({ system: '', prompt: '', schema: SHAPE });
    const b = await stub.generate({ system: '', prompt: '', schema: SHAPE });
    expect(a.ok && a.value.value.answer).toBe('first');
    expect(b.ok && b.value.value.answer).toBe('second');
  });

  it('still validates, so a stub cannot smuggle in output the validator would reject', async () => {
    const stub = new StubLlmAdapter([{ wrong: true }]);
    const result = await stub.generate({ system: '', prompt: '', schema: SHAPE });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('schema-mismatch');
  });

  it('fails clearly when nothing is queued rather than inventing a response', async () => {
    const result = await new StubLlmAdapter().generate({ system: '', prompt: '', schema: SHAPE });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('stub-exhausted');
  });

  it('counts releases so the queue can be asserted to free the model', async () => {
    const stub = new StubLlmAdapter();
    await stub.release();
    await stub.release();
    expect(stub.releaseCount).toBe(2);
  });
});
