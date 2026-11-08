import type { Evaluation, FcprSchema, Student } from '../lib/types';
import { sectionQuestions } from '../lib/types';
import { formatAnswer, getImpairment } from '../lib/answers';

interface Props {
  schema: FcprSchema;
  student: Student;
  evaluation: Evaluation;
}

export default function PrintReport({ schema, student, evaluation }: Props) {
  const impairment = getImpairment(schema, evaluation);
  return (
    <div className="print-report">
      <h1>{schema.formTitle}</h1>
      <p>
        Student: {student.name}
        {student.birthdate ? ` | Birthdate: ${student.birthdate}` : ''}
        {' | '}Status: {evaluation.status === 'complete' ? 'Complete' : 'In progress'}
        {' | '}Last updated: {new Date(evaluation.updatedAt).toLocaleDateString()}
      </p>

      {impairment.some((r) => r.level) && (
        <section>
          <h2>Level of Impairment summary</h2>
          <table className="print-table">
            <tbody>
              {impairment.map((row) => (
                <tr key={row.area}>
                  <th>{row.area}</th>
                  <td>{row.level || 'Not recorded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {schema.sections.map((section) => (
        <section key={section.id} className="print-section">
          <h2>{section.title}</h2>
          {section.items.map((item) => {
            if (item.type === 'heading') return <h3 key={item.title}>{item.title}</h3>;
            const value = formatAnswer(item, evaluation.answers[item.id]);
            if (item.kind === 'grid') {
              return (
                <div key={item.id} className="print-field">
                  <h4>{item.title}</h4>
                  <p className="print-multiline">{value || 'Not recorded'}</p>
                </div>
              );
            }
            return (
              <div key={item.id} className="print-field">
                <h4>{item.title}</h4>
                <p>{value || 'Not recorded'}</p>
              </div>
            );
          })}
          {sectionQuestions(section).length === 0 && <p>Not recorded</p>}
        </section>
      ))}
    </div>
  );
}
