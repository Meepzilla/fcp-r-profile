import { describe, expect, it } from 'vitest';
import { schema } from '../src/lib/schema';
import { allQuestions, sectionQuestions } from '../src/lib/types';

describe('generated schema', () => {
  it('holds 13 sections and 147 questions or groups', () => {
    expect(schema.sections).toHaveLength(13);
    expect(schema.counts.sections).toBe(13);
    expect(schema.counts.questions).toBe(147);
    expect(allQuestions(schema)).toHaveLength(147);
    expect(schema.counts.items).toBe(161);
  });

  it('per-section question counts match the source form', () => {
    const counts = schema.sections.map((s) => sectionQuestions(s).length);
    expect(counts).toEqual([11, 15, 8, 17, 12, 10, 27, 10, 3, 5, 6, 10, 13]);
  });

  it('holds the Level of Impairment grid at 11 rows by 6 columns', () => {
    const grid = allQuestions(schema).find(
      (q) => q.kind === 'grid' && q.title.startsWith('Level of Impairment'),
    );
    expect(grid).toBeDefined();
    expect(grid?.grid?.rows).toHaveLength(11);
    expect(grid?.grid?.columns).toHaveLength(6);
    expect(grid?.grid?.columnType).toBe('RADIO');
    const rowTitles = grid?.grid?.rows.map((r) => r.title) ?? [];
    expect(rowTitles[0]).toContain('Sensory');
    expect(rowTitles[10]).toContain('Fluency');
  });

  it('question type counts match the source form', () => {
    const questions = allQuestions(schema);
    const byKind = (kind: string) => questions.filter((q) => q.kind === kind).length;
    expect(byKind('checkbox')).toBe(92);
    expect(byKind('radio')).toBe(5);
    expect(byKind('text-short')).toBe(26);
    expect(byKind('text-paragraph')).toBe(21);
    expect(byKind('grid')).toBe(3);
  });
});
