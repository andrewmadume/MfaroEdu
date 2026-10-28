import { Link } from 'react-router-dom';
const phases = [
  [
    'Foundation',
    'Authentication, school workspaces, permissions, settings, audit trail and PWA shell.',
  ],
  [
    'Learners & staff',
    'Learners, parents, teachers, grades, classes, subjects and historical enrollment.',
  ],
  ['Academics', 'Assessments, configurable grading, results and printable report cards.'],
  ['Attendance & timetables', 'Daily attendance, rooms, schedules and conflict detection.'],
  ['Finance', 'Fee structures, invoices, payments, receipts and statements.'],
  ['Communication & library', 'Announcements, notifications, messaging and book circulation.'],
  [
    'Advanced capabilities',
    'Analytics, validated imports, exports, offline drafts and integrations.',
  ],
];
export default function Roadmap() {
  return (
    <main className="roadmap">
      <Link to="/" className="text-link">
        MfaroEdu
      </Link>
      <header className="page-heading">
        <span className="eyebrow">BUILDING YOUR SCHOOL WORKSPACE</span>
        <h1>
          One strong foundation.
          <br />
          Room to grow.
        </h1>
        <p>
          Phases 1-7 are implemented. Live account and device acceptance remains pending before
          Phase 8.
        </p>
      </header>
      <div className="roadmap-list">
        {phases.map(([name, description], i) => (
          <article className="panel" key={name}>
            <span className="phase-number">0{i + 1}</span>
            <div>
              <div className="section-heading">
                <h2>{name}</h2>
                <span className="badge green">
                  {i === 3 ? 'Completed in this release' : 'Implemented'}
                </span>
              </div>
              <p className="muted">{description}</p>
            </div>
          </article>
        ))}
      </div>
      <p className="muted">
        Production readiness requires testing against your configured Supabase project before school
        records are introduced.
      </p>
    </main>
  );
}
