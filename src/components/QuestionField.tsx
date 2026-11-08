'use client';

import type { Answer, SchemaQuestion } from '../lib/types';
import { emptyAnswerFor } from '../lib/answers';
import { OTHER_VALUE } from '../lib/schema';

interface Props {
  question: SchemaQuestion;
  answer: Answer | undefined;
  onChange: (answer: Answer) => void;
}

export default function QuestionField({ question, answer, onChange }: Props) {
  const current = answer ?? emptyAnswerFor(question);

  if (question.kind === 'text-short' || question.kind === 'text-paragraph') {
    const value = current.type === 'text' ? current.value : '';
    if (question.kind === 'text-paragraph') {
      return (
        <div className="field">
          <label className="field-label" htmlFor={question.id}>
            {question.title}
            {question.required ? ' (required)' : ''}
          </label>
          <textarea
            id={question.id}
            className="text-input"
            rows={4}
            value={value}
            onChange={(e) => onChange({ type: 'text', value: e.target.value })}
          />
        </div>
      );
    }
    return (
      <div className="field">
        <label className="field-label" htmlFor={question.id}>
          {question.title}
          {question.required ? ' (required)' : ''}
        </label>
        <input
          id={question.id}
          className="text-input"
          type="text"
          value={value}
          onChange={(e) => onChange({ type: 'text', value: e.target.value })}
        />
      </div>
    );
  }

  if (question.kind === 'radio') {
    const single = current.type === 'single' ? current : { type: 'single' as const, value: null, otherText: '' };
    return (
      <fieldset className="field">
        <legend className="field-label">{question.title}</legend>
        {question.options.map((option) => (
          <label key={option} className="choice">
            <input
              type="radio"
              name={question.id}
              checked={single.value === option}
              onChange={() => onChange({ type: 'single', value: option, otherText: single.otherText })}
            />
            <span>{option}</span>
          </label>
        ))}
        {question.hasOther && (
          <>
            <label className="choice">
              <input
                type="radio"
                name={question.id}
                checked={single.value === OTHER_VALUE}
                onChange={() => onChange({ type: 'single', value: OTHER_VALUE, otherText: single.otherText })}
              />
              <span>Other</span>
            </label>
            {single.value === OTHER_VALUE && (
              <input
                className="text-input other-input"
                type="text"
                aria-label={`Other text for ${question.title}`}
                placeholder="Describe other"
                value={single.otherText}
                onChange={(e) => onChange({ type: 'single', value: OTHER_VALUE, otherText: e.target.value })}
              />
            )}
          </>
        )}
      </fieldset>
    );
  }

  if (question.kind === 'checkbox') {
    const multi = current.type === 'multi' ? current : { type: 'multi' as const, values: [], otherText: '' };
    const toggle = (option: string, checked: boolean) => {
      const values = checked
        ? [...multi.values, option]
        : multi.values.filter((v) => v !== option);
      onChange({ type: 'multi', values, otherText: multi.otherText });
    };
    return (
      <fieldset className="field">
        <legend className="field-label">{question.title}</legend>
        {question.options.map((option) => (
          <label key={option} className="choice">
            <input
              type="checkbox"
              checked={multi.values.includes(option)}
              onChange={(e) => toggle(option, e.target.checked)}
            />
            <span>{option}</span>
          </label>
        ))}
        {question.hasOther && (
          <>
            <label className="choice">
              <input
                type="checkbox"
                checked={multi.values.includes(OTHER_VALUE)}
                onChange={(e) => toggle(OTHER_VALUE, e.target.checked)}
              />
              <span>Other</span>
            </label>
            {multi.values.includes(OTHER_VALUE) && (
              <input
                className="text-input other-input"
                type="text"
                aria-label={`Other text for ${question.title}`}
                placeholder="Describe other"
                value={multi.otherText}
                onChange={(e) => onChange({ type: 'multi', values: multi.values, otherText: e.target.value })}
              />
            )}
          </>
        )}
      </fieldset>
    );
  }

  // grid
  const gridAnswer = current.type === 'grid' ? current : { type: 'grid' as const, rows: {} };
  const grid = question.grid;
  if (!grid) return null;
  const isRadioGrid = grid.columnType === 'RADIO';

  const setRow = (rowId: string, column: string, checked: boolean) => {
    const rows = { ...gridAnswer.rows };
    if (isRadioGrid) {
      rows[rowId] = column;
    } else {
      const existing = Array.isArray(rows[rowId]) ? (rows[rowId] as string[]) : [];
      rows[rowId] = checked
        ? [...existing, column]
        : existing.filter((c) => c !== column);
    }
    onChange({ type: 'grid', rows });
  };

  return (
    <fieldset className="field">
      <legend className="field-label">{question.title}</legend>
      {grid.rows.map((row) => {
        const rowValue = gridAnswer.rows[row.id];
        return (
          <div key={row.id} className="grid-row">
            <div className="grid-row-title">{row.title}</div>
            <div className="grid-options">
              {grid.columns.map((column) => {
                const checked = Array.isArray(rowValue)
                  ? rowValue.includes(column)
                  : rowValue === column;
                return (
                  <label key={column} className="choice choice-inline">
                    <input
                      type={isRadioGrid ? 'radio' : 'checkbox'}
                      name={`${question.id}-${row.id}`}
                      checked={checked}
                      onChange={(e) => setRow(row.id, column, e.target.checked)}
                    />
                    <span>{column}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
