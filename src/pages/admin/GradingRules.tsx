import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { gradingRules, saveGrading } from '../../services/academics';
import { listRecords } from '../../services/directory';
import { ErrorMessage, Loading } from '../../components/ui/Feedback';
import RecordLookup from '../../components/forms/RecordLookup';
import type { GradingRules as Rules } from '../../types/academics';
function Editor({
  initial,
  onSaved,
  onEdit,
}: {
  initial: Rules | null;
  onSaved: () => void;
  onEdit: () => void;
}) {
  const { school } = useSchool();
  const client = useQueryClient();
  const [bands, setBands] = useState(initial?.bands ?? []),
    [pass, setPass] = useState(String(initial?.pass_percent ?? '')),
    [types, setTypes] = useState(initial?.assessment_types.join('\n') ?? ''),
    [weights, setWeights] = useState(initial?.term_weights ?? {}),
    [year, setYear] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const terms = useQuery({
    queryKey: ['grading-terms', school.id, year],
    queryFn: async () => {
      const rows = [];
      for (let page = 0; ; page++) {
        const chunk = await listRecords(school.id, 'terms', {
          page,
          filters: { academic_year_id: year },
        });
        rows.push(...chunk.rows);
        if (rows.length >= chunk.count) break;
      }
      return rows;
    },
    enabled: !!year,
  });
  return (
    <form
      className="panel academic-form"
      onChange={onEdit}
      onSubmit={async (e) => {
        e.preventDefault();
        onEdit();
        setError('');
        setBusy(true);
        try {
          await saveGrading(
            school.id,
            {
              bands,
              pass_percent: Number(pass),
              assessment_types: types
                .split('\n')
                .map((t) => t.trim())
                .filter(Boolean),
              term_weights: weights,
            },
            initial,
          );
          onSaved();
          await client.invalidateQueries({ queryKey: ['grading', school.id] });
          await client.invalidateQueries({ queryKey: ['subject-gradebook', school.id] });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Rules could not be saved.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>School grading rules</h2>
      <p className="muted">
        Band minimums run from highest to lowest and must end at 0%. Each band extends up to the
        next minimum. Published reports retain their original rules.
      </p>
      <ErrorMessage message={error} />
      <div className="band-list">
        {bands.map((b, i) => (
          <div className="band-row" key={i}>
            <label>
              Minimum %
              <input
                required
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={b.min}
                onChange={(e) =>
                  setBands(
                    bands.map((v, j) => (j === i ? { ...v, min: Number(e.target.value) } : v)),
                  )
                }
              />
            </label>
            <label>
              Grade label
              <input
                required
                maxLength={80}
                value={b.label}
                onChange={(e) =>
                  setBands(bands.map((v, j) => (j === i ? { ...v, label: e.target.value } : v)))
                }
              />
            </label>
            <button
              type="button"
              className="secondary"
              aria-label={`Remove band ${i + 1}`}
              onClick={() => setBands(bands.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="secondary"
        disabled={bands.length >= 30}
        onClick={() => setBands([...bands, { min: 0, label: '' }])}
      >
        Add grading band
      </button>
      <div className="form-grid">
        <label>
          Pass threshold %
          <input
            required
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <label>
          Assessment types · one per line
          <textarea
            required
            rows={4}
            value={types}
            onChange={(e) => setTypes(e.target.value)}
            placeholder={'Enter the types your school uses'}
          />
        </label>
      </div>
      <h3>Annual term weights</h3>
      <p className="muted">
        Set a positive weight for every term in a year to enable annual results. Weights are
        normalized, so 1:1 and 50:50 have the same meaning.
      </p>
      <RecordLookup
        entity="academic_years"
        label="Academic year for weights"
        value={year}
        onChange={setYear}
      />
      {terms.isError && <ErrorMessage message="Term weights could not be loaded." />}
      {terms.data?.map((t) => (
        <label className="weight-row" key={t.id}>
          {String(t.name)}
          <input
            aria-label={`${t.name} annual weight`}
            type="number"
            min="0.01"
            max="1000"
            step="0.01"
            value={weights[t.id] ?? ''}
            onChange={(e) => {
              const next = { ...weights };
              if (e.target.value === '') delete next[t.id];
              else next[t.id] = Number(e.target.value);
              setWeights(next);
            }}
          />
        </label>
      ))}
      <button disabled={busy} type="submit">
        {busy ? 'Saving…' : 'Save grading rules'}
      </button>
    </form>
  );
}
export default function GradingRules() {
  const { school } = useSchool();
  const [saved, setSaved] = useState(false);
  const q = useQuery({
    queryKey: ['grading', school.id],
    queryFn: () => gradingRules(school.id),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorMessage message={q.error.message} />;
  return (
    <>
      {saved && (
        <p role="status" className="alert">
          Grading rules saved.
        </p>
      )}
      <Editor
        key={q.data?.version ?? 0}
        initial={q.data}
        onSaved={() => setSaved(true)}
        onEdit={() => setSaved(false)}
      />
    </>
  );
}
