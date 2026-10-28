import { useState, useEffect } from 'react';
import { useSchool } from '../../contexts/SchoolContext';
import { can } from '../../lib/permissions';
import AttendanceWorkspace from './AttendanceWorkspace';
import AttendanceReports from './AttendanceReports';
import TimetableWorkspace from './TimetableWorkspace';
import RecordList from '../../components/tables/RecordList';
function Modules() {
  const { permissions } = useSchool();
  const tabs = [
    ...(can(permissions, 'attendance.capture') || can(permissions, 'attendance.manage')
      ? ['Take attendance']
      : []),
    ...(can(permissions, 'attendance.view') ? ['Attendance reports'] : []),
    ...(can(permissions, 'timetable.view') ? ['Timetable'] : []),
    ...(can(permissions, 'timetable.manage') ? ['Rooms', 'Time slots'] : []),
  ];
  const [tab, setTab] = useState(tabs[0] ?? ''),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    const click = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest('a') : null;
      if (
        a?.getAttribute('href')?.startsWith('/') &&
        !window.confirm('Discard unsaved attendance?')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);
  if (!tabs.length)
    return (
      <section className="panel">
        <h1>Access unavailable</h1>
        <p>Your school has not assigned attendance or timetable access.</p>
      </section>
    );
  return (
    <>
      <header className="page-heading">
        <span className="eyebrow">ATTENDANCE & TIMETABLE</span>
        <h1>A well-organized school day.</h1>
        <p>Keep track of attendance, plan lessons, and give every class its space.</p>
      </header>
      <nav className="directory-tabs" aria-label="School day modules">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? 'active' : 'secondary'}
            onClick={() => {
              if (tab === t) return;
              if (!dirty || window.confirm('Discard unsaved attendance?')) {
                setDirty(false);
                setTab(t);
              }
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === 'Take attendance' ? (
        <AttendanceWorkspace onUnsaved={setDirty} />
      ) : tab === 'Attendance reports' ? (
        <AttendanceReports />
      ) : tab === 'Timetable' ? (
        <TimetableWorkspace />
      ) : tab === 'Rooms' ? (
        <RecordList entity="rooms" />
      ) : (
        <RecordList entity="time_slots" />
      )}
    </>
  );
}
export default function OperationsPage() {
  const { school } = useSchool();
  return <Modules key={school.id} />;
}
