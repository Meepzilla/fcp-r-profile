import type { ImpairmentRow } from '../lib/answers';

const LEVEL_LABELS = ['Normal', 'Mild', 'Moderate', 'Severe', 'Profound'];

export default function ImpairmentChart({ rows }: { rows: ImpairmentRow[] }) {
  const anyRated = rows.some((r) => r.level);
  return (
    <section className="panel" aria-label="Level of Impairment summary">
      <h2>Level of Impairment</h2>
      {!anyRated && <p>No impairment levels recorded yet.</p>}
      <div className="impairment-chart">
        {rows.map((row) => (
          <div key={row.area} className="impairment-row">
            <div className="impairment-area">{row.area}</div>
            <div className="impairment-track" role="img" aria-label={`${row.area}: ${row.level || 'not recorded'}`}>
              {LEVEL_LABELS.map((label, idx) => (
                <span
                  key={label}
                  className={
                    row.severity !== null && idx <= row.severity
                      ? 'impairment-dot filled'
                      : 'impairment-dot'
                  }
                  title={label}
                />
              ))}
            </div>
            <div className="impairment-level">{row.level || 'Not recorded'}</div>
          </div>
        ))}
      </div>
      <p className="scale-note">Dots fill from Normal on the left to Profound on the right. N/A areas show no fill.</p>
    </section>
  );
}
