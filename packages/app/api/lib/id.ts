import { nanoid } from 'nanoid';

/** Generate a URL-safe unique ID with an optional prefix for readability */
export function generateId(prefix?: string): string {
  const id = nanoid(21);
  return prefix ? `${prefix}_${id}` : id;
}
