import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings,
  Users,
  ClipboardList,
  LogOut,
  Menu,
  X,
  CircleUserRound,
  Layers,
  CalendarDays,
  Wallet,
  MessagesSquare,
  LibraryBig,
} from 'lucide-react';
import { useSchool } from '../contexts/SchoolContext';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../lib/permissions';
import { phase4Enabled } from '../lib/features';
import { ErrorMessage } from '../components/ui/Feedback';
export default function SchoolLayout({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { school, access, permissions } = useSchool();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false),
    [error, setError] = useState('');
  const schools = Array.from(
    new Map(access.memberships.map((m) => [m.school_id, m.schools])).values(),
  );
  const nav = [
    ...(access.platformAdmin
      ? [
          {
            path: '/platform',
            title: 'Platform administration',
            icon: Settings,
            permission: 'dashboard.view',
          },
        ]
      : []),
    {
      path: `/offline?school=${school.id}&name=${encodeURIComponent(school.name)}`,
      title: 'Offline catalogue drafts',
      icon: LibraryBig,
      permission: 'library.manage',
    },
    {
      path: '/advanced',
      title: 'Reports & data',
      icon: ClipboardList,
      permission: 'analytics.view',
    },
    {
      path: '/communication',
      title: 'Communication hub',
      icon: MessagesSquare,
      permission: 'communication.view',
    },
    { path: '/library', title: 'School library', icon: LibraryBig, permission: 'library.view' },
    { path: '/finance', title: 'Fees & accounts', icon: Wallet, permission: 'finance.view' },
    ...(phase4Enabled
      ? [
          {
            path: '/operations',
            title: 'Attendance & timetable',
            icon: CalendarDays,
            permission: 'attendance.view',
          },
        ]
      : []),
    { path: '/', title: 'Overview', icon: LayoutDashboard, permission: 'dashboard.view' },
    { path: '/records/students', title: 'Learners', icon: Users, permission: 'students.view' },
    {
      path: '/academics',
      title: 'Assessments & results',
      icon: ClipboardList,
      permission: 'results.view',
    },
    {
      path: '/records/parents',
      title: 'Parents & guardians',
      icon: Users,
      permission: 'parents.view',
    },
    { path: '/records/staff', title: 'Staff & teachers', icon: Users, permission: 'staff.view' },
    {
      path: '/records/academic_years',
      title: 'Academic structure',
      icon: Layers,
      permission: 'academics.view',
    },
    { path: '/settings', title: 'School settings', icon: Settings, permission: 'school.update' },
    { path: '/members', title: 'People & access', icon: Users, permission: 'members.view' },
    { path: '/audit', title: 'Audit trail', icon: ClipboardList, permission: 'audit.view' },
  ];
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {open && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Link className="brand" to="/">
          <img
            className="brand-logo"
            src="/mfaroedu-logo.png"
            alt="MfaroEdu"
            width="192"
            height="128"
          />
        </Link>
        <button
          className="mobile-close secondary"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        >
          <X />
        </button>
        <label className="school-picker">
          YOUR SCHOOL
          <select
            value={selected}
            onChange={(e) => {
              onSelect(e.target.value);
              setOpen(false);
            }}
          >
            {schools.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {nav
            .filter((n) => can(permissions, n.permission))
            .map((n) => (
              <NavLink key={n.path} to={n.path} end onClick={() => setOpen(false)}>
                <n.icon size={19} />
                {n.title}
              </NavLink>
            ))}
          <NavLink to="/profile" onClick={() => setOpen(false)}>
            <CircleUserRound size={19} />
            My profile
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <Link to="/roadmap">
            <Layers size={18} />
            Development roadmap
          </Link>
          <div className="release-tag">
            <span />
            Communication & library · v0.6
          </div>
          <button
            className="signout"
            onClick={() => void signOut().catch((e) => setError(e.message))}
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu secondary"
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu />
          </button>
          <span className="school-name">{school.name}</span>
          <Link className="user-chip" to="/profile">
            <span>{(access.profile.display_name || 'U').slice(0, 1).toUpperCase()}</span>
            <span>{access.profile.display_name || 'Your account'}</span>
          </Link>
        </header>
        <main id="main" className="content">
          <ErrorMessage message={error} />
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>MfaroEdu</span>
          <span>A little more time for what matters.</span>
        </footer>
      </div>
    </div>
  );
}
