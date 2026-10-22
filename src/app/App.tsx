import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { SchoolProvider, useSchool } from '../contexts/SchoolContext';
import { loadAccess } from '../services/schools';
import { configured } from '../lib/supabase';
import { phase4Enabled } from '../lib/features';
import { can } from '../lib/permissions';
import { Loading, ErrorMessage } from '../components/ui/Feedback';
import SchoolLayout from '../layouts/SchoolLayout';
import SchoolForm from '../pages/admin/SchoolForm';
import PwaStatus from '../components/common/PwaStatus';
const AuthPage = lazy(() => import('../pages/auth/AuthPage'));
const Dashboard = lazy(() => import('../pages/admin/Dashboard'));
const Settings = lazy(() => import('../pages/admin/Settings'));
const Members = lazy(() => import('../pages/admin/Members'));
const Audit = lazy(() => import('../pages/admin/Audit'));
const Profile = lazy(() => import('../pages/auth/Profile'));
const Roadmap = lazy(() => import('../pages/Roadmap'));
const DirectoryPage = lazy(() => import('../pages/admin/DirectoryPage'));
const AcademicsPage = lazy(() => import('../pages/admin/AcademicsPage'));
const OperationsPage = lazy(() => import('../pages/admin/OperationsPage'));
const FinancePage = lazy(() => import('../pages/admin/FinancePage'));
function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { permissions } = useSchool();
  return can(permissions, permission) ? (
    children
  ) : (
    <div className="panel">
      <h1>Access unavailable</h1>
      <p>Your school has not assigned permission for this page.</p>
    </div>
  );
}
function Workspace() {
  const { session, loading, signOut } = useAuth();
  const [selected, setSelected] = useState('');
  const client = useQueryClient();
  const access = useQuery({
    queryKey: ['access', session?.user.id, selected],
    queryFn: () => loadAccess(session!.user.id, selected),
    enabled: !!session,
    refetchInterval: 60000,
  });
  useEffect(() => {
    if (!session) {
      client.clear();
      setSelected('');
    }
  }, [session?.user.id, client]);
  if (loading) return <Loading />;
  if (!configured || !session) return <Navigate to="/auth/login" replace />;
  if (access.isPending) return <Loading />;
  if (access.isError)
    return (
      <div className="state">
        <ErrorMessage message={access.error.message} />
        <button onClick={() => void access.refetch()}>Try again</button>
        <button className="secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  if (!access.data.profile.active)
    return (
      <div className="state">
        <h1>Account inactive</h1>
        <p>Contact your school administrator to restore access.</p>
        <button onClick={() => void signOut()}>Sign out</button>
      </div>
    );
  const school =
    access.data.memberships.find((m) => m.school_id === selected)?.schools ??
    access.data.memberships[0]?.schools;
  if (!school)
    return (
      <main className="onboarding">
        <SchoolForm onSaved={() => access.refetch()} />
        <p className="muted">
          Joining an existing school? Ask its administrator to assign your account access.
        </p>
        <button className="secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </main>
    );
  return (
    <SchoolProvider
      value={{
        access: access.data,
        school,
        permissions: access.data.permissions,
        refresh: () => access.refetch(),
      }}
    >
      <SchoolLayout
        selected={school.id}
        onSelect={(id) => {
          client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'access' });
          setSelected(id);
        }}
      />
    </SchoolProvider>
  );
}
export default function App() {
  return (
    <>
      <PwaStatus />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/auth/:mode" element={<AuthPage />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route element={<Workspace />}>
            <Route path="records/:entity" element={<DirectoryPage />} />
            <Route path="academics" element={<AcademicsPage />} />
            <Route path="finance" element={<FinancePage />} />
            {phase4Enabled && <Route path="operations" element={<OperationsPage />} />}
            <Route
              index
              element={
                <RequirePermission permission="dashboard.view">
                  <Dashboard />
                </RequirePermission>
              }
            />
            <Route
              path="settings"
              element={
                <RequirePermission permission="school.update">
                  <Settings />
                </RequirePermission>
              }
            />
            <Route
              path="members"
              element={
                <RequirePermission permission="members.view">
                  <Members />
                </RequirePermission>
              }
            />
            <Route
              path="audit"
              element={
                <RequirePermission permission="audit.view">
                  <Audit />
                </RequirePermission>
              }
            />
            <Route path="profile" element={<Profile />} />
          </Route>
          <Route
            path="*"
            element={
              <div className="state">
                <h1>Page not found</h1>
                <a href="/">Return to your school</a>
              </div>
            }
          />
        </Routes>
      </Suspense>
    </>
  );
}
