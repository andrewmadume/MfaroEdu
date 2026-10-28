import { test, expect, type Page } from '@playwright/test';
const tenant = '10000000-0000-4000-8000-000000000001',
  uid = '20000000-0000-4000-8000-000000000001';
const ids = Object.fromEntries(
  ['class', 'term', 'student', 'teacher', 'subject', 'room', 'period', 'session', 'schedule'].map(
    (k, i) => [k, `40000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`],
  ),
);
async function fixture(page: Page, role = 'SCHOOL_ADMIN') {
  const calls: any[] = [];
  let stale = false;
  const session = {
    id: ids.session,
    school_id: tenant,
    class_id: ids.class,
    attended_on: '2026-02-02',
    name: 'Daily',
    status: 'OPEN',
    version: 1,
  };
  const row = {
    id: ids.student,
    name: 'Alex Example',
    admission_number: 'A1',
    status: 'UNMARKED',
    reason: '',
    version: 0,
  };
  let booking: any = null;
  const records: any = {
    classes: [{ id: ids.class, name: '7A' }],
    terms: [{ id: ids.term, name: 'Term 1', starts_on: '2026-01-01', ends_on: '2026-03-31' }],
    students: [{ id: ids.student, first_name: 'Alex', surname: 'Example', admission_number: 'A1' }],
    staff: [{ id: ids.teacher, first_name: 'Teacher', surname: 'Example' }],
    rooms: [{ id: ids.room, name: 'Main room', code: 'R1', capacity: 30 }],
    time_slots: [{ id: ids.period, name: 'Period 1', starts_at: '08:00', ends_at: '09:00' }],
    class_subjects: [{ id: ids.subject, class: { name: '7A' }, subject: { name: 'Mathematics' } }],
  };
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
            email: 'phase4@example.test',
            app_metadata: { provider: 'email' },
            user_metadata: {},
          },
        }),
      ),
    { uid },
  );
  await page.route('https://test-school.supabase.co/**', async (route) => {
    const url = new URL(route.request().url()),
      name = url.pathname.split('/').pop()!,
      input = route.request().method() === 'POST' ? route.request().postDataJSON() : {},
      r = input?.request ?? {};
    let body: any = [],
      status = 200;
    if (name === 'profiles') body = { id: uid, display_name: 'Example user', active: true };
    else if (name === 'user_roles')
      body = [
        {
          school_id: tenant,
          role_id: role,
          schools: {
            id: tenant,
            name: 'Example School',
            timezone: 'Africa/Johannesburg',
            currency: 'ZAR',
            brand_color: '#0047d6',
            version: 1,
          },
        },
      ];
    else if (name === 'platform_read') body = { allowed: false };
    else if (name === 'my_permissions')
      body = [
        'dashboard.view',
        'students.view',
        'attendance.view',
        'timetable.view',
        ...(role === 'PARENT' ? [] : ['attendance.capture']),
        ...(role === 'SCHOOL_ADMIN'
          ? ['attendance.manage', 'timetable.manage', 'students.view_all']
          : []),
      ];
    else if (name === 'timetable_teachers') body = { rows: records.staff, count: 1 };
    else if (name === 'search_class_subjects')
      body = records.class_subjects.map((v: any) => ({ ...v, total: 1 }));
    else if (name === 'operations_read') {
      calls.push(r);
      if (r.op === 'sessions') body = { rows: [session], count: 1 };
      else if (r.op === 'register') body = { session, learners: [row] };
      else if (r.op === 'report')
        body = {
          rows: [
            {
              student_id: ids.student,
              name: 'Alex Example',
              admission_number: 'A1',
              present: 1,
              absent: 0,
              late: 0,
              excused: 0,
              total: 1,
              percentage: 100,
            },
          ],
          count: 1,
        };
      else if (r.op === 'history')
        body = {
          rows: [
            {
              attended_on: '2026-02-02',
              class_name: '7A',
              session_name: 'Daily',
              status: 'PRESENT',
              reason: 'Example reason',
            },
          ],
          count: 1,
        };
      else if (r.op === 'teachers') body = { rows: records.staff, count: 1 };
      else if (r.op === 'schedules')
        body = {
          rows: booking && booking.active === r.only_active ? [booking] : [],
          count: booking && booking.active === r.only_active ? 1 : 0,
        };
      else if (r.op === 'week')
        body = booking?.active ? [{ ...booking, lesson_on: '2026-02-02' }] : [];
      else body = { present: 1, absent: 0, late: 0, excused: 0, total: 1, percentage: 100 };
    } else if (name === 'operations_write') {
      calls.push(r);
      if (r.op === 'open') body = ids.session;
      else if (r.op === 'save') {
        if (stale) {
          status = 400;
          body = { message: 'Register changed; reload before saving' };
          stale = false;
        } else {
          Object.assign(row, r.entries[0], { version: row.version + 1 });
          session.version++;
          body = null;
        }
      } else if (r.op === 'state') {
        session.status = r.next_state;
        session.version++;
        body = null;
      } else if (r.op === 'schedule') {
        booking = {
          ...r.values,
          id: ids.schedule,
          school_id: tenant,
          class_id: ids.class,
          version: (booking?.version ?? 0) + 1,
          class_name: '7A',
          subject_name: 'Mathematics',
          teacher_name: 'Teacher Example',
          room_name: 'Main room',
          period_name: 'Period 1',
          starts_at: '08:00',
          ends_at: '09:00',
        };
        body = ids.schedule;
      }
    } else if (records[name]) {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      body = id ? records[name].find((v: any) => v.id === id) : records[name];
    }
    await route.fulfill({
      status,
      json: body,
      headers: { 'content-range': '0-0/1', 'access-control-expose-headers': 'content-range' },
    });
  });
  return {
    calls,
    staleNext: () => {
      stale = true;
    },
  };
}
async function openRegister(page: Page) {
  await page.goto('http://127.0.0.1:4174/operations');
  await page.getByLabel('Attendance class', { exact: true }).selectOption(ids.class);
  await page.getByLabel('Attendance date', { exact: true }).fill('2026-02-02');
  await page.getByRole('button', { name: 'View register', exact: true }).click();
  await expect(page.getByLabel('Attendance for Alex Example')).toBeVisible();
}
test('administrator saves, finalizes, reopens and reviews learner attendance', async ({
  page,
}, testInfo) => {
  const f = await fixture(page);
  page.on('dialog', (d) => d.accept());
  await openRegister(page);
  await page.getByLabel('Attendance for Alex Example').selectOption('PRESENT');
  await page.getByLabel('Reason for Alex Example').fill('Example reason');
  await page.getByRole('button', { name: 'Save attendance', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('0 unsaved');
  await page.getByRole('button', { name: 'Finalize register' }).click();
  await expect(page.getByLabel('Attendance for Alex Example')).toBeDisabled();
  await page.getByRole('button', { name: 'Reopen register' }).click();
  await expect(page.getByLabel('Attendance for Alex Example')).toBeEnabled();
  await page.getByRole('button', { name: 'Attendance reports', exact: true }).click();
  await expect(page.getByText('100%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View history' }).click();
  await expect(page.getByRole('cell', { name: 'Example reason', exact: true })).toBeVisible();
  expect(f.calls.filter((v) => v.op === 'state').map((v) => v.next_state)).toEqual([
    'FINAL',
    'OPEN',
  ]);
  await page.screenshot({
    path: `../../work/phase4-attendance-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('stale attendance retains input until explicit reload', async ({ page }) => {
  const f = await fixture(page);
  await openRegister(page);
  await page.getByLabel('Attendance for Alex Example').selectOption('LATE');
  await page.getByLabel('Reason for Alex Example').fill('Retain this note');
  f.staleNext();
  await page.getByRole('button', { name: 'Save attendance', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Register changed');
  await expect(page.getByLabel('Reason for Alex Example')).toHaveValue('Retain this note');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Reload attendance' }).click();
  await expect(page.getByLabel('Reason for Alex Example')).toHaveValue('');
});
test('administrator schedules lessons and archives reservations', async ({ page }, testInfo) => {
  await fixture(page);
  page.on('dialog', (d) => d.accept());
  await page.goto('http://127.0.0.1:4174/operations');
  await page.getByRole('button', { name: 'Timetable', exact: true }).click();
  await page.getByLabel('Timetable term', { exact: true }).selectOption(ids.term);
  await page.getByLabel('Timetable class', { exact: true }).selectOption(ids.class);
  await page.getByLabel('Week containing', { exact: true }).fill('2026-02-02');
  await page.getByRole('button', { name: 'New scheduled lesson' }).click();
  for (const [label, key] of [
    ['Scheduled class subject', 'subject'],
    ['Scheduled teacher', 'teacher'],
    ['Scheduled time slot', 'period'],
    ['Scheduled room (optional)', 'room'],
  ])
    await page.getByLabel(label, { exact: true }).selectOption(ids[key]);
  await page.getByRole('button', { name: 'Save scheduled lesson' }).click();
  await expect(page.getByRole('cell', { name: 'Mathematics', exact: true })).toBeVisible();
  await page.screenshot({
    path: `../../work/phase4-timetable-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Archive schedule', exact: true }).click();
  await expect(page.getByText('No schedules in this selection.')).toBeVisible();
  await page.getByLabel('Show archived schedules').check();
  await expect(page.getByRole('button', { name: 'Restore schedule' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('parents see reports and timetable without capture or resource administration', async ({
  page,
}) => {
  await fixture(page, 'PARENT');
  await page.goto('http://127.0.0.1:4174/operations');
  await expect(
    page.getByRole('heading', { name: 'Attendance reports', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take attendance', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Timetable', exact: true }).click();
  await page.getByRole('combobox', { name: 'Timetable view', exact: true }).selectOption('TEACHER');
  await page.getByLabel('Timetable teacher', { exact: true }).selectOption(ids.teacher);
  await expect(page.getByText('Selected record unavailable')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New scheduled lesson' })).toHaveCount(0);
});
test('teachers capture assigned class attendance without administrative reopening controls', async ({
  page,
}) => {
  await fixture(page, 'TEACHER');
  await openRegister(page);
  await expect(page.getByRole('button', { name: 'Void register' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark unmarked present' }).click();
  await expect(page.getByLabel('Attendance for Alex Example')).toHaveValue('PRESENT');
});
