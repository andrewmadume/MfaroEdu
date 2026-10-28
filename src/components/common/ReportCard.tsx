import type { ReportDocument } from '../../types/academics';

export default function ReportCard({
  document: d,

  draft = false,
}: {
  document: ReportDocument;

  draft?: boolean;
}) {
  return (
    <article className="report-card" style={{ borderTopColor: d.school_color }}>
      <header className="report-header">
        <img src="/mfaroedu-logo.png" alt="MfaroEdu" width={150} height={100} />

        <div>
          <h2>{d.school_name}</h2>

          {d.school_address && <p>{d.school_address}</p>}

          <h3>
            {d.annual ? 'Annual academic summary' : 'Academic report card'}{' '}
            {draft && <span className="badge">DRAFT · NOT PUBLISHED</span>}
          </h3>
        </div>
      </header>

      <dl className="report-details">
        <div>
          <dt>Learner</dt>

          <dd>{d.student_name}</dd>
        </div>

        <div>
          <dt>Admission number</dt>

          <dd>{d.admission_number}</dd>
        </div>

        <div>
          <dt>Class / grade</dt>

          <dd>
            {d.class_name} · {d.grade_name}
          </dd>
        </div>

        <div>
          <dt>Year / period</dt>

          <dd>
            {d.year_name} · {d.term_name}
          </dd>
        </div>
      </dl>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Subject</th>

              <th>Percentage</th>

              <th>Grade</th>

              <th>Outcome</th>
            </tr>
          </thead>

          <tbody>
            {d.subjects.map((s) => (
              <tr key={s.id}>
                <th>{s.name}</th>

                <td>{s.percent === null ? 'Exempt' : `${s.percent.toFixed(2)}%`}</td>

                <td>{s.grade}</td>

                <td>{s.passed === null ? '—' : s.passed ? 'Pass' : 'Below threshold'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="report-average">
        Weighted average <strong>{d.average.toFixed(2)}%</strong>
      </p>

      {d.subjects.map((s) => (
        <section className="report-subject" key={s.id}>
          <h4>{s.name}</h4>

          {s.assessments.length > 0 && (
            <p>
              {s.assessments

                .map(
                  (a) =>
                    `${a.name}: ${a.status === 'MARKED' ? `${a.mark} / ${a.max_mark} (${a.percent}%)` : a.status === 'ABSENT' ? 'Absent (0%)' : 'Exempt'} · weight ${a.weight}`,
                )

                .join(' | ')}
            </p>
          )}

          {s.comment && <p className="preserve-lines">{s.comment}</p>}
        </section>
      ))}

      {d.principal_comment && (
        <section>
          <h4>Principal comment</h4>

          <p className="preserve-lines">{d.principal_comment}</p>
        </section>
      )}

      <p>
        <strong>Promotion status:</strong> {d.promotion_status || 'Not recorded'}
      </p>

      <p className="muted">
        Attendance{d.annual ? ' (last published term)' : ''}:{' '}
        {d.attendance
          ? `${d.attendance.present} present · ${d.attendance.late} late · ${d.attendance.absent} absent · ${d.attendance.excused} excused · ${d.attendance.total} recorded sessions · ${d.attendance.percentage === null ? 'No recorded percentage' : `${d.attendance.percentage}% attended`}`
          : 'Not included in this historical report.'}
      </p>

      <footer className="report-footer">
        <p>
          Assessment weights are normalized within each subject; subject weights determine the
          overall average. Absent marks count as zero and exemptions are excluded. Pass threshold:{' '}
          {d.pass_percent}%.
        </p>

        {d.annual && (
          <p>
            Annual summaries combine published term reports using the school’s current term weights
            and grading rules.
          </p>
        )}

        <span>MfaroEdu · Empowering Schools. Inspiring Futures.</span>
      </footer>
    </article>
  );
}
