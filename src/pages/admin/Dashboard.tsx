import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { attendanceDashboard } from '../../services/operations';
import { schoolToday } from '../../lib/operations';
import { schoolCounts } from '../../services/directory';
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Users,
  ShieldCheck,
  Check,
  Clock3,
} from 'lucide-react';
import { useSchool } from '../../contexts/SchoolContext';
import { can, roleLabels } from '../../lib/permissions';
const priorities: Record<string, string[]> = {
  SCHOOL_ADMIN: [
    'Your school at a glance',
    'Prepare your school workspace and manage your team’s access.',
  ],
  PRINCIPAL: [
    'A clear view of your school',
    'Your academic and operational overview will come together here.',
  ],
  TEACHER: [
    'Space to focus on teaching',
    'Your assigned classes, timetable and assessment work will appear here.',
  ],
  STUDENT: [
    'Your learning, in one place',
    'Your subjects, timetable and published results will appear here.',
  ],
  PARENT: [
    'Stay close to their learning',
    'Your linked children, school updates and reports will appear here.',
  ],
  ACCOUNTANT: [
    'Keep school finances in view',
    'Manage fee structures, learner accounts, payments received and statements.',
  ],
  LIBRARIAN: [
    'A home for your school library',
    'Manage the catalogue, physical copies, borrowing and returns.',
  ],
};
export default function Dashboard() {
  const { school, access, permissions } = useSchool();
  const counts = useQuery({
    queryKey: ['school-counts', school.id],
    queryFn: () => schoolCounts(school.id),
    enabled: can(permissions, 'students.view'),
  });
  const today = schoolToday(school.timezone);
  const attendance = useQuery({
    queryKey: ['attendance-dashboard', school.id, today],
    queryFn: () => attendanceDashboard(school.id, today),
    enabled: can(permissions, 'attendance.view'),
  });
  const wholeSchool = can(permissions, 'students.view_all');
  const roles = access.memberships.filter((m) => m.school_id === school.id).map((m) => m.role_id);
  const role = roles.find((r) => r === 'SCHOOL_ADMIN') ?? roles[0];
  const copy = priorities[role] ?? priorities.SCHOOL_ADMIN;
  return (
    <>
      <header className="page-heading heading-row">
        <div>
          <span className="eyebrow">{roleLabels[role]?.toUpperCase() ?? 'SCHOOL WORKSPACE'}</span>
          <h1>{copy[0]}</h1>
          <p>{copy[1]}</p>
        </div>
        <div className="date-chip">
          <CalendarDays size={17} />
          {new Intl.DateTimeFormat(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: school.timezone,
          }).format(new Date())}
        </div>
      </header>
      <section className="welcome">
        <div>
          <span className="eyebrow light">WELCOME TO MFAROEDU</span>
          <h2>
            Good to have you here
            {access.profile.display_name ? `, ${access.profile.display_name.split(' ')[0]}` : ''}.
          </h2>
          <p>
            Your school workspace is ready for its next chapter.
            <br />
            Start with the essentials, then grow one step at a time.
          </p>
          {can(permissions, 'school.update') ? (
            <Link to="/settings" className="button pale">
              Review school details <ArrowUpRight size={17} />
            </Link>
          ) : (
            <Link to="/profile" className="button pale">
              Review your profile <ArrowUpRight size={17} />
            </Link>
          )}
        </div>
        <div className="welcome-mark" aria-hidden="true">
          <img src="/mfaroedu-logo.png" alt="" width="210" height="140" />
          <span>{school.name}</span>
        </div>
      </section>
      {can(permissions, 'students.view') && (
        <>
          <div className="stat-grid">
            {[
              {
                title: wholeSchool ? 'Learners' : 'Your learners',
                icon: Users,
                value: counts.data?.students,
                path: '/records/students',
              },
              ...(wholeSchool
                ? [
                    {
                      title: 'Staff & teachers',
                      icon: BookOpen,
                      value: counts.data?.staff,
                      path: '/records/staff',
                    },
                  ]
                : []),
              {
                title: wholeSchool ? 'Classes' : 'Your classes',
                icon: BookOpen,
                value: counts.data?.classes,
                path: '/records/classes',
              },
            ].map((item) => (
              <Link className="stat panel" to={item.path} key={item.title}>
                <div>
                  <span>{item.title}</span>
                  <item.icon size={19} />
                </div>
                <strong>{counts.isPending ? '…' : counts.isError ? '—' : item.value}</strong>
                <small>{wholeSchool ? 'Active records' : 'Records available to you'}</small>
              </Link>
            ))}
            <article className="stat panel">
              <div>
                <span>Today’s attendance</span>
                <CalendarDays size={19} />
              </div>
              <strong>
                {attendance.data?.percentage == null ? '-' : `${attendance.data.percentage}%`}
              </strong>
              <small>
                {attendance.isError
                  ? 'Could not load attendance'
                  : `${attendance.data?.total ?? 0} finalized sessions for authorized learners`}
              </small>
              {can(permissions, 'attendance.view') && <Link to="/operations">View attendance</Link>}
            </article>
          </div>
          {counts.isError && (
            <p role="alert" className="alert error">
              School totals could not be loaded.{' '}
              <button className="text-button" onClick={() => void counts.refetch()}>
                Retry
              </button>
            </p>
          )}
        </>
      )}
      <div className="dashboard-grid">
        {can(permissions, 'communication.view') && (
          <section className="panel">
            <span className="eyebrow">COMMUNICATION · PHASE 06</span>
            <h2>Stay connected to your school.</h2>
            <p>Read announcements, follow notifications and open your private conversations.</p>
            <Link className="text-link" to="/communication">
              Open communication hub <ArrowUpRight size={16} />
            </Link>
          </section>
        )}
        {can(permissions, 'library.view') && (
          <section className="panel">
            <span className="eyebrow">LIBRARY · PHASE 06</span>
            <h2>Find a book. Follow its journey.</h2>
            <p>Browse the catalogue and view the borrowing records available to you.</p>
            <Link className="text-link" to="/library">
              Open school library <ArrowUpRight size={16} />
            </Link>
          </section>
        )}
        {can(permissions, 'finance.view') && (
          <section className="panel">
            <span className="eyebrow">FINANCE · PHASE 05</span>
            <h2>Keep every school fee in view.</h2>
            <p>View invoices, receipts and statements for the learner accounts available to you.</p>
            <Link className="text-link" to="/finance">
              Open fees & accounts <ArrowUpRight size={16} />
            </Link>
          </section>
        )}
        <section className="panel">
          <div className="section-heading">
            <h2>Your workspace essentials</h2>
            <span className="badge green">Foundation</span>
          </div>
          <p className="muted">A solid start for your school community.</p>
          <div className="essential">
            <span className="check-icon">
              <Check size={18} />
            </span>
            <div>
              <h3>School workspace created</h3>
              <p>{school.name}</p>
            </div>
            {can(permissions, 'school.update') && (
              <Link to="/settings" aria-label="Edit school settings">
                <ArrowUpRight size={20} />
              </Link>
            )}
          </div>
          <div className="essential">
            <span className="check-icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <h3>Role-based school access</h3>
              <p>Your role: {roleLabels[role]}</p>
            </div>
            {can(permissions, 'members.view') && (
              <Link to="/members" aria-label="View school memberships">
                <ArrowUpRight size={20} />
              </Link>
            )}
          </div>
          <div className="essential">
            <span className="check-icon">
              <Users size={18} />
            </span>
            <div>
              <h3>Make yourself at home</h3>
              <p>Update your name and account security.</p>
            </div>
            <Link to="/profile" aria-label="Edit your profile">
              <ArrowUpRight size={20} />
            </Link>
          </div>
        </section>
        <section className="panel next-phase">
          <span className="eyebrow">ASSESSMENTS & RESULTS · PHASE 03</span>
          <h2>
            A clear picture
            <br />
            of learning.
          </h2>
          <p>Capture assessment marks, publish results and prepare your school’s report cards.</p>
          <Link to="/roadmap" className="text-link">
            View the development roadmap <ArrowUpRight size={16} />
          </Link>
          <div className="phase-note">
            <Clock3 size={16} />
            Assessments, grading and report cards available
          </div>
        </section>
      </div>
      <div className="foundation-note">
        <ShieldCheck size={17} />
        <p>
          Open the school modules to manage attendance, timetables, academics, finance and
          communication.
        </p>
      </div>
    </>
  );
}
