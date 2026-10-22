import type { z } from 'zod';
import { badRequest } from './errors';

/** Parses untrusted input with a zod schema; failures become a 400 naming the offending fields. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw badRequest('Please check the highlighted fields.', fields);
}
