import rawSchema from '../data/fcpr-schema.json';
import type { FcprSchema } from './types';

export const schema = rawSchema as unknown as FcprSchema;

export const OTHER_VALUE = '__other__';

export function findQuestionByTitlePrefix(prefix: string) {
  for (const section of schema.sections) {
    for (const item of section.items) {
      if (item.type === 'question' && item.title.startsWith(prefix)) return item;
    }
  }
  return null;
}
