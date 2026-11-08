// Generates src/data/fcpr-schema.json from the extracted Google Form.
// Source: ../../form-digital.json (Functional Communication Profile - Revised (Digital))
// Run from the repo root: npm run generate-schema
// The app renders the evaluation form from the generated schema, so a form
// change is a regeneration, not a rewrite. Form wording is copied verbatim.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = process.env.FCPR_FORM_JSON
  ? resolve(process.env.FCPR_FORM_JSON)
  : resolve(repoRoot, '..', 'form-digital.json');
const outPath = resolve(repoRoot, 'src', 'data', 'fcpr-schema.json');

const form = JSON.parse(readFileSync(sourcePath, 'utf8'));

function optionValues(choiceQuestion) {
  return (choiceQuestion.options || [])
    .filter((o) => typeof o.value === 'string')
    .map((o) => o.value);
}

function hasOther(choiceQuestion) {
  return (choiceQuestion.options || []).some((o) => o.isOther === true);
}

function mapChoiceKind(googleType) {
  if (googleType === 'CHECKBOX') return 'checkbox';
  // RADIO and DROP_DOWN are both single-select in this form.
  return 'radio';
}

const sections = [];
let current = null;

function startSection(title) {
  current = {
    id: `section-${sections.length + 1}`,
    title,
    items: [],
  };
  sections.push(current);
}

for (const item of form.items || []) {
  if (item.pageBreakItem) {
    startSection(item.title || 'Untitled section');
    continue;
  }
  if (item.textItem) {
    if (!current) {
      startSection(item.title || 'Untitled section');
    } else {
      // A text item inside an open section is a subheading, kept in order.
      current.items.push({ type: 'heading', title: item.title || '' });
    }
    continue;
  }
  if (!current) startSection('Untitled section');

  if (item.questionItem) {
    const q = item.questionItem.question || {};
    const base = {
      type: 'question',
      id: item.itemId,
      questionId: q.questionId || item.itemId,
      title: item.title || '',
      description: item.description || '',
      required: q.required === true,
    };
    if (q.choiceQuestion) {
      current.items.push({
        ...base,
        kind: mapChoiceKind(q.choiceQuestion.type),
        options: optionValues(q.choiceQuestion),
        hasOther: hasOther(q.choiceQuestion),
      });
    } else if (q.textQuestion) {
      current.items.push({
        ...base,
        kind: q.textQuestion.paragraph ? 'text-paragraph' : 'text-short',
        options: [],
        hasOther: false,
      });
    } else {
      throw new Error(`Unsupported question shape on item ${item.itemId} (${item.title})`);
    }
    continue;
  }

  if (item.questionGroupItem) {
    const grid = item.questionGroupItem.grid || {};
    const columns = grid.columns || {};
    current.items.push({
      type: 'question',
      id: item.itemId,
      questionId: item.itemId,
      title: item.title || '',
      description: item.description || '',
      required: false,
      kind: 'grid',
      options: [],
      hasOther: false,
      grid: {
        columnType: columns.type || 'RADIO',
        columns: (columns.options || []).map((o) => o.value),
        rows: (item.questionGroupItem.questions || []).map((row) => ({
          id: row.questionId,
          title: (row.rowQuestion && row.rowQuestion.title) || '',
        })),
      },
    });
    continue;
  }

  throw new Error(`Unsupported item shape on item ${item.itemId} (${item.title})`);
}

let questionCount = 0;
for (const section of sections) {
  for (const entry of section.items) {
    if (entry.type === 'question') questionCount += 1;
  }
}

const schema = {
  formTitle: (form.info && form.info.documentTitle) || 'Functional Communication Profile - Revised',
  formDescription: (form.info && form.info.description) || '',
  sourceFormId: form.formId || '',
  generatedFrom: 'form-digital.json',
  sections,
  counts: {
    sections: sections.length,
    questions: questionCount,
    items: (form.items || []).length,
  },
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(schema, null, 2) + '\n', 'utf8');
console.log(`Wrote ${outPath}`);
console.log(`Sections: ${sections.length}, questions/groups: ${questionCount}, source items: ${schema.counts.items}`);
