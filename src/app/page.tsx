'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { schema, findQuestionByTitlePrefix, OTHER_VALUE } from '../lib/schema';
import type { Answer, Evaluation, Store, Student } from '../lib/types';
import {
  compareEvaluations,
  evaluationToCsv,
  formatAnswer,
  getImpairment,
  overallProgress,
  sectionProgress,
} from '../lib/answers';
import {
  createEvaluation,
  createStudent,
  emptyStore,
  loadStore,
  parseBackup,
  saveStore,
  type SaveResult,
} from '../lib/store';
import QuestionField from '../components/QuestionField';
import ImpairmentChart from '../components/ImpairmentChart';
import CompareView from '../components/CompareView';
import PrintReport from '../components/PrintReport';

type View =
  | { name: 'roster' }
  | { name: 'student'; studentId: string }
  | { name: 'evaluation'; studentId: string; evaluationId: string; sectionIndex: number }
  | { name: 'compare'; studentId: string; olderId: string; newerId: string }
  | { name: 'print'; studentId: string; evaluationId: string };

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function evaluationTypeLabel(evaluation: Evaluation): string {
  const q = findQuestionByTitlePrefix('Evaluation Type');
  if (!q) return 'Evaluation';
  const value = formatAnswer(q, evaluation.answers[q.id]);
  return value || 'Evaluation';
}

function evaluationDateLabel(evaluation: Evaluation): string {
  return new Date(evaluation.createdAt).toLocaleDateString();
}

export default function Home() {
  const [store, setStore] = useState<Store>(emptyStore());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveNote, setSaveNote] = useState('');
  const [saveError, setSaveError] = useState('');
  const [sizeWarning, setSizeWarning] = useState(false);
  const [view, setView] = useState<View>({ name: 'roster' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const result = loadStore();
    setStore(result.store);
    if (result.error) setLoadError(result.error);
    setLoaded(true);
  }, []);

  function commit(next: Store) {
    setStore(next);
    const result: SaveResult = saveStore(next);
    if (result.ok) {
      setSaveError('');
      setSaveNote(`Saved on this device at ${new Date().toLocaleTimeString()}.`);
    } else {
      setSaveNote('');
      setSaveError(result.error ?? 'Save failed.');
    }
    setSizeWarning(result.overSizeWarning);
  }

  function updateStudent(studentId: string, updater: (s: Student) => Student) {
    commit({
      ...store,
      students: store.students.map((s) => (s.id === studentId ? updater(s) : s)),
    });
  }

  function updateEvaluation(studentId: string, evaluationId: string, updater: (e: Evaluation) => Evaluation) {
    updateStudent(studentId, (s) => ({
      ...s,
      updatedAt: new Date().toISOString(),
      evaluations: s.evaluations.map((e) =>
        e.id === evaluationId ? { ...updater(e), updatedAt: new Date().toISOString() } : e,
      ),
    }));
  }

  const currentStudent =
    view.name !== 'roster' ? store.students.find((s) => s.id === view.studentId) : undefined;

  function handleImportFile(file: File) {
    file.text().then((text) => {
      const result = parseBackup(text);
      if (!result.ok) {
        setSaveError(`Import refused. ${result.error}`);
        return;
      }
      const count = result.store.students.length;
      const confirmed = window.confirm(
        `Replace all current data with this backup? The backup holds ${count} student record${count === 1 ? '' : 's'}. Current data on this device will be overwritten.`,
      );
      if (!confirmed) return;
      setView({ name: 'roster' });
      commit(result.store);
    });
  }

  if (!loaded) {
    return (
      <main>
        <p>Loading saved data from this device.</p>
      </main>
    );
  }

  return (
    <main>
      <header className="app-header no-print">
        <h1>FCP-R Profile</h1>
        <p>Functional Communication Profile - Revised. Data stays on this device.</p>
      </header>

      {view.name !== 'print' && (
        <div className="no-print">
          {loadError && <div className="banner banner-error">{loadError}</div>}
          {saveError && <div className="banner banner-error">{saveError}</div>}
          {sizeWarning && (
            <div className="banner banner-warn">
              Saved data is large. Export a JSON backup from the roster screen and keep it somewhere
              safe. Browsers can clear local storage when space runs low.
            </div>
          )}
          {saveNote && !saveError && <p className="save-status">{saveNote}</p>}
        </div>
      )}

      {view.name === 'roster' && (
        <RosterView
          store={store}
          onOpen={(studentId) => setView({ name: 'student', studentId })}
          onAddStudent={(name, birthdate, notes) => {
            const student = createStudent(name, birthdate, notes);
            commit({ ...store, students: [...store.students, student] });
          }}
          onExport={() =>
            download(
              `fcpr-backup-${new Date().toISOString().slice(0, 10)}.json`,
              JSON.stringify(store, null, 2),
              'application/json',
            )
          }
          onImportClick={() => fileInputRef.current?.click()}
        />
      )}

      {view.name === 'student' && currentStudent && (
        <StudentView
          student={currentStudent}
          onBack={() => setView({ name: 'roster' })}
          onSaveDetails={(name, birthdate, notes) =>
            updateStudent(currentStudent.id, (s) => ({ ...s, name, birthdate, notes }))
          }
          onDelete={() => {
            if (window.confirm(`Delete ${currentStudent.name} and all of their evaluations? This cannot be undone.`)) {
              commit({ ...store, students: store.students.filter((s) => s.id !== currentStudent.id) });
              setView({ name: 'roster' });
            }
          }}
          onNewEvaluation={(typeOption, dateValue) => {
            const answers: Record<string, Answer> = {};
            const typeQ = findQuestionByTitlePrefix('Evaluation Type');
            if (typeQ && typeOption) {
              answers[typeQ.id] = { type: 'single', value: typeOption, otherText: '' };
            }
            const nameQ = findQuestionByTitlePrefix('Name (');
            if (nameQ) answers[nameQ.id] = { type: 'text', value: currentStudent.name };
            const birthQ = findQuestionByTitlePrefix('Birthdate (');
            if (birthQ && currentStudent.birthdate) {
              answers[birthQ.id] = { type: 'text', value: currentStudent.birthdate };
            }
            const dateQ = findQuestionByTitlePrefix('Date (');
            if (dateQ && dateValue) answers[dateQ.id] = { type: 'text', value: dateValue };
            const evaluation = createEvaluation(currentStudent.id, answers);
            updateStudent(currentStudent.id, (s) => ({
              ...s,
              evaluations: [...s.evaluations, evaluation],
            }));
            setView({
              name: 'evaluation',
              studentId: currentStudent.id,
              evaluationId: evaluation.id,
              sectionIndex: 0,
            });
          }}
          onOpenEvaluation={(evaluationId) =>
            setView({ name: 'evaluation', studentId: currentStudent.id, evaluationId, sectionIndex: 0 })
          }
          onPrint={(evaluationId) => setView({ name: 'print', studentId: currentStudent.id, evaluationId })}
          onCompare={(olderId, newerId) =>
            setView({ name: 'compare', studentId: currentStudent.id, olderId, newerId })
          }
        />
      )}

      {view.name === 'evaluation' && currentStudent && (
        <EvaluationView
          key={view.evaluationId}
          student={currentStudent}
          evaluationId={view.evaluationId}
          sectionIndex={view.sectionIndex}
          onSectionChange={(sectionIndex) =>
            setView({ ...view, sectionIndex })
          }
          onBack={() => setView({ name: 'student', studentId: currentStudent.id })}
          onAnswer={(evaluationId, questionId, answer) =>
            updateEvaluation(currentStudent.id, evaluationId, (e) => ({
              ...e,
              answers: { ...e.answers, [questionId]: answer },
            }))
          }
          onToggleStatus={(evaluationId, status) =>
            updateEvaluation(currentStudent.id, evaluationId, (e) => ({ ...e, status }))
          }
          onDelete={(evaluationId) => {
            if (window.confirm('Delete this evaluation? This cannot be undone.')) {
              updateStudent(currentStudent.id, (s) => ({
                ...s,
                evaluations: s.evaluations.filter((e) => e.id !== evaluationId),
              }));
              setView({ name: 'student', studentId: currentStudent.id });
            }
          }}
          onCsv={(evaluation) =>
            download(
              `fcpr-${currentStudent.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${evaluation.createdAt.slice(0, 10)}.csv`,
              evaluationToCsv(schema, evaluation),
              'text/csv',
            )
          }
          onPrint={(evaluationId) => setView({ name: 'print', studentId: currentStudent.id, evaluationId })}
        />
      )}

      {view.name === 'compare' && currentStudent && (
        <CompareScreen
          student={currentStudent}
          olderId={view.olderId}
          newerId={view.newerId}
          onBack={() => setView({ name: 'student', studentId: currentStudent.id })}
        />
      )}

      {view.name === 'print' && currentStudent && (
        <PrintScreen
          student={currentStudent}
          evaluationId={view.evaluationId}
          onBack={() => setView({ name: 'student', studentId: currentStudent.id })}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
          e.target.value = '';
        }}
      />
    </main>
  );
}

function RosterView(props: {
  store: Store;
  onOpen: (studentId: string) => void;
  onAddStudent: (name: string, birthdate: string, notes: string) => void;
  onExport: () => void;
  onImportClick: () => void;
}) {
  const [name, setName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <div className="no-print">
      <section className="panel">
        <h2>About your data</h2>
        <p>
          Everything you enter is stored only on this device, in this browser. There is no account,
          no server, and nothing is sent anywhere. If the browser data is cleared, the records are
          gone. Export a JSON backup regularly and keep the file somewhere safe.
        </p>
        <div className="button-row">
          <button type="button" className="secondary" onClick={props.onExport}>
            Export JSON backup
          </button>
          <button type="button" className="secondary" onClick={props.onImportClick}>
            Import JSON backup
          </button>
        </div>
      </section>

      <h2>Students</h2>
      {props.store.students.length === 0 && <p>No students yet. Add the first student below.</p>}
      <ul className="card-list">
        {props.store.students.map((student) => (
          <li key={student.id} className="card">
            <div>
              <div className="card-title">{student.name}</div>
              <div className="card-meta">
                {student.birthdate ? `Birthdate ${student.birthdate}. ` : ''}
                {student.evaluations.length} evaluation{student.evaluations.length === 1 ? '' : 's'}
              </div>
            </div>
            <button type="button" onClick={() => props.onOpen(student.id)}>
              Open
            </button>
          </li>
        ))}
      </ul>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Add a student</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            props.onAddStudent(name, birthdate, notes);
            setName('');
            setBirthdate('');
            setNotes('');
          }}
        >
          <div className="form-grid">
            <label>
              Name
              <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Birthdate
              <input className="text-input" type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
            </label>
            <label>
              Notes
              <textarea className="text-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <button type="submit">Add student</button>
        </form>
      </section>
    </div>
  );
}

function StudentView(props: {
  student: Student;
  onBack: () => void;
  onSaveDetails: (name: string, birthdate: string, notes: string) => void;
  onDelete: () => void;
  onNewEvaluation: (typeOption: string, dateValue: string) => void;
  onOpenEvaluation: (evaluationId: string) => void;
  onPrint: (evaluationId: string) => void;
  onCompare: (olderId: string, newerId: string) => void;
}) {
  const { student } = props;
  const [name, setName] = useState(student.name);
  const [birthdate, setBirthdate] = useState(student.birthdate);
  const [notes, setNotes] = useState(student.notes);
  const typeQ = findQuestionByTitlePrefix('Evaluation Type');
  const typeOptions = useMemo(() => (typeQ ? typeQ.options : []), [typeQ]);
  const [evalType, setEvalType] = useState(typeOptions[0] ?? '');
  const [evalDate, setEvalDate] = useState(new Date().toISOString().slice(0, 10));
  const [olderId, setOlderId] = useState('');
  const [newerId, setNewerId] = useState('');

  return (
    <div className="no-print">
      <div className="button-row">
        <button type="button" className="secondary" onClick={props.onBack}>
          Back to roster
        </button>
      </div>
      <h2>{student.name}</h2>

      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Student details</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            props.onSaveDetails(name, birthdate, notes);
          }}
        >
          <div className="form-grid">
            <label>
              Name
              <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Birthdate
              <input className="text-input" type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
            </label>
            <label>
              Notes
              <textarea className="text-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <div className="button-row">
            <button type="submit" className="secondary">Save details</button>
            <button type="button" className="danger" onClick={props.onDelete}>
              Delete student
            </button>
          </div>
        </form>
      </section>

      <h3>Evaluations</h3>
      {student.evaluations.length === 0 && <p>No evaluations yet.</p>}
      <ul className="card-list">
        {student.evaluations.map((evaluation) => {
          const progress = overallProgress(schema, evaluation.answers);
          return (
            <li key={evaluation.id} className="card">
              <div>
                <div className="card-title">{evaluationTypeLabel(evaluation)}</div>
                <div className="card-meta">
                  Started {evaluationDateLabel(evaluation)}. Status:{' '}
                  {evaluation.status === 'complete' ? 'Complete' : 'In progress'}. Answered{' '}
                  {progress.answered} of {progress.total} questions.
                </div>
              </div>
              <div className="button-row">
                <button type="button" onClick={() => props.onOpenEvaluation(evaluation.id)}>
                  Open
                </button>
                <button type="button" className="secondary" onClick={() => props.onPrint(evaluation.id)}>
                  Print report
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <section className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>New evaluation</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            props.onNewEvaluation(evalType, evalDate);
          }}
        >
          <div className="form-grid">
            <label>
              Evaluation Type
              <select className="text-input" value={evalType} onChange={(e) => setEvalType(e.target.value)}>
                {typeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                {typeQ?.hasOther && <option value={OTHER_VALUE}>Other</option>}
              </select>
            </label>
            <label>
              Date
              <input className="text-input" type="date" value={evalDate} onChange={(e) => setEvalDate(e.target.value)} />
            </label>
          </div>
          <button type="submit">Start evaluation</button>
        </form>
      </section>

      {student.evaluations.length >= 2 && (
        <section className="panel">
          <h3 style={{ marginTop: 0 }}>Compare two evaluations</h3>
          <div className="form-grid">
            <label>
              Earlier evaluation
              <select className="text-input" value={olderId} onChange={(e) => setOlderId(e.target.value)}>
                <option value="">Select one</option>
                {student.evaluations.map((e) => (
                  <option key={e.id} value={e.id}>
                    {evaluationTypeLabel(e)} - {evaluationDateLabel(e)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Later evaluation
              <select className="text-input" value={newerId} onChange={(e) => setNewerId(e.target.value)}>
                <option value="">Select one</option>
                {student.evaluations.map((e) => (
                  <option key={e.id} value={e.id}>
                    {evaluationTypeLabel(e)} - {evaluationDateLabel(e)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={!olderId || !newerId || olderId === newerId}
            onClick={() => props.onCompare(olderId, newerId)}
          >
            Compare
          </button>
        </section>
      )}
    </div>
  );
}

function EvaluationView(props: {
  student: Student;
  evaluationId: string;
  sectionIndex: number;
  onSectionChange: (index: number) => void;
  onBack: () => void;
  onAnswer: (evaluationId: string, questionId: string, answer: Answer) => void;
  onToggleStatus: (evaluationId: string, status: Evaluation['status']) => void;
  onDelete: (evaluationId: string) => void;
  onCsv: (evaluation: Evaluation) => void;
  onPrint: (evaluationId: string) => void;
}) {
  const evaluation = props.student.evaluations.find((e) => e.id === props.evaluationId);
  if (!evaluation) {
    return (
      <div className="no-print">
        <p>This evaluation no longer exists.</p>
        <button type="button" className="secondary" onClick={props.onBack}>
          Back to student
        </button>
      </div>
    );
  }
  const section = schema.sections[props.sectionIndex];
  const overall = overallProgress(schema, evaluation.answers);
  const impairment = getImpairment(schema, evaluation);
  const pct = overall.total ? Math.round((overall.answered / overall.total) * 100) : 0;

  return (
    <div className="no-print">
      <div className="button-row">
        <button type="button" className="secondary" onClick={props.onBack}>
          Back to student
        </button>
        <button type="button" className="secondary" onClick={() => props.onPrint(evaluation.id)}>
          Print report
        </button>
        <button type="button" className="secondary" onClick={() => props.onCsv(evaluation)}>
          Export CSV
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            props.onToggleStatus(evaluation.id, evaluation.status === 'complete' ? 'in-progress' : 'complete')
          }
        >
          {evaluation.status === 'complete' ? 'Reopen as in progress' : 'Mark complete'}
        </button>
        <button type="button" className="danger" onClick={() => props.onDelete(evaluation.id)}>
          Delete evaluation
        </button>
      </div>

      <h2>
        {evaluationTypeLabel(evaluation)} - {props.student.name}
      </h2>
      <p>
        Status: {evaluation.status === 'complete' ? 'Complete' : 'In progress'}. Answered{' '}
        {overall.answered} of {overall.total} questions. Answers save on this device as you type.
      </p>
      <div className="progress-bar" aria-hidden="true">
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <ImpairmentChart rows={impairment} />

      <nav aria-label="Evaluation sections">
        <ul className="section-nav">
          {schema.sections.map((s, idx) => {
            const p = sectionProgress(schema, s.id, evaluation.answers);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={idx === props.sectionIndex ? 'active' : ''}
                  onClick={() => props.onSectionChange(idx)}
                >
                  <span>{s.title}</span>
                  <span className="progress-chip">
                    {p.answered} / {p.total}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <h3>{section.title}</h3>
      {section.items.map((item) => {
        if (item.type === 'heading') return <h3 key={item.title}>{item.title}</h3>;
        return (
          <QuestionField
            key={item.id}
            question={item}
            answer={evaluation.answers[item.id]}
            onChange={(answer) => props.onAnswer(evaluation.id, item.id, answer)}
          />
        );
      })}

      <div className="button-row">
        <button
          type="button"
          className="secondary"
          disabled={props.sectionIndex === 0}
          onClick={() => props.onSectionChange(props.sectionIndex - 1)}
        >
          Previous section
        </button>
        <button
          type="button"
          className="secondary"
          disabled={props.sectionIndex >= schema.sections.length - 1}
          onClick={() => props.onSectionChange(props.sectionIndex + 1)}
        >
          Next section
        </button>
      </div>
    </div>
  );
}

function CompareScreen(props: {
  student: Student;
  olderId: string;
  newerId: string;
  onBack: () => void;
}) {
  const older = props.student.evaluations.find((e) => e.id === props.olderId);
  const newer = props.student.evaluations.find((e) => e.id === props.newerId);
  if (!older || !newer) {
    return (
      <div className="no-print">
        <p>One of the selected evaluations no longer exists.</p>
        <button type="button" className="secondary" onClick={props.onBack}>
          Back to student
        </button>
      </div>
    );
  }
  const entries = compareEvaluations(schema, older, newer);
  return (
    <div className="no-print">
      <div className="button-row">
        <button type="button" className="secondary" onClick={props.onBack}>
          Back to student
        </button>
      </div>
      <h2>Comparison for {props.student.name}</h2>
      <CompareView
        entries={entries}
        olderLabel={`${evaluationTypeLabel(older)} (${evaluationDateLabel(older)})`}
        newerLabel={`${evaluationTypeLabel(newer)} (${evaluationDateLabel(newer)})`}
      />
    </div>
  );
}

function PrintScreen(props: { student: Student; evaluationId: string; onBack: () => void }) {
  const evaluation = props.student.evaluations.find((e) => e.id === props.evaluationId);
  if (!evaluation) {
    return (
      <div>
        <p>This evaluation no longer exists.</p>
        <button type="button" className="secondary no-print" onClick={props.onBack}>
          Back to student
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="button-row no-print">
        <button type="button" className="secondary" onClick={props.onBack}>
          Back to student
        </button>
        <button type="button" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>
      <PrintReport schema={schema} student={props.student} evaluation={evaluation} />
    </div>
  );
}
