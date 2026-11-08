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
import { createEvaluation, createStudent, emptyStore } from '../lib/store';
import {
  changePasscode as changePasscodePersisted,
  disableProtection,
  enableProtection,
  initPersistence,
  lockoutRemainingMs,
  saveData,
  savePlainAndSetMode,
  unlock,
  unlockWithRecovery,
  type ProtectionMode,
  type Session,
} from '../lib/persistence';
import { createEncryptedBackupText, inspectBackup, openEncryptedBackup } from '../lib/backup';
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

type Phase = 'loading' | 'setup' | 'locked' | 'ready';

export default function Home() {
  const [store, setStore] = useState<Store>(emptyStore());
  const [phase, setPhase] = useState<Phase>('loading');
  const [protectionMode, setProtectionMode] = useState<ProtectionMode>('plain');
  const [loadError, setLoadError] = useState('');
  const [saveNote, setSaveNote] = useState('');
  const [saveError, setSaveError] = useState('');
  const [sizeWarning, setSizeWarning] = useState(false);
  const [view, setView] = useState<View>({ name: 'roster' });
  const [recoveryKeyToShow, setRecoveryKeyToShow] = useState('');
  const [initialLockoutMs, setInitialLockoutMs] = useState(0);
  const [pendingEncryptedBackup, setPendingEncryptedBackup] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    initPersistence()
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'ready') {
          sessionRef.current = result.session;
          setProtectionMode(result.session.mode);
          setStore(result.store);
          if (result.migrated) {
            setSaveNote('Your existing records were moved to the new storage on this device.');
          }
          setPhase('ready');
        } else if (result.status === 'locked') {
          setProtectionMode('encrypted');
          setInitialLockoutMs(result.lockoutRemainingMs);
          setPhase('locked');
        } else if (result.status === 'fresh') {
          setPhase('setup');
        } else {
          setLoadError(result.error);
          setPhase('setup');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('Saved data could not be read from this browser database.');
          setPhase('setup');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function applySession(session: Session) {
    sessionRef.current = session;
    setProtectionMode(session.mode);
  }

  function commit(next: Store) {
    setStore(next);
    const session = sessionRef.current;
    if (!session) {
      setSaveError('Data is not unlocked yet, so this change was not saved.');
      return;
    }
    saveData(next, session)
      .then((outcome) => {
        sessionRef.current = outcome.session;
        if (outcome.result.ok) {
          setSaveError('');
          setSaveNote(`Saved on this device at ${new Date().toLocaleTimeString()}.`);
        } else {
          setSaveNote('');
          setSaveError(outcome.result.error ?? 'Save failed.');
        }
        setSizeWarning(outcome.result.overSizeWarning);
      })
      .catch(() => {
        setSaveNote('');
        setSaveError('Save failed. The storage write did not complete.');
      });
  }

  async function handleSetupPasscode(passcode: string) {
    try {
      const { recoveryKey, session } = await enableProtection(emptyStore(), passcode);
      applySession(session);
      setStore(emptyStore());
      setRecoveryKeyToShow(recoveryKey);
      setPhase('ready');
    } catch {
      setLoadError('Passcode setup failed. No protection was turned on.');
    }
  }

  async function handleOptOut() {
    try {
      const session = await savePlainAndSetMode(emptyStore());
      applySession(session);
      setStore(emptyStore());
      setPhase('ready');
    } catch {
      setLoadError('Setup failed. Storage could not be written.');
    }
  }

  async function handleUnlock(passcode: string): Promise<string> {
    const outcome = await unlock(passcode);
    if (!outcome.ok) return outcome.error;
    applySession(outcome.session);
    setStore(outcome.store);
    setSaveError('');
    setPhase('ready');
    return '';
  }

  async function handleRecoveryUnlock(recoveryKey: string, newPasscode: string): Promise<string> {
    const outcome = await unlockWithRecovery(recoveryKey, newPasscode);
    if (!outcome.ok) return outcome.error;
    applySession(outcome.session);
    setStore(outcome.store);
    setSaveError('');
    setPhase('ready');
    return '';
  }

  async function handleEnableProtection(passcode: string) {
    try {
      const { recoveryKey, session } = await enableProtection(store, passcode);
      applySession(session);
      setRecoveryKeyToShow(recoveryKey);
      setSaveError('');
      setSaveNote('Passcode protection is on. Records are now encrypted on this device.');
    } catch {
      setSaveError('Turning on passcode protection failed. Nothing was changed.');
    }
  }

  async function handleChangePasscode(newPasscode: string): Promise<string> {
    const session = sessionRef.current;
    if (!session || session.mode !== 'encrypted') return 'Passcode protection is not on.';
    try {
      const next = await changePasscodePersisted(session, newPasscode);
      applySession(next);
      setSaveNote('Passcode changed. Your recovery key still works.');
      return '';
    } catch {
      return 'Changing the passcode failed. Nothing was changed.';
    }
  }

  async function handleRemovePasscode() {
    try {
      const session = await disableProtection(store);
      applySession(session);
      setSaveNote('Passcode protection is off. Records are stored without encryption on this device.');
    } catch {
      setSaveError('Removing passcode protection failed. Nothing was changed.');
    }
  }

  function handleLockNow() {
    sessionRef.current = null;
    setStore(emptyStore());
    setView({ name: 'roster' });
    lockoutRemainingMs()
      .then(setInitialLockoutMs)
      .catch(() => setInitialLockoutMs(0));
    setPhase('locked');
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

  function confirmAndCommitImport(imported: Store) {
    const count = imported.students.length;
    const confirmed = window.confirm(
      `Replace all current data with this backup? The backup holds ${count} student record${count === 1 ? '' : 's'}. Current data on this device will be overwritten.`,
    );
    if (!confirmed) return;
    setPendingEncryptedBackup('');
    setView({ name: 'roster' });
    commit(imported);
  }

  function handleImportFile(file: File) {
    file.text().then((text) => {
      const inspection = inspectBackup(text);
      if (inspection.kind === 'error') {
        setSaveError(`Import refused. ${inspection.error}`);
        return;
      }
      if (inspection.kind === 'encrypted') {
        setSaveError('');
        setPendingEncryptedBackup(text);
        setView({ name: 'roster' });
        return;
      }
      if (!inspection.result.ok) {
        setSaveError(`Import refused. ${inspection.result.error}`);
        return;
      }
      confirmAndCommitImport(inspection.result.store);
    });
  }

  async function handleEncryptedImportPassword(password: string): Promise<string> {
    const result = await openEncryptedBackup(pendingEncryptedBackup, password);
    if (!result.ok) return result.error;
    confirmAndCommitImport(result.store);
    return '';
  }

  if (phase === 'loading') {
    return (
      <main>
        <p>Loading saved data from this device.</p>
      </main>
    );
  }

  if (phase === 'setup') {
    return (
      <main>
        <header className="app-header">
          <h1>FCP-R Profile</h1>
          <p>Functional Communication Profile - Revised. Data stays on this device.</p>
        </header>
        {loadError && <div className="banner banner-error">{loadError}</div>}
        <SetupScreen onSetPasscode={handleSetupPasscode} onOptOut={handleOptOut} />
      </main>
    );
  }

  if (phase === 'locked') {
    return (
      <main>
        <header className="app-header">
          <h1>FCP-R Profile</h1>
          <p>Functional Communication Profile - Revised. Data stays on this device.</p>
        </header>
        <UnlockScreen
          initialLockoutMs={initialLockoutMs}
          onUnlock={handleUnlock}
          onRecoveryUnlock={handleRecoveryUnlock}
        />
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
              Saved data is large. Export a backup from the roster screen and keep it somewhere
              safe. Browsers can clear site data when space runs low.
            </div>
          )}
          {saveNote && !saveError && <p className="save-status">{saveNote}</p>}
        </div>
      )}

      {recoveryKeyToShow && view.name === 'roster' && (
        <section className="panel no-print" role="alert">
          <h2>Save your recovery key</h2>
          <p>
            This recovery key is shown once. It is the only way back in if you forget your
            passcode. Write it down or store it in a password manager, somewhere separate from
            this device.
          </p>
          <p className="recovery-key">{recoveryKeyToShow}</p>
          <button type="button" onClick={() => setRecoveryKeyToShow('')}>
            I have saved the recovery key
          </button>
        </section>
      )}

      {pendingEncryptedBackup && view.name === 'roster' && (
        <EncryptedImportPrompt
          onSubmit={handleEncryptedImportPassword}
          onCancel={() => setPendingEncryptedBackup('')}
        />
      )}

      {view.name === 'roster' && (
        <RosterView
          store={store}
          protectionMode={protectionMode}
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
          onExportEncrypted={async (password) => {
            const text = await createEncryptedBackupText(store, password);
            download(
              `fcpr-backup-encrypted-${new Date().toISOString().slice(0, 10)}.json`,
              text,
              'application/json',
            );
          }}
          onImportClick={() => fileInputRef.current?.click()}
          onEnableProtection={handleEnableProtection}
          onChangePasscode={handleChangePasscode}
          onRemovePasscode={handleRemovePasscode}
          onLockNow={handleLockNow}
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

function PasscodeFields(props: { idPrefix: string; label: string }) {
  return (
    <>
      <label>
        {props.label}
        <input
          className="text-input"
          type="password"
          name={`${props.idPrefix}-passcode`}
          autoComplete="new-password"
        />
      </label>
      <label>
        Repeat it
        <input
          className="text-input"
          type="password"
          name={`${props.idPrefix}-confirm`}
          autoComplete="new-password"
        />
      </label>
    </>
  );
}

function readPasscodePair(form: HTMLFormElement, idPrefix: string): { passcode: string; error: string } {
  const data = new FormData(form);
  const passcode = String(data.get(`${idPrefix}-passcode`) ?? '');
  const confirm = String(data.get(`${idPrefix}-confirm`) ?? '');
  if (passcode.length < 8) return { passcode: '', error: 'Use a passcode of at least 8 characters.' };
  if (passcode !== confirm) return { passcode: '', error: 'The two entries do not match.' };
  return { passcode, error: '' };
}

function SetupScreen(props: {
  onSetPasscode: (passcode: string) => void;
  onOptOut: () => void;
}) {
  const [error, setError] = useState('');
  return (
    <section className="panel">
      <h2>Protect records on this device</h2>
      <p>
        FCP-R records hold student information. You can protect them with a passcode. With a
        passcode on, records are encrypted on this device and the app asks for the passcode each
        time it opens. You will get a recovery key, shown once, for the day the passcode is
        forgotten.
      </p>
      <p>
        A passcode does not send anything anywhere and does not protect records after you unlock
        and export them. You can also skip this and run without a passcode. You can turn protection
        on later in Settings.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const { passcode, error: pairError } = readPasscodePair(e.currentTarget, 'setup');
          if (pairError) {
            setError(pairError);
            return;
          }
          props.onSetPasscode(passcode);
        }}
      >
        <div className="form-grid">
          <PasscodeFields idPrefix="setup" label="New passcode" />
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        <div className="button-row">
          <button type="submit">Set passcode and continue</button>
          <button type="button" className="secondary" onClick={props.onOptOut}>
            Continue without a passcode
          </button>
        </div>
      </form>
    </section>
  );
}

function UnlockScreen(props: {
  initialLockoutMs: number;
  onUnlock: (passcode: string) => Promise<string>;
  onRecoveryUnlock: (recoveryKey: string, newPasscode: string) => Promise<string>;
}) {
  const [error, setError] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const lockedSeconds = Math.ceil(props.initialLockoutMs / 1000);

  return (
    <section className="panel">
      <h2>Enter your passcode</h2>
      <p>Records on this device are encrypted. Enter the passcode to open them.</p>
      {lockedSeconds > 0 && (
        <div className="banner banner-warn">
          Too many failed attempts. Wait about {lockedSeconds} seconds and try again.
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const message = await props.onUnlock(String(data.get('unlock-passcode') ?? ''));
          if (message) setError(message);
        }}
      >
        <div className="form-grid">
          <label>
            Passcode
            <input
              className="text-input"
              type="password"
              name="unlock-passcode"
              autoComplete="current-password"
            />
          </label>
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        <button type="submit">Unlock</button>
      </form>

      <div style={{ marginTop: 16 }}>
        <button type="button" className="secondary" onClick={() => setShowRecovery(!showRecovery)}>
          {showRecovery ? 'Hide recovery key option' : 'Forgot the passcode? Use the recovery key'}
        </button>
      </div>
      {showRecovery && (
        <form
          style={{ marginTop: 12 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const { passcode, error: pairError } = readPasscodePair(e.currentTarget, 'recovery-new');
            if (pairError) {
              setError(pairError);
              return;
            }
            const data = new FormData(e.currentTarget);
            const message = await props.onRecoveryUnlock(
              String(data.get('recovery-key') ?? ''),
              passcode,
            );
            if (message) setError(message);
          }}
        >
          <div className="form-grid">
            <label>
              Recovery key
              <input className="text-input" name="recovery-key" autoComplete="off" />
            </label>
            <PasscodeFields idPrefix="recovery-new" label="New passcode" />
          </div>
          <button type="submit">Unlock and set the new passcode</button>
        </form>
      )}
    </section>
  );
}

function EncryptedImportPrompt(props: {
  onSubmit: (password: string) => Promise<string>;
  onCancel: () => void;
}) {
  const [error, setError] = useState('');
  return (
    <section className="panel no-print" role="alert">
      <h2>This backup is password protected</h2>
      <p>Enter the password set when the backup was exported. Nothing changes until the password opens the file and you confirm the replacement.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const message = await props.onSubmit(String(data.get('backup-password') ?? ''));
          if (message) setError(message);
        }}
      >
        <div className="form-grid">
          <label>
            Backup password
            <input className="text-input" type="password" name="backup-password" autoComplete="off" />
          </label>
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        <div className="button-row">
          <button type="submit">Open backup</button>
          <button type="button" className="secondary" onClick={props.onCancel}>
            Cancel import
          </button>
        </div>
      </form>
    </section>
  );
}

function SettingsPanel(props: {
  protectionMode: ProtectionMode;
  onEnableProtection: (passcode: string) => void;
  onChangePasscode: (newPasscode: string) => Promise<string>;
  onRemovePasscode: () => void;
  onLockNow: () => void;
}) {
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <h2>Settings</h2>
      <h3 style={{ marginTop: 0 }}>Passcode protection</h3>
      {props.protectionMode === 'plain' && (
        <>
          <p>
            Passcode protection is off. Records are stored on this device without encryption, so
            anyone who can open this browser can read them.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const { passcode, error: pairError } = readPasscodePair(e.currentTarget, 'enable');
              if (pairError) {
                setError(pairError);
                return;
              }
              setError('');
              props.onEnableProtection(passcode);
            }}
          >
            <div className="form-grid">
              <PasscodeFields idPrefix="enable" label="New passcode" />
            </div>
            {error && <div className="banner banner-error">{error}</div>}
            <button type="submit">Turn on passcode protection</button>
          </form>
        </>
      )}
      {props.protectionMode === 'encrypted' && (
        <>
          <p>
            Passcode protection is on. Records are encrypted on this device and the app asks for
            the passcode each time it opens.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const { passcode, error: pairError } = readPasscodePair(e.currentTarget, 'change');
              if (pairError) {
                setError(pairError);
                return;
              }
              const message = await props.onChangePasscode(passcode);
              if (message) {
                setError(message);
              } else {
                setError('');
                setNote('Passcode changed.');
                e.currentTarget.reset();
              }
            }}
          >
            <div className="form-grid">
              <PasscodeFields idPrefix="change" label="New passcode" />
            </div>
            {error && <div className="banner banner-error">{error}</div>}
            {note && <p className="save-status">{note}</p>}
            <div className="button-row">
              <button type="submit" className="secondary">
                Change passcode
              </button>
              <button type="button" className="secondary" onClick={props.onLockNow}>
                Lock now
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  if (
                    window.confirm(
                      'Remove passcode protection? Records will be stored on this device without encryption.',
                    )
                  ) {
                    props.onRemovePasscode();
                  }
                }}
              >
                Remove passcode
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

function RosterView(props: {
  store: Store;
  protectionMode: ProtectionMode;
  onOpen: (studentId: string) => void;
  onAddStudent: (name: string, birthdate: string, notes: string) => void;
  onExport: () => void;
  onExportEncrypted: (password: string) => Promise<void>;
  onImportClick: () => void;
  onEnableProtection: (passcode: string) => void;
  onChangePasscode: (newPasscode: string) => Promise<string>;
  onRemovePasscode: () => void;
  onLockNow: () => void;
}) {
  const [name, setName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [notes, setNotes] = useState('');
  const [exportError, setExportError] = useState('');

  return (
    <div className="no-print">
      <section className="panel">
        <h2>Privacy notice</h2>
        <p>
          Everything you enter is stored only on this device, in this browser, in IndexedDB
          storage. There is no account, no server, and nothing is sent anywhere.
        </p>
        <p>
          With passcode protection on, records are encrypted on the device and the app asks for
          the passcode each time it opens. The passcode protects records at rest on this device.
          It does not protect records after they are unlocked, printed, or exported, and it does
          not stop someone from clearing the browser data and deleting the records.
        </p>
        <p>
          If you use a passcode, keep the recovery key somewhere separate from this device. It is
          shown once, and without the passcode or the recovery key the records cannot be opened.
        </p>
        <p>
          Backups are the way back from a cleared browser or a lost device. Export a backup
          regularly. A plain backup file holds the full record set in readable text, so treat it
          like a printed evaluation file. A password-protected backup is encrypted and is the
          safer choice when the file will be stored or moved.
        </p>
        <div className="button-row">
          <button type="button" className="secondary" onClick={props.onExport}>
            Export JSON backup
          </button>
          <button type="button" className="secondary" onClick={props.onImportClick}>
            Import backup
          </button>
        </div>
        <form
          style={{ marginTop: 12 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const { passcode, error: pairError } = readPasscodePair(e.currentTarget, 'export-enc');
            if (pairError) {
              setExportError(pairError);
              return;
            }
            setExportError('');
            await props.onExportEncrypted(passcode);
            e.currentTarget.reset();
          }}
        >
          <div className="form-grid">
            <PasscodeFields idPrefix="export-enc" label="Password for the encrypted backup" />
          </div>
          {exportError && <div className="banner banner-error">{exportError}</div>}
          <button type="submit" className="secondary">
            Export password-protected backup
          </button>
        </form>
      </section>

      <SettingsPanel
        protectionMode={props.protectionMode}
        onEnableProtection={props.onEnableProtection}
        onChangePasscode={props.onChangePasscode}
        onRemovePasscode={props.onRemovePasscode}
        onLockNow={props.onLockNow}
      />

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
