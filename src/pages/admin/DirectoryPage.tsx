import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { can } from '../../lib/permissions';
import {
  entities,
  isEntityKey,
  directoryGroups,
  recordLabel,
  displayValue,
} from '../../lib/directory';
import type { EntityKey } from '../../types/directory';
import { getRecord } from '../../services/directory';
import RecordList from '../../components/tables/RecordList';
import EnrollmentPanel from './EnrollmentPanel';
import { ErrorMessage, Loading } from '../../components/ui/Feedback';
function RecordDetails({
  entity,
  id,
  onBack,
}: {
  entity: EntityKey;
  id: string;
  onBack: () => void;
}) {
  const { school, permissions } = useSchool();
  const query = useQuery({
    queryKey: ['record', school.id, entity, id],
    queryFn: () => getRecord(school.id, entity, id),
  });
  if (query.isPending) return <Loading />;
  if (query.isError)
    return (
      <>
        <button className="secondary" onClick={onBack}>
          Back to list
        </button>
        <ErrorMessage message={query.error.message} />
      </>
    );
  const record = query.data;
  return (
    <>
      <div className="detail-heading">
        <button className="secondary" onClick={onBack}>
          Back to {entities[entity].title.toLowerCase()}
        </button>
        <span className="badge">{record.archived ? 'Archived' : 'Active record'}</span>
      </div>
      <section className="panel">
        <h2>{recordLabel(record)}</h2>
        <dl className="record-details">
          {entities[entity].fields
            .filter((f) => f.kind !== 'reference')
            .map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>{displayValue(record[f.key])}</dd>
              </div>
            ))}
        </dl>
      </section>
      {entity === 'students' && (
        <>
          <EnrollmentPanel student={id} archived={record.archived} />
          {can(permissions, 'parents.view') && (
            <RecordList entity="student_parents" pinned={{ student_id: id }} compact />
          )}
        </>
      )}
      {entity === 'classes' && (
        <RecordList entity="class_subjects" pinned={{ class_id: id }} compact />
      )}
      {entity === 'staff' && Boolean(record.is_teacher) && (
        <RecordList entity="teacher_assignments" pinned={{ staff_id: id }} compact />
      )}
    </>
  );
}
function Directory({ entity }: { entity: EntityKey }) {
  const { permissions, school } = useSchool();
  const [selected, setSelected] = useState('');
  const def = entities[entity];
  if (!can(permissions, def.view))
    return (
      <section className="panel">
        <h1>Access unavailable</h1>
        <p>Your account does not have permission for these records.</p>
      </section>
    );
  return (
    <>
      <header className="page-heading">
        <span className="eyebrow">
          {['students', 'parents', 'staff'].includes(entity)
            ? 'PEOPLE & ENROLLMENT'
            : 'ACADEMIC STRUCTURE'}
        </span>
        <h1>{def.title}</h1>
        <p>{def.description}</p>
      </header>
      <nav className="directory-tabs" aria-label="Directory sections">
        {directoryGroups
          .find((g) => (g.keys as readonly string[]).includes(entity))
          ?.keys.filter((key) => can(permissions, entities[key].view))
          .map((key) => (
            <Link className={key === entity ? 'selected' : ''} to={`/records/${key}`} key={key}>
              {entities[key].title}
            </Link>
          ))}
      </nav>
      {selected ? (
        <RecordDetails
          key={`${school.id}-${entity}-${selected}`}
          entity={entity}
          id={selected}
          onBack={() => setSelected('')}
        />
      ) : (
        <RecordList
          key={`${school.id}-${entity}`}
          entity={entity}
          onView={(row) => setSelected(row.id)}
        />
      )}
    </>
  );
}
export default function DirectoryPage() {
  const { entity = '' } = useParams();
  const { school } = useSchool();
  if (
    !isEntityKey(entity) ||
    !directoryGroups.some((g) => (g.keys as readonly string[]).includes(entity))
  )
    return (
      <div className="panel">
        <h1>Page not found</h1>
      </div>
    );
  return <Directory key={`${school.id}-${entity}`} entity={entity} />;
}
