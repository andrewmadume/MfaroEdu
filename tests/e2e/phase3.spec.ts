import { test, expect, type Page } from '@playwright/test';
const tenant = '10000000-0000-4000-8000-000000000001',
  uid = '20000000-0000-4000-8000-000000000001';
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture(page: Page, role = 'SCHOOL_ADMIN') {
  const year = { id: id(1), school_id: tenant, name: '2026', version: 1, archived: false };
  const term = {
    id: id(2),
    school_id: tenant,
    name: 'Term 1',
    academic_year_id: year.id,
    version: 1,
    archived: false,
  };
  const klass = {
    id: id(3),
    school_id: tenant,
    name: '7A',
    academic_year_id: year.id,
    year,
    version: 1,
    archived: false,
  };
  const allocation = {
    id: id(4),
    school_id: tenant,
    class_id: klass.id,
    class: klass,
    subject: { id: id(5), name: 'Mathematics', code: 'MATH' },
    version: 1,
    archived: false,
  };
  const learner = {
    id: id(6),
    name: 'Alex Learner',
    admission_number: 'S001',
    mark: 10 as number | null,
    status: 'MARKED' as string | null,
    comment: '',
    version: 1,
  };
  let rules: any = {
    id: id(7),
    school_id: tenant,
    version: 1,
    bands: [
      { min: 80, label: 'Excellent' },
      { min: 50, label: 'Achieved' },
      { min: 0, label: 'Developing' },
    ],
    pass_percent: 50,
    assessment_types: ['Test', 'Exam'],
    term_weights: { [term.id]: 1 },
  };
  let assessment: any = {
    id: id(8),
    school_id: tenant,
    class_subject_id: allocation.id,
    term_id: term.id,
    name: 'Math test',
    assessment_type: 'Test',
    assessed_on: '2026-02-01',
    max_mark: 20,
    weight: 1,
    version: 1,
    archived: false,
  };
  let reports: any[] = [];
  let notes: any[] = [];
  let failSave = false;
  const doc = () => ({
    student_id: learner.id,
    student_name: learner.name,
    admission_number: learner.admission_number,
    school_name: 'Demo School',
    school_address: '12 Learning Lane',
    school_color: '#0047d6',
    class_name: '7A',
    grade_name: 'Grade 7',
    year_name: '2026',
    year_id: year.id,
    term_name: 'Term 1',
    term_id: term.id,
    subjects: [
      {
        id: id(5),
        name: 'Mathematics',
        code: 'MATH',
        weight: 1,
        percent: (learner.mark! / 20) * 100,
        grade: learner.mark! >= 16 ? 'Excellent' : learner.mark! >= 10 ? 'Achieved' : 'Developing',
        passed: (learner.mark! / 20) * 100 >= rules.pass_percent,
        comment: learner.comment,
        assessments: [
          {
            name: assessment.name,
            type: 'Test',
            date: assessment.assessed_on,
            mark: learner.mark,
            max_mark: 20,
            weight: 1,
            status: learner.status,
            percent: (learner.mark! / 20) * 100,
          },
        ],
      },
    ],
    average: (learner.mark! / 20) * 100,
    pass_percent: rules.pass_percent,
    principal_comment: notes[0]?.principal_comment ?? '',
    promotion_status: notes[0]?.promotion_status ?? '',
    attendance: null,
  });
  await page.addInitScript(
    ({ uid }) =>
      localStorage.setItem(
        'sb-test-school-auth-token',
        JSON.stringify({
          access_token: 'fixture',
          refresh_token: 'fixture',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user: {
            id: uid,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'fixture@example.test',
            app_metadata: { provider: 'email' },
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      ),
    { uid },
  );
  await page.route('https://test-school.supabase.co/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      name = url.pathname.split('/').pop()!;
    let body: any = [],
      count = 0,
      status = 200;
    const input = req.method() === 'POST' || req.method() === 'PATCH' ? req.postDataJSON() : {};
    if (name === 'profiles') body = { id: uid, display_name: 'Academic Example', active: true };
    else if (name === 'user_roles')
      body = [
        {
          school_id: tenant,
          user_id: uid,
          role_id: role,
          schools: {
            id: tenant,
            name: 'Demo School',
            slug: 'demo',
            timezone: 'Africa/Johannesburg',
            currency: 'ZAR',
            brand_color: '#0047d6',
            version: 1,
          },
        },
      ];
    else if (name === 'my_permissions')
      body =
        role === 'PARENT'
          ? ['dashboard.view', 'school.view', 'students.view', 'academics.view', 'results.view']
          : role === 'TEACHER'
            ? [
                'dashboard.view',
                'school.view',
                'students.view',
                'academics.view',
                'assessment.view',
                'assessment.manage',
                'results.view',
              ]
            : [
                'dashboard.view',
                'school.view',
                'students.view',
                'academics.view',
                'assessment.view',
                'assessment.manage',
                'assessment.manage_all',
                'grading.manage',
                'results.view',
                'results.publish',
              ];
    else if (name === 'grading_rules') {
      if (req.method() === 'PATCH') {
        rules = { ...rules, ...input };
        body = rules;
      } else body = rules;
    } else if (name === 'search_markable_subjects' || name === 'search_class_subjects')
      body = [{ ...allocation, total: 1 }];
    else if (name === 'academic_years') body = [year];
    else if (name === 'terms')
      body = [
        term,
        { ...term, id: id(14), name: 'Term 1 · 2027', academic_year_id: id(15) },
      ].filter((row) =>
        Array.from(url.searchParams).every(
          ([key, value]) =>
            !value.startsWith('eq.') || String(row[key as keyof typeof row]) === value.slice(3),
        ),
      );
    else if (name === 'classes') body = [klass];
    else if (name === 'class_subjects') body = [allocation];
    else if (name === 'assessments') {
      if (req.method() === 'POST') {
        assessment = { ...assessment, ...input, id: id(9) };
        body = assessment;
      } else if (req.method() === 'PATCH') {
        assessment = { ...assessment, ...input };
        body = assessment;
      } else {
        body =
          assessment.archived === (url.searchParams.get('archived') === 'eq.true')
            ? [assessment]
            : [];
        count = body.length;
      }
    } else if (name === 'assessment_gradebook') body = { assessment, learners: [learner] };
    else if (name === 'subject_gradebook')
      body = [
        {
          id: learner.id,
          name: learner.name,
          admission_number: learner.admission_number,
          incomplete: learner.status === 'INCOMPLETE',
          denominator: learner.status === 'INCOMPLETE' ? 0 : 1,
          percent: learner.status === 'INCOMPLETE' ? null : (learner.mark! / 20) * 100,
          grade:
            learner.status === 'INCOMPLETE'
              ? 'Incomplete'
              : learner.mark! >= 16
                ? 'Excellent'
                : 'Achieved',
        },
      ];
    else if (name === 'save_assessment_marks') {
      if (failSave) {
        status = 400;
        body = { code: 'P0001', message: 'Marks changed; reload before saving' };
      } else {
        Object.assign(learner, input.entries[0]);
        learner.version++;
        body = null;
      }
    } else if (name === 'preview_term_results') body = [doc()];
    else if (name === 'report_notes') body = notes;
    else if (name === 'save_report_note') {
      notes = [
        {
          student_id: learner.id,
          principal_comment: input.note,
          promotion_status: input.promotion,
          version: 1,
        },
      ];
      body = null;
    } else if (name === 'publish_term_results') {
      const pub = {
        id: crypto.randomUUID(),
        active: true,
        version: 1,
        class_id: klass.id,
        term_id: term.id,
        rules,
      };
      reports = [
        {
          id: crypto.randomUUID(),
          school_id: tenant,
          publication_id: pub.id,
          student_id: learner.id,
          created_at: new Date().toISOString(),
          document: input.expected_documents[0],
          publication: pub,
        },
      ];
      body = pub.id;
    } else if (name === 'published_reports') {
      body = reports.filter(
        (r) => url.searchParams.get('publication.active') !== 'eq.true' || r.publication.active,
      );
      count = body.length;
    } else if (name === 'withdraw_term_results') {
      reports.forEach((r) => {
        r.publication.active = false;
        r.publication.version++;
      });
      body = null;
    } else if (name === 'annual_results')
      body = { ...reports[0].document, annual: true, term_name: 'Annual summary' };
    if (Array.isArray(body)) {
      count = count || body.length;
      if (req.headers().accept?.includes('vnd.pgrst.object')) body = body[0] ?? null;
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: {
        'access-control-expose-headers': 'content-range',
        'content-range': `0-${Math.max(0, count - 1)}/${count}`,
      },
      body: JSON.stringify(body),
    });
  });
  return {
    publish: (count = 1) => {
      const pub = {
        id: id(10),
        active: true,
        version: 1,
        class_id: klass.id,
        term_id: term.id,
        rules,
      };
      reports = [
        {
          id: id(11),
          school_id: tenant,
          student_id: learner.id,
          publication_id: pub.id,
          created_at: new Date().toISOString(),
          document: doc(),
          publication: pub,
        },
      ];
      if (count === 2)
        reports.push({
          ...reports[0],
          id: id(12),
          student_id: id(13),
          document: {
            ...doc(),
            student_id: id(13),
            student_name: 'Jamie Learner',
            admission_number: 'S002',
          },
        });
    },
    fail: () => {
      failSave = true;
    },
    assessment: () => assessment,
  };
}
async function selectAssessment(page: Page) {
  await page.getByLabel('Class subject', { exact: true }).selectOption(id(4));
  await page.getByLabel('Term', { exact: true }).selectOption(id(2));
  await expect(page.getByLabel('Term', { exact: true }).locator('option')).not.toContainText([
    'Term 1 · 2027',
  ]);
  await page.getByRole('button', { name: 'Gradebook', exact: true }).click();
  await expect(page.getByLabel('Mark for Alex Learner')).toBeVisible();
}
test('teacher captures marks, receives a conflict, and keeps unsaved changes', async ({ page }) => {
  const f = await fixture(page, 'TEACHER');
  await page.goto('http://127.0.0.1:4174/academics');
  await selectAssessment(page);
  await expect(page.getByRole('button', { name: 'Grading rules', exact: true })).toHaveCount(0);
  await page.getByLabel('Mark for Alex Learner').fill('17');
  await page.getByLabel('Comment for Alex Learner').fill('Strong work');
  await page.getByRole('button', { name: 'Save marks', exact: true }).click();
  await expect(page.getByText('0 unsaved learner changes')).toBeVisible();
  await expect(page.locator('table.gradebook').getByText('85%', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Subject totals · draft', exact: true }),
  ).toBeVisible();
  f.fail();
  await page.getByLabel('Mark for Alex Learner').fill('18');
  await page.getByRole('button', { name: 'Save marks', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Marks changed');
  await expect(page.getByLabel('Mark for Alex Learner')).toHaveValue('18');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Results & reports', exact: true }).click();
  await expect(page.getByLabel('Mark for Alex Learner')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Reload marks', exact: true }).click();
  await expect(page.getByLabel('Mark for Alex Learner')).toHaveValue('17');
  await expect(page.locator('body')).toHaveJSProperty(
    'scrollWidth',
    await page.evaluate(() => window.innerWidth),
  );
});
test('administrator creates assessment, configures grading, publishes and prints report cards', async ({
  page,
}, info) => {
  const f = await fixture(page);
  page.on('dialog', (d) => d.accept());
  await page.goto('http://127.0.0.1:4174/academics');
  await page.getByRole('button', { name: 'Grading rules', exact: true }).click();
  await page.getByLabel('Pass threshold %').fill('55');
  await page.getByRole('button', { name: 'Save grading rules', exact: true }).click();
  await expect(page.getByLabel('Pass threshold %')).toHaveValue('55');
  await expect(page.getByRole('status')).toContainText('Grading rules saved.');
  await page.getByRole('button', { name: 'Assessments & gradebook', exact: true }).click();
  await page.getByLabel('Class subject', { exact: true }).selectOption(id(4));
  await page.getByLabel('Term', { exact: true }).selectOption(id(2));
  await page.getByRole('button', { name: 'New assessment', exact: true }).click();
  await page.getByLabel('Assessment name').fill('Midterm test');
  await page.getByRole('combobox', { name: 'Assessment type', exact: true }).selectOption('Test');
  await page.getByLabel('Assessment date').fill('2026-02-01');
  await page.getByLabel('Maximum mark').fill('20');
  await page.getByLabel('Weight within subject').fill('1');
  await page.getByRole('button', { name: 'Save assessment', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Midterm test', exact: true })).toHaveCount(0);
  await expect(page.getByRole('rowheader', { name: 'Midterm test', exact: true })).toBeVisible();
  expect(f.assessment().name).toBe('Midterm test');
  await page.getByRole('button', { name: 'Results & reports', exact: true }).click();
  await page.getByLabel('Report class', { exact: true }).selectOption(id(3));
  await page.getByLabel('Report term', { exact: true }).selectOption(id(2));
  await expect(page.getByLabel('Report term', { exact: true }).locator('option')).not.toContainText(
    ['Term 1 · 2027'],
  );
  await page.getByRole('button', { name: 'Preview term results', exact: true }).click();
  await expect(page.getByText('DRAFT · NOT PUBLISHED')).toBeVisible();
  await page.getByRole('button', { name: 'Principal notes & promotion', exact: true }).click();
  await page.getByLabel('Principal comment', { exact: true }).fill('Keep growing.');
  await page.getByLabel('Promotion status', { exact: true }).fill('Progressing');
  await page.getByRole('button', { name: 'Save report notes', exact: true }).click();
  await page.getByRole('button', { name: 'Preview term results', exact: true }).click();
  await page.getByRole('button', { name: 'Publish reviewed results', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View report', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View report', exact: true }).click();
  await expect(page.getByText('Keep growing.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Academic report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Academic report', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printed = 'yes';
    };
  });
  await page.getByRole('button', { name: 'Print / save PDF', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-printed', 'yes');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#print-reports')).toBeVisible();
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    path: info.outputPath('report-card.pdf'),
  });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await page.screenshot({ path: info.outputPath('report-print.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await page.screenshot({ path: info.outputPath('phase3-results.png'), fullPage: true });
  await page.getByRole('button', { name: 'Withdraw release', exact: true }).click();
  await expect(page.getByText('No published reports available.')).toBeVisible();
});
test('parent sees published report and cannot open draft tools', async ({ page }) => {
  const f = await fixture(page, 'PARENT');
  f.publish();
  await page.goto('http://127.0.0.1:4174/academics');
  await expect(
    page.getByRole('button', { name: 'Assessments & gradebook', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview term results', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Grading rules', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo School', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annual summary', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Annual academic summary', exact: true }),
  ).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty(
    'scrollWidth',
    await page.evaluate(() => window.innerWidth),
  );
});
test('class report printing creates a page for each learner', async ({ page }, info) => {
  const f = await fixture(page);
  f.publish(2);
  await page.goto('http://127.0.0.1:4174/academics');
  await page.getByRole('button', { name: 'Results & reports', exact: true }).click();
  await page.getByLabel('Report class', { exact: true }).selectOption(id(3));
  await page.getByLabel('Report term', { exact: true }).selectOption(id(2));
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printed = 'yes';
    };
  });
  await page.getByRole('button', { name: 'Print class / save PDF', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-printed', 'yes');
  await expect(page.locator('#print-reports .report-card')).toHaveCount(2);
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    path: info.outputPath('class-reports.pdf'),
  });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
});
test('teacher can clear a captured mark and recapture it', async ({ page }) => {
  await fixture(page, 'TEACHER');
  await page.goto('http://127.0.0.1:4174/academics');
  await selectAssessment(page);
  await page.getByLabel('Status for Alex Learner').selectOption('INCOMPLETE');
  await page.getByRole('button', { name: 'Save marks', exact: true }).click();
  await expect(page.getByText('0 unsaved learner changes')).toBeVisible();
  await expect(page.getByLabel('Mark for Alex Learner')).toHaveValue('');
  await expect(page.getByLabel('Status for Alex Learner')).toHaveValue('INCOMPLETE');
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: 'Alex Learner S001' }) })
      .last(),
  ).toContainText('Incomplete');
  await page.getByLabel('Mark for Alex Learner').fill('15');
  await page.getByRole('button', { name: 'Save marks', exact: true }).click();
  await expect(page.getByLabel('Status for Alex Learner')).toHaveValue('MARKED');
  await expect(page.locator('table.gradebook').getByText('75%', { exact: true })).toBeVisible();
});
