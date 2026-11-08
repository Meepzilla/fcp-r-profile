'use client';

import { useState } from 'react';
import type { DiffEntry } from '../lib/answers';

interface Props {
  entries: DiffEntry[];
  olderLabel: string;
  newerLabel: string;
}

export default function CompareView({ entries, olderLabel, newerLabel }: Props) {
  const [showAll, setShowAll] = useState(false);
  const changed = entries.filter((e) => e.changed);
  const visible = showAll ? entries : changed;

  let lastSection = '';

  return (
    <div>
      <p>
        {changed.length} of {entries.length} fields changed between the two evaluations.
      </p>
      <label className="choice">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        <span>Show all fields, including unchanged</span>
      </label>
      {visible.length === 0 && <p>No changed fields to show.</p>}
      {visible.map((entry, idx) => {
        const showHeading = entry.sectionTitle !== lastSection;
        lastSection = entry.sectionTitle;
        return (
          <div key={`${entry.questionTitle}-${idx}`}>
            {showHeading && <h3 className="compare-section">{entry.sectionTitle}</h3>}
            <div className={entry.changed ? 'diff-row changed' : 'diff-row'}>
              <div className="diff-question">{entry.questionTitle}</div>
              <div className="diff-values">
                <div>
                  <span className="diff-label">{olderLabel}</span>
                  <span className="diff-value">{entry.oldValue || 'Not recorded'}</span>
                </div>
                <div>
                  <span className="diff-label">{newerLabel}</span>
                  <span className="diff-value">{entry.newValue || 'Not recorded'}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
