// Answer logic: completion counting, display formatting, comparison diff,
// CSV export, and the Level of Impairment extraction.
// Pure functions over the schema and answer maps, so they are unit tested
// without a browser.

import type {
  Answer,
  AnswerMap,
  Evaluation,
  FcprSchema,
  SchemaQuestion,
} from './types';
import { sectionQuestions } from './types';
import { OTHER_VALUE } from './schema';

export function emptyAnswerFor(question: SchemaQuestion): Answer {
  switch (question.kind) {
    case 'text-short':
    case 'text-paragraph':
      return { type: 'text', value: '' };
    case 'radio':
      return { type: 'single', value: null, otherText: '' };
    case 'checkbox':
      return { type: 'multi', values: [], otherText: '' };
    case 'grid':
      return { type: 'grid', rows: {} };
  }
}

export function isAnswered(question: SchemaQuestion, answer: Answer | undefined): boolean {
  if (!answer) return false;
  switch (answer.type) {
    case 'text':
      return answer.value.trim().length > 0;
    case 'single':
      return answer.value !== null;
    case 'multi':
      return answer.values.length > 0;
    case 'grid': {
      const rows = question.grid?.rows ?? [];
      if (rows.length === 0) return false;
      return rows.every((row) => {
        const v = answer.rows[row.id];
        return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.length > 0;
      });
    }
  }
}

export function sectionProgress(
  schema: FcprSchema,
  sectionId: string,
  answers: AnswerMap,
): { answered: number; total: number } {
  const section = schema.sections.find((s) => s.id === sectionId);
  if (!section) return { answered: 0, total: 0 };
  const questions = sectionQuestions(section);
  const answered = questions.filter((q) => isAnswered(q, answers[q.id])).length;
  return { answered, total: questions.length };
}

export function overallProgress(
  schema: FcprSchema,
  answers: AnswerMap,
): { answered: number; total: number } {
  let answered = 0;
  let total = 0;
  for (const section of schema.sections) {
    const p = sectionProgress(schema, section.id, answers);
    answered += p.answered;
    total += p.total;
  }
  return { answered, total };
}

export function formatAnswer(question: SchemaQuestion, answer: Answer | undefined): string {
  if (!answer || !isAnswered(question, answer)) return '';
  switch (answer.type) {
    case 'text':
      return answer.value.trim();
    case 'single': {
      if (answer.value === null) return '';
      if (answer.value === OTHER_VALUE) {
        return answer.otherText.trim() ? `Other: ${answer.otherText.trim()}` : 'Other';
      }
      return answer.value;
    }
    case 'multi': {
      const parts = answer.values.map((v) =>
        v === OTHER_VALUE
          ? answer.otherText.trim()
            ? `Other: ${answer.otherText.trim()}`
            : 'Other'
          : v,
      );
      return parts.join('; ');
    }
    case 'grid': {
      const rows = question.grid?.rows ?? [];
      return rows
        .map((row) => {
          const v = answer.rows[row.id];
          const text = Array.isArray(v) ? v.join('; ') : v ?? '';
          return text ? `${row.title}: ${text}` : '';
        })
        .filter(Boolean)
        .join('\n');
    }
  }
}

// Comparison diff

export interface DiffEntry {
  sectionTitle: string;
  questionTitle: string;
  oldValue: string;
  newValue: string;
  changed: boolean;
}

export function compareEvaluations(
  schema: FcprSchema,
  older: Evaluation,
  newer: Evaluation,
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  for (const section of schema.sections) {
    for (const question of sectionQuestions(section)) {
      if (question.kind === 'grid' && question.grid) {
        for (const row of question.grid.rows) {
          const oldRow = formatGridRow(question, older.answers[question.id], row.id);
          const newRow = formatGridRow(question, newer.answers[question.id], row.id);
          entries.push({
            sectionTitle: section.title,
            questionTitle: `${question.title} - ${row.title}`,
            oldValue: oldRow,
            newValue: newRow,
            changed: oldRow !== newRow,
          });
        }
      } else {
        const oldValue = formatAnswer(question, older.answers[question.id]);
        const newValue = formatAnswer(question, newer.answers[question.id]);
        entries.push({
          sectionTitle: section.title,
          questionTitle: question.title,
          oldValue,
          newValue,
          changed: oldValue !== newValue,
        });
      }
    }
  }
  return entries;
}

function formatGridRow(
  question: SchemaQuestion,
  answer: Answer | undefined,
  rowId: string,
): string {
  if (!answer || answer.type !== 'grid') return '';
  const v = answer.rows[rowId];
  if (Array.isArray(v)) return v.join('; ');
  return v ?? '';
}

// Level of Impairment

export interface ImpairmentRow {
  area: string;
  level: string;
  /** 0 Normal to 4 Profound. Null for N/A or unanswered. */
  severity: number | null;
}

const SEVERITY_ORDER = ['Normal', 'Mild', 'Moderate', 'Severe', 'Profound'];

export function getImpairment(
  schema: FcprSchema,
  evaluation: Evaluation,
): ImpairmentRow[] {
  for (const section of schema.sections) {
    for (const question of sectionQuestions(section)) {
      if (question.kind === 'grid' && question.title.startsWith('Level of Impairment')) {
        const answer = evaluation.answers[question.id];
        return (question.grid?.rows ?? []).map((row) => {
          const raw =
            answer && answer.type === 'grid' ? answer.rows[row.id] : undefined;
          const level = typeof raw === 'string' ? raw : '';
          const base = SEVERITY_ORDER.findIndex((s) => level.startsWith(s));
          return {
            area: row.title,
            level,
            severity: base >= 0 ? base : null,
          };
        });
      }
    }
  }
  return [];
}

// CSV export for one evaluation

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function evaluationToCsv(
  schema: FcprSchema,
  evaluation: Evaluation,
): string {
  const lines: string[] = ['Section,Question,Answer'];
  for (const section of schema.sections) {
    for (const question of sectionQuestions(section)) {
      if (question.kind === 'grid' && question.grid) {
        for (const row of question.grid.rows) {
          const value = formatGridRow(question, evaluation.answers[question.id], row.id);
          lines.push(
            [section.title, `${question.title} - ${row.title}`, value].map(csvEscape).join(','),
          );
        }
      } else {
        const value = formatAnswer(question, evaluation.answers[question.id]);
        lines.push([section.title, question.title, value].map(csvEscape).join(','));
      }
    }
  }
  return lines.join('\n') + '\n';
}
