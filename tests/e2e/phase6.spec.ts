import { test, expect, type Page } from '@playwright/test';
const tenant = '10000000-0000-4000-8000-000000000001',
  uid = '20000000-0000-4000-8000-000000000001',
  id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture(page: Page, role = 'SCHOOL_ADMIN') {
  const staff = ['SCHOOL_ADMIN', 'PRINCIPAL', 'LIBRARIAN'].includes(role),
    commAdmin = ['SCHOOL_ADMIN', 'PRINCIPAL'].includes(role),
    teacher = role === 'TEACHER';
  let version = 0,
    enabled = true,
    announcements: any[] = [],
    files: any[] = [],
    messages: any[] = [],
    notices: any[] = [],
    books: any[] = [],
    copies: any[] = [],
    loans: any[] = [],
    loanVersion = 0,
    fail = false;
  const calls: any[] = [];
  const today = new Date().toISOString().slice(0, 10),
    bookDoc = () => ({
      title: books[0]?.title ?? 'Reading Together',
      author: 'School author',
      accession_number: 'LIB-001',
      learner: 'Alex Learner',
      admission_number: 'S001',
    });
  const settings = () => ({
    settings: { id: id(1), version, family_messages_enabled: enabled },
    classes: [{ id: id(2), name: '7A · 2026' }],
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
      name = url.pathname.split('/').pop();
    let body: any = [],
      status = 200;
    if (url.pathname.includes('/storage/v1/')) {
      if (req.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Read me' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ Key: url.pathname }),
      });
      return;
    }
    const input = req.method() === 'POST' ? req.postDataJSON() : {},
      r = input.request ?? {};
    if (name === 'profiles') body = { id: uid, display_name: 'Community Example', active: true };
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
      body = [
        'dashboard.view',
        'school.view',
        'communication.view',
        'library.view',
        ...(commAdmin
          ? ['communication.manage', 'communication.post']
          : teacher
            ? ['communication.post']
            : []),
        ...(staff ? ['library.manage', 'library.view_all', 'library.reports'] : []),
      ];
    else if (name === 'communication_read') {
      if (r.op === 'settings') body = settings();
      else if (r.op === 'announcements') {
        const rows = announcements.filter((a) => r.folder === 'manage' || a.status === 'PUBLISHED');
        body = { rows, count: rows.length };
      } else if (r.op === 'announcement')
        body = {
          ...announcements.find((a) => a.id === r.id),
          can_edit: commAdmin || teacher,
          files,
        };
      else if (r.op === 'notifications') {
        const rows = notices.filter((n) => !r.unread_only || !n.read_at);
        body = { rows, count: rows.length, unread: notices.filter((n) => !n.read_at).length };
      } else if (r.op === 'recipients')
        body = {
          rows: enabled ? [{ id: id(10), name: 'Assigned Teacher', roles: 'TEACHER' }] : [],
          count: enabled ? 1 : 0,
        };
      else if (r.op === 'threads')
        body = {
          rows: messages.length
            ? [
                {
                  id: id(11),
                  recipient_id: id(10),
                  recipient_name: 'Assigned Teacher',
                  preview: messages.at(-1).body,
                  last_message_at: new Date().toISOString(),
                },
              ]
            : [],
          count: messages.length ? 1 : 0,
        };
      else if (r.op === 'thread')
        body = {
          rows: messages,
          count: messages.length,
          recipient_id: id(10),
          recipient_name: 'Assigned Teacher',
          can_reply: enabled,
        };
    } else if (name === 'communication_write') {
      calls.push(r);
      if (fail) {
        status = 400;
        body = { message: 'Record changed; reload before saving', code: 'P0001' };
      } else if (r.op === 'settings') {
        enabled = r.family_messages_enabled;
        version++;
        body = { id: id(1) };
      } else if (r.op === 'draft') {
        if (r.id) {
          const a = announcements.find((a) => a.id === r.id);
          Object.assign(a, r, { version: a.version + 1 });
          body = { id: a.id };
        } else {
          const a = {
            ...r,
            id: id(3),
            author_id: uid,
            author_name: 'Community Example',
            status: 'DRAFT',
            version: 1,
            created_at: new Date().toISOString(),
            published_at: null,
          };
          announcements.push(a);
          body = { id: a.id };
        }
      } else if (['publish', 'withdraw'].includes(r.op)) {
        const a = announcements.find((a) => a.id === r.id);
        a.status = r.op === 'publish' ? 'PUBLISHED' : 'WITHDRAWN';
        a.version++;
        a.published_at = new Date().toISOString();
        if (r.op === 'publish')
          notices.push({
            id: id(4),
            kind: 'ANNOUNCEMENT',
            title: a.title,
            target_id: a.id,
            read_at: null,
            created_at: new Date().toISOString(),
          });
        else notices = [];
        body = { id: a.id };
      } else if (r.op === 'reserve_file') {
        files.push({
          id: r.request_key,
          announcement_id: r.id,
          filename: r.filename,
          mime_type: r.mime_type,
          byte_size: r.byte_size,
          ready: false,
          version: 1,
        });
        announcements[0].version++;
        body = { id: r.request_key };
      } else if (r.op === 'finish_file') {
        files[0].ready = true;
        announcements[0].version++;
        body = { id: files[0].id };
      } else if (r.op === 'message') {
        messages.push({
          id: id(20 + messages.length),
          sender_id: uid,
          sender_name: 'Community Example',
          body: r.body,
          created_at: new Date().toISOString(),
        });
        body = { id: id(11) };
      } else if (r.op === 'read_notification') {
        notices.find((n) => n.id === r.id).read_at = new Date().toISOString();
        body = { id: r.id };
      }
    } else if (name === 'library_read') {
      if (r.op === 'settings')
        body = { version: loanVersion, loan_days: 14, max_books: 3, max_renewals: 2 };
      else if (r.op === 'books')
        body = {
          rows: books.map((b) => ({
            ...b,
            copies: copies.length,
            available: copies.filter((c) => c.status === 'READY' && !c.on_loan).length,
          })),
          count: books.length,
        };
      else if (r.op === 'copies') body = { rows: copies, count: copies.length };
      else if (r.op === 'learners')
        body = { rows: [{ id: id(30), name: 'Alex Learner', admission_number: 'S001' }], count: 1 };
      else if (r.op === 'loans') {
        const rows = loans.filter((l) =>
          r.filter === 'OPEN'
            ? !l.closed_on
            : r.filter === 'CLOSED'
              ? !!l.closed_on
              : r.filter === 'OVERDUE'
                ? l.overdue
                : true,
        );
        body = { rows, count: rows.length };
      } else if (r.op === 'loan') body = loans.find((l) => l.id === r.id);
      else if (r.op === 'report')
        body = {
          as_at: today,
          titles: books.length,
          copies: copies.length,
          available: copies.filter((c) => c.status === 'READY' && !c.on_loan).length,
          on_loan: loans.filter((l) => !l.closed_on).length,
          overdue: 0,
          lost: copies.filter((c) => c.status === 'LOST').length,
          damaged: copies.filter((c) => c.status === 'DAMAGED').length,
        };
    } else if (name === 'library_write') {
      calls.push(r);
      if (fail) {
        status = 400;
        body = { message: 'Record changed; reload before saving', code: 'P0001' };
      } else if (r.op === 'book') {
        const b = { ...r, id: id(31), archived: false, version: 1 };
        books.push(b);
        body = { id: b.id };
      } else if (r.op === 'copy') {
        const c = { ...r, id: id(32), version: 1, on_loan: false };
        copies.push(c);
        body = { id: c.id };
      } else if (r.op === 'issue') {
        const l = {
          id: id(33),
          copy_id: r.copy_id,
          student_id: r.student_id,
          issued_on: r.issued_on,
          due_on: r.due_on,
          closed_on: null,
          close_kind: null,
          renewals: 0,
          version: 1,
          overdue: false,
          document: bookDoc(),
          events: [
            { id: id(34), kind: 'ISSUED', happened_on: r.issued_on, details: { due_on: r.due_on } },
          ],
        };
        loans.push(l);
        copies[0].on_loan = true;
        copies[0].version++;
        body = { id: l.id };
      } else if (r.op === 'renew') {
        const l = loans[0];
        l.due_on = r.due_on;
        l.renewals++;
        l.version++;
        l.events.push({
          id: id(35),
          kind: 'RENEWED',
          happened_on: today,
          details: { due_on: r.due_on },
        });
        body = { id: l.id };
      } else if (r.op === 'return' || r.op === 'lost') {
        const l = loans[0];
        l.closed_on = r.closed_on;
        l.close_kind = r.op === 'lost' ? 'LOST' : 'RETURNED';
        l.version++;
        l.events.push({
          id: id(36),
          kind: l.close_kind,
          happened_on: r.closed_on,
          details: { note: r.note, condition: r.condition },
        });
        copies[0].on_loan = false;
        copies[0].status =
          r.op === 'lost' ? 'LOST' : r.condition === 'DAMAGED' ? 'DAMAGED' : 'READY';
        body = { id: l.id };
      } else if (r.op === 'settings') {
        loanVersion++;
        body = { id: id(39) };
      }
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
  return {
    calls,
    setFail: (value: boolean) => (fail = value),
    seed: () => {
      announcements = [
        {
          id: id(3),
          title: 'Reading day',
          body: 'Bring a book to class.',
          scope: 'CLASS',
          class_id: id(2),
          status: 'PUBLISHED',
          version: 1,
          author_id: id(10),
          author_name: 'Assigned Teacher',
          created_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
        },
      ];
      notices = [
        {
          id: id(4),
          kind: 'ANNOUNCEMENT',
          title: 'Reading day',
          target_id: id(3),
          read_at: null,
          created_at: new Date().toISOString(),
        },
      ];
      books = [
        {
          id: id(31),
          title: 'Reading Together',
          author: 'School author',
          category: 'Reading',
          isbn: null,
          publisher: null,
          archived: false,
          version: 1,
        },
      ];
      copies = [
        {
          id: id(32),
          book_id: id(31),
          accession_number: 'LIB-001',
          location: 'Shelf A',
          condition: 'GOOD',
          status: 'READY',
          version: 2,
          on_loan: true,
        },
      ];
      loans = [
        {
          id: id(33),
          copy_id: id(32),
          student_id: id(30),
          issued_on: today,
          due_on: today,
          closed_on: null,
          close_kind: null,
          renewals: 0,
          version: 1,
          overdue: false,
          document: bookDoc(),
          events: [{ id: id(34), kind: 'ISSUED', happened_on: today, details: { due_on: today } }],
        },
      ];
    },
  };
}
test('administrator drafts, attaches, publishes, reads notifications and withdraws', async ({
  page,
}, info) => {
  const f = await fixture(page);
  await page.goto('http://127.0.0.1:4174/communication');
  await page.getByRole('button', { name: 'New announcement', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Reading day');
  await dialog.getByLabel('Announcement text').fill('Bring your favourite book.');
  await dialog.getByRole('combobox', { name: 'Audience', exact: true }).selectOption('CLASS');
  await dialog.getByRole('combobox', { name: 'Class', exact: true }).selectOption(id(2));
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Reading day', exact: true }).last(),
  ).toBeVisible();
  await page
    .getByLabel('Add an attachment', { exact: false })
    .setInputFiles({ name: 'reading.txt', mimeType: 'text/plain', buffer: Buffer.from('Read me') });
  await expect(page.getByRole('button', { name: 'Download reading.txt' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish announcement', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish announcement', exact: true })).toHaveCount(
    0,
  );
  expect(f.calls.some((r) => r.op === 'publish')).toBe(true);
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByText('1 unread notifications')).toBeVisible();
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(page.getByText('0 unread notifications')).toBeVisible();
  await page.getByRole('button', { name: 'Open notification', exact: true }).click();
  await page.getByRole('button', { name: 'Withdraw announcement', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Withdraw announcement', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('heading', { level: 1 }).click();
  await page.screenshot({
    path: `../../work/phase6-communication-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('parent reads announcements and sends only an eligible in-app conversation', async ({
  page,
}) => {
  const f = await fixture(page, 'PARENT');
  f.seed();
  await page.goto('http://127.0.0.1:4174/communication');
  await expect(page.getByRole('button', { name: 'New announcement', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open announcement', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish announcement', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await page.getByRole('button', { name: 'New message', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Assigned Teacher/ }).click();
  await dialog.getByLabel('Message', { exact: true }).fill('How is the reading project going?');
  await dialog.getByRole('button', { name: 'Send in-app message', exact: true }).click();
  await expect(page.getByText('How is the reading project going?').last()).toBeVisible();
  await page.getByLabel('Reply', { exact: true }).fill('Thank you.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.getByText('Thank you.').last()).toBeVisible();
  expect(f.calls.filter((r) => r.op === 'message')).toHaveLength(2);
});
test('teacher announcement form is limited to assigned class audiences', async ({ page }) => {
  const f = await fixture(page, 'TEACHER');
  await page.goto('http://127.0.0.1:4174/communication');
  await page.getByRole('button', { name: 'New announcement', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('combobox', { name: 'Audience', exact: true }).locator('option'),
  ).toHaveCount(1);
  await dialog.getByLabel('Title', { exact: true }).fill('Class reading');
  await dialog.getByLabel('Announcement text').fill('Please bring your reading record.');
  await dialog.getByRole('combobox', { name: 'Class', exact: true }).selectOption(id(2));
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect(f.calls.at(-1).scope).toBe('CLASS');
  expect(f.calls.at(-1).class_id).toBe(id(2));
});
test('librarian registers book/copy, issues, renews and records a damaged return', async ({
  page,
}, info) => {
  const f = await fixture(page, 'LIBRARIAN');
  await page.goto('http://127.0.0.1:4174/library');
  await page.getByRole('button', { name: 'Add book', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Book title').fill('Reading Together');
  await dialog.getByLabel('Author', { exact: true }).fill('School author');
  await dialog.getByLabel('Category', { exact: true }).fill('Reading');
  await dialog.getByRole('button', { name: 'Save book', exact: true }).click();
  await page.getByRole('button', { name: 'View copies', exact: true }).click();
  await page.getByRole('button', { name: 'Add copy', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Accession number').fill('LIB-001');
  await dialog.getByLabel('Shelf / location').fill('Shelf A');
  await dialog.getByRole('button', { name: 'Save copy', exact: true }).click();
  await page.getByRole('button', { name: 'Issue copy', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Alex Learner/ }).click();
  await dialog.getByRole('button', { name: 'Confirm issue', exact: true }).click();
  await page.getByRole('button', { name: 'Open loan', exact: true }).click();
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('renew');
  await page.getByRole('button', { name: 'Confirm renewal', exact: true }).click();
  await expect(page.getByText('Renewed 1 time(s)', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('return');
  await page
    .getByRole('combobox', { name: 'Returned condition', exact: true })
    .selectOption('DAMAGED');
  await page.getByLabel('Activity note').fill('Torn cover');
  await page.getByRole('button', { name: 'Confirm return', exact: true }).click();
  await expect(page.getByText('Torn cover', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm return', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Library reports', exact: true }).click();
  await expect(page.getByText('Damaged copies', { exact: true })).toBeVisible();
  expect(
    f.calls.filter((r) => ['issue', 'renew', 'return'].includes(r.op)).map((r) => r.op),
  ).toEqual(['issue', 'renew', 'return']);
  await page.screenshot({
    path: `../../work/phase6-library-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('parent catalogue and borrowing history have no circulation controls', async ({ page }) => {
  const f = await fixture(page, 'PARENT');
  f.seed();
  await page.goto('http://127.0.0.1:4174/library');
  await expect(page.getByRole('button', { name: 'Add book', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View copies', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Issue copy', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Borrowing history', exact: true }).click();
  await page.getByRole('button', { name: 'Open loan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reading Together', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Action', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Library reports', exact: true })).toHaveCount(0);
});
test('stale library return keeps the entered note for review', async ({ page }) => {
  const f = await fixture(page, 'LIBRARIAN');
  f.seed();
  f.setFail(true);
  await page.goto('http://127.0.0.1:4174/library');
  await page.getByRole('button', { name: 'Borrowing history', exact: true }).click();
  await page.getByRole('button', { name: 'Open loan', exact: true }).click();
  await page.getByLabel('Activity note').fill('Keep this return note');
  await page.getByRole('button', { name: 'Confirm return', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Record changed');
  await expect(page.getByLabel('Activity note')).toHaveValue('Keep this return note');
  expect(f.calls).toHaveLength(1);
});
