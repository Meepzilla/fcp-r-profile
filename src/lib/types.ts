// Shared types for the FCP-R app.
// The schema types mirror scripts/generate-schema.mjs output exactly.

export type QuestionKind = 'checkbox' | 'radio' | 'text-short' | 'text-paragraph' | 'grid';

export interface SchemaQuestion {
  type: 'question';
  id: string;
  questionId: string;
  title: string;
  description: string;
  required: boolean;
  kind: QuestionKind;
  options: string[];
  hasOther: boolean;
  grid?: {
    columnType: 'RADIO' | 'CHECKBOX';
    columns: string[];
    rows: { id: string; title: string }[];
  };
}

export interface SchemaHeading {
  type: 'heading';
  title: string;
}

export type SchemaItem = SchemaQuestion | SchemaHeading;

export interface SchemaSection {
  id: string;
  title: string;
  items: SchemaItem[];
}

export interface FcprSchema {
  formTitle: string;
  formDescription: string;
  sourceFormId: string;
  generatedFrom: string;
  sections: SchemaSection[];
  counts: { sections: number; questions: number; items: number };
}

export function sectionQuestions(section: SchemaSection): SchemaQuestion[] {
  return section.items.filter((i): i is SchemaQuestion => i.type === 'question');
}

export function allQuestions(schema: FcprSchema): SchemaQuestion[] {
  return schema.sections.flatMap((s) => sectionQuestions(s));
}

// Answers

export type Answer =
  | { type: 'text'; value: string }
  | { type: 'single'; value: string | null; otherText: string }
  | { type: 'multi'; values: string[]; otherText: string }
  | { type: 'grid'; rows: Record<string, string | string[]> };

export type AnswerMap = Record<string, Answer>;

export type EvaluationStatus = 'in-progress' | 'complete';

export interface Evaluation {
  id: string;
  studentId: string;
  status: EvaluationStatus;
  createdAt: string;
  updatedAt: string;
  answers: AnswerMap;
}

export interface Student {
  id: string;
  name: string;
  birthdate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  evaluations: Evaluation[];
}

export interface Store {
  version: 1;
  students: Student[];
}
