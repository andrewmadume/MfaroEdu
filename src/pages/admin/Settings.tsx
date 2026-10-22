import SchoolForm from './SchoolForm';
import { useSchool } from '../../contexts/SchoolContext';
export default function Settings() {
  const { school, refresh } = useSchool();
  return (
    <>
      <header className="page-heading">
        <span className="eyebrow">ADMINISTRATION</span>
        <h1>School settings</h1>
        <p>Make this workspace your school’s own.</p>
      </header>
      <SchoolForm key={school.id} school={school} onSaved={refresh} />
    </>
  );
}
