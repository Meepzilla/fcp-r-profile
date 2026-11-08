import { describe, expect, it } from 'vitest';
import { schema, findQuestionByTitlePrefix } from '../src/lib/schema';
import {
  compareEvaluations,
  evaluationToCsv,
  getImpairment,
  overallProgress,
  sectionProgress,
} from '../src/lib/answers';
import { createEvaluation, createStudent } from '../src/lib/store';
import { sectionQuestions } from '../src/lib/types';

// Smoke check of the comparison logic required for v1: seed two evaluations
// for one invented student, change fields between them, and assert the diff
// reports exactly those fields as changed. Invented data only.

function buildPair() {
  const student = createStudent('Example Student B', '2018-01-15', '');
  const older = createEvaluation(student.id);
  const newer = createEvaluation(student.id);

  const nameQ = findQuestionByTitlePrefix('Name (');
  if (nameQ) {
    older.answers[nameQ.id] = { type: 'text', value: 'Example Student B' };
    newer.answers[nameQ.id] = { type: 'text', value: 'Example Student B' };
  }

  const hearingQ = findQuestionByTitlePrefix('Hearing (');
  if (hearingQ) {
    older.answers[hearingQ.id] = { type: 'multi', values: ['Normal (hearing appears typical)'], otherText: '' };
    newer.answers[hearingQ.id] = { type: 'multi', values: ['Mild loss (small hearing reduction)'], otherText: '' };
  }

  const impairmentQ = schema.sections
    .flatMap((s) => sectionQuestions(s))
    .find((q) => q.kind === 'grid' && q.title.startsWith('Level of Impairment'));
  if (impairmentQ?.grid) {
    const firstRow = impairmentQ.grid.rows[0];
    older.answers[impairmentQ.id] = { type: 'grid', rows: { [firstRow.id]: 'Mild (minor concern)' } };
    newer.answers[impairmentQ.id] = { type: 'grid', rows: { [firstRow.id]: 'Moderate (clear concern)' } };
  }

  student.evaluations.push(older, newer);
  return { student, older, newer, hearingQ, impairmentQ };
}

describe('comparison smoke check', () => {
  it('returns the changed fields and leaves unchanged fields unchanged', () => {
    const { older, newer } = buildPair();
    const entries = compareEvaluations(schema, older, newer);
    const changed = entries.filter((e) => e.changed);

    const hearingChange = changed.find((e) => e.questionTitle.startsWith('Hearing ('));
    expect(hearingChange).toBeDefined();
    expect(hearingChange?.oldValue).toContain('Normal');
    expect(hearingChange?.newValue).toContain('Mild loss');

    const impairmentChange = changed.find((e) => e.questionTitle.includes('Sensory'));
    expect(impairmentChange).toBeDefined();
    expect(impairmentChange?.oldValue).toContain('Mild');
    expect(impairmentChange?.newValue).toContain('Moderate');

    const nameEntry = entries.find((e) => e.questionTitle.startsWith('Name ('));
    expect(nameEntry?.changed).toBe(false);
  });

  it('progress counts answered questions per section and overall', () => {
    const { older } = buildPair();
    const first = sectionProgress(schema, schema.sections[0].id, older.answers);
    expect(first.total).toBe(11);
    expect(first.answered).toBeGreaterThanOrEqual(1);
    const overall = overallProgress(schema, older.answers);
    expect(overall.total).toBe(147);
  });

  it('impairment extraction maps levels to severity order', () => {
    const { newer } = buildPair();
    const rows = getImpairment(schema, newer);
    expect(rows).toHaveLength(11);
    expect(rows[0].severity).toBe(2);
    expect(rows[0].level).toContain('Moderate');
  });

  it('CSV export includes section, question, and answer columns', () => {
    const { newer } = buildPair();
    const csv = evaluationToCsv(schema, newer);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Section,Question,Answer');
    expect(csv).toContain('Mild loss (small hearing reduction)');
    expect(lines.length).toBeGreaterThan(147);
  });
});
