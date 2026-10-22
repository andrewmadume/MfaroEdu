import { test, expect, type Page } from '@playwright/test';
const tenant = '10000000-0000-4000-8000-000000000001';
const uid = '20000000-0000-4000-8000-000000000001';
type Row = Record<string, unknown> & { id: string };
async function mockSchool(page: Page, role = 'SCHOOL_ADMIN') {
  const data: Record<string, Row[]> = Object.fromEntries(
    [
      'students',
      'parents',
      'staff',
      'academic_years',
      'terms',
      'grades',
      'classes',
      'subjects',
      'student_parents',
      'class_subjects',
      'teacher_assignments',
      'enrollments',
    ].map((t) => [t, []]),
  );
  const make = (table: string, values: Record<string, unknown>) => {
    const row = {
      id: crypto.randomUUID(),
      school_id: tenant,
      version: 1,
      archived: false,
      created_at: new Date().toISOString(),
      ...values,
    };
    data[table].push(row);
    return row;
  };
  const get = (table: string, id: unknown) => data[table]?.find((r) => r.id === id) ?? null;
  const enrich = (table: string, row: Row): Row => ({
    ...row,
    ...(table === 'classes'
      ? { year: get('academic_years', row.academic_year_id), grade: get('grades', row.grade_id) }
      : {}),
    ...(table === 'terms' ? { year: get('academic_years', row.academic_year_id) } : {}),
    ...(table === 'student_parents' ? { parent: get('parents', row.parent_id) } : {}),
    ...(table === 'class_subjects'
      ? { class: get('classes', row.class_id), subject: get('subjects', row.subject_id) }
      : {}),
    ...(table === 'teacher_assignments'
      ? { allocation: enrich('class_subjects', get('class_subjects', row.class_subject_id)!) }
      : {}),
    ...(table === 'enrollments'
      ? { class: get('classes', row.class_id), year: get('academic_years', row.academic_year_id) }
      : {}),
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
    const request = route.request();
    const url = new URL(request.url());
    const name = url.pathname.split('/').pop()!;
    let body: unknown = [];
    let count = 0;
    if (name === 'profiles') body = { id: uid, display_name: 'Admin Example', active: true };
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
        role === 'SCHOOL_ADMIN'
          ? [
              'dashboard.view',
              'school.view',
              'school.update',
              'members.view',
              'students.view',
              'students.view_all',
              'students.manage',
              'parents.view',
              'parents.manage',
              'staff.view',
              'staff.manage',
              'academics.view',
              'academics.manage',
              'enrollments.view',
              'enrollments.manage',
            ]
          : [
              'dashboard.view',
              'school.view',
              'students.view',
              'academics.view',
              'enrollments.view',
            ];
    else if (name === 'search_class_subjects') {
      const input = request.postDataJSON();
      const rows = data.class_subjects.map((r) => enrich('class_subjects', r));
      body = rows
        .filter((r) =>
          JSON.stringify(r).toLowerCase().includes(String(input.search_term).toLowerCase()),
        )
        .map((r) => ({ ...r, total: rows.length }));
    } else if (name === 'enroll_student') {
      const input = request.postDataJSON();
      if (input.previous_enrollment) {
        const previous = get('enrollments', input.previous_enrollment)!;
        Object.assign(previous, {
          ends_on: input.previous_end,
          status: input.closure_status,
          version: Number(previous.version) + 1,
        });
      }
      const klass = get('classes', input.target_class)!;
      body = make('enrollments', {
        student_id: input.learner,
        class_id: klass.id,
        academic_year_id: klass.academic_year_id,
        starts_on: input.start_date,
        ends_on: null,
        status: 'ACTIVE',
      }).id;
    } else if (name === 'close_enrollment') {
      const input = request.postDataJSON();
      const row = get('enrollments', input.enrollment_key)!;
      Object.assign(row, {
        ends_on: input.end_date,
        status: input.closure_status,
        version: Number(row.version) + 1,
      });
      body = null;
    } else if (data[name]) {
      if (request.method() === 'POST') body = make(name, request.postDataJSON());
      else {
        let rows = data[name].filter((row) =>
          Array.from(url.searchParams).every(([key, value]) => {
            if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
            if (key === 'search_text' && value.startsWith('ilike.'))
              return JSON.stringify(row).toLowerCase().includes(value.slice(7, -1).toLowerCase());
            return true;
          }),
        );
        if (request.method() === 'PATCH') {
          rows.forEach((row) => Object.assign(row, request.postDataJSON()));
        }
        count = rows.length;
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 20);
        rows = rows.slice(offset, offset + limit);
        body = request.headers().accept?.includes('vnd.pgrst.object')
          ? rows[0]
            ? enrich(name, rows[0])
            : null
          : rows.map((row) => enrich(name, row));
      }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'content-range': count ? `0-${count - 1}/${count}` : '*/0',
        'access-control-expose-headers': 'content-range',
      },
      body: request.method() === 'HEAD' ? '' : JSON.stringify(body),
    });
  });
  return { data, make };
}
async function openDirectory(page: Page, key: string) {
  await page.goto(`http://127.0.0.1:4174/records/${key}`);
}
async function addNamed(
  page: Page,
  entity: string,
  singular: string,
  name: string,
  extra?: () => Promise<void>,
) {
  await openDirectory(page, entity);
  await page.getByRole('button', { name: `Add ${singular}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await extra?.();
  await page.getByRole('button', { name: `Create ${singular}`, exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Record saved.');
}
test('administrator builds academic structure, registers learner, links guardian and enrolls', async ({
  page,
}, info) => {
  const fixture = await mockSchool(page);
  await addNamed(page, 'academic_years', 'academic year', '2026', async () => {
    await page.getByLabel('Starts on', { exact: true }).fill('2026-01-01');
    await page.getByLabel('Ends on', { exact: true }).fill('2026-12-31');
  });
  await addNamed(page, 'grades', 'grade', 'Grade 7');
  await addNamed(page, 'classes', 'class', '7A', async () => {
    await page
      .getByRole('combobox', { name: 'Academic year', exact: true })
      .selectOption({ label: '2026' });
    await page
      .getByRole('combobox', { name: 'Grade', exact: true })
      .selectOption({ label: 'Grade 7' });
  });
  await addNamed(page, 'subjects', 'subject', 'Mathematics', async () => {
    await page.getByLabel('Subject code', { exact: true }).fill('MATH');
  });
  await openDirectory(page, 'classes');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Add class subject', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Subject', exact: true })
    .selectOption({ label: 'MATH · Mathematics' });
  await page.getByRole('button', { name: 'Create class subject', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Record saved.');
  await openDirectory(page, 'staff');
  await page.getByRole('button', { name: 'Add staff member', exact: true }).click();
  await page.getByRole('textbox', { name: 'Employee number', exact: true }).fill('T001');
  await page.getByRole('textbox', { name: 'First name', exact: true }).fill('Tendai');
  await page.getByRole('textbox', { name: 'Surname', exact: true }).fill('Dube');
  await page.getByRole('textbox', { name: 'Position', exact: true }).fill('Teacher');
  await page.getByRole('checkbox', { name: 'Teaching staff' }).check();
  await page.getByRole('button', { name: 'Create staff member', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Record saved.');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Add teaching assignment', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Class subject', exact: true })
    .selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Create teaching assignment', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Record saved.');
  expect(fixture.data.teacher_assignments).toHaveLength(1);
  await openDirectory(page, 'parents');
  await page.getByRole('button', { name: 'Add guardian', exact: true }).click();
  await page.getByRole('textbox', { name: 'First name', exact: true }).fill('Pat');
  await page.getByRole('textbox', { name: 'Surname', exact: true }).fill('Moyo');
  await page.getByRole('button', { name: 'Create guardian', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Record saved.');
  await openDirectory(page, 'students');
  await page.getByRole('button', { name: 'Add learner', exact: true }).click();
  await page.getByRole('textbox', { name: 'Admission number', exact: true }).fill('ADM001');
  await page.getByRole('textbox', { name: 'First name', exact: true }).fill('Alex');
  await page.getByRole('textbox', { name: 'Surname', exact: true }).fill('Moyo');
  await page.getByLabel('Date of birth', { exact: true }).fill('2014-01-01');
  await page.getByLabel('Admission date', { exact: true }).fill('2026-01-01');
  await page.getByRole('button', { name: 'Create learner', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Record saved.');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Add guardian link', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Guardian', exact: true })
    .selectOption({ label: 'Pat Moyo' });
  await page.getByRole('textbox', { name: 'Relationship', exact: true }).fill('Parent');
  await page.getByRole('button', { name: 'Create guardian link', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Record saved.');
  await page.getByRole('button', { name: 'Enroll learner', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Academic year', exact: true })
    .selectOption({ label: '2026' });
  await page
    .getByRole('combobox', { name: 'Destination class', exact: true })
    .selectOption({ label: '7A · 2026' });
  await page.getByLabel('New enrollment starts').fill('2026-01-02');
  await page.getByRole('button', { name: 'Save enrollment', exact: true }).click();
  await expect(
    page.getByText('Enrollment saved. Earlier records have been retained.'),
  ).toBeVisible();
  expect(fixture.data.enrollments).toHaveLength(1);
  expect(fixture.data.student_parents).toHaveLength(1);
  expect(fixture.data.class_subjects).toHaveLength(1);
  await expect(page.getByRole('cell', { name: '7A', exact: true })).toBeVisible();
  await expect(page.getByText('1 enrollments', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('phase2-learner.png'), fullPage: true });
});
test('teacher reads learner directory without edit, archive or enrollment controls', async ({
  page,
}) => {
  const fixture = await mockSchool(page, 'TEACHER');
  fixture.make('students', {
    admission_number: 'A001',
    first_name: 'Alex',
    surname: 'Moyo',
    status: 'ACTIVE',
  });
  await openDirectory(page, 'students');
  await expect(page.getByRole('cell', { name: 'Alex', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add learner', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Enrollment history' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enroll learner' })).toHaveCount(0);
});
test('archive and restore retains a staff record and search filters the list', async ({ page }) => {
  const fixture = await mockSchool(page);
  fixture.make('staff', {
    first_name: 'Alex',
    surname: 'Dube',
    employee_number: 'T001',
    position: 'Teacher',
    is_teacher: true,
  });
  fixture.make('staff', {
    first_name: 'Pat',
    surname: 'Moyo',
    employee_number: 'T002',
    position: 'Teacher',
    is_teacher: true,
  });
  await openDirectory(page, 'staff');
  await page.getByRole('searchbox', { name: 'Search staff & teachers' }).fill('Dube');
  await expect(page.getByRole('cell', { name: 'Moyo', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Archive record', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Dube', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Records', exact: true }).selectOption('archived');
  await expect(page.getByRole('cell', { name: 'Dube', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: 'Restore record', exact: true }).click();
  expect(fixture.data.staff).toHaveLength(2);
  await expect(page.getByRole('status')).toHaveText('Record restored.');
});
