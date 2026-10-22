import { useState, useEffect } from 'react';
import { useSchool } from '../../contexts/SchoolContext';
import { can } from '../../lib/permissions';
import GradingRules from './GradingRules';
import AssessmentWorkspace from './AssessmentWorkspace';
import ResultsWorkspace from './ResultsWorkspace';
function AcademicModules() {
  const { permissions } = useSchool();
  const tabs = [
    ...(can(permissions, 'assessment.view') ? ['Assessments & gradebook'] : []),
    ...(can(permissions, 'results.view') ? ['Results & reports'] : []),
    ...(can(permissions, 'grading.manage') ? ['Grading rules'] : []),
  ];
  const [tab, setTab] = useState(tabs[0] ?? '');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest('a') : null;
      if (
        link &&
        link.getAttribute('href')?.startsWith('/') &&
        !window.confirm('Discard unsaved marks before leaving?')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', guard, true);
    return () => document.removeEventListener('click', guard, true);
  }, [dirty]);
  if (!tabs.length)
    return (
      <div className="panel">
        <h1>Access unavailable</h1>
        <p>Your school has not assigned academic access.</p>
      </div>
    );
  return (
    <>
      <header className="page-heading">
        <span className="eyebrow">ACADEMICS</span>
        <h1>Every mark tells a story.</h1>
        <p>Capture assessments, release results, and give families a clear view of progress.</p>
      </header>
      <nav className="directory-tabs" aria-label="Academic modules">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? 'active' : 'secondary'}
            onClick={() => {
              if (t === tab) return;
              if (!dirty || window.confirm('Discard unsaved marks?')) {
                setDirty(false);
                setTab(t);
              }
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === 'Grading rules' ? (
        <GradingRules />
      ) : tab === 'Assessments & gradebook' ? (
        <AssessmentWorkspace onUnsaved={setDirty} />
      ) : (
        <ResultsWorkspace />
      )}
    </>
  );
}
export default function AcademicsPage() {
  const { school } = useSchool();
  return <AcademicModules key={school.id} />;
}
