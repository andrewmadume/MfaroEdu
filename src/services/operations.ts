import { database } from '../lib/supabase';
import { scheduleSchema, validateAttendance } from '../lib/operations';
import type {
  AttendanceRegister,
  AttendanceRow,
  AttendanceSession,
  AttendanceSummary,
  Lesson,
  Schedule,
  ScheduleInput,
} from '../types/operations';
const messages = new Set([
  'Not authorized',
  'Select an active class',
  'Attendance date must be within the class year and not in the future',
  'A register already exists for this class, date and session',
  'Register changed; reload before saving',
  'Only open registers can be edited',
  'Invalid attendance entries',
  'Learner is not enrolled on this date',
  'Complete every learner before finalizing',
  'Only administrators can reopen or void registers',
  'Select an active class subject and term in the same year',
  'Assign this teacher to the selected subject first',
  'Select an active room and time slot',
  'Archive linked schedules before changing this resource',
  'End time must be after the start time',
  'Room capacity is below class capacity',
  'Schedule changed; reload before saving',
  'No lesson dates match this weekday',
  'Use a term of ten years or less',
  'Enrollment dates must preserve captured attendance',
  'Select a valid date range of one year or less',
  'Class already has an overlapping lesson',
  'Teacher already has an overlapping lesson',
  'Room already has an overlapping lesson',
  'Reopen affected registers before changing enrollment',
  'Invalid schedule',
]);
export function operationsError(e: { code?: string; message?: string } | null): Error {
  if (e?.code === '23P01') {
    const kind = e.message?.includes('teacher_busy')
      ? 'teacher'
      : e.message?.includes('room_busy')
        ? 'room'
        : 'class';
    return new Error(
      `This ${kind} already has a lesson at an overlapping time. Choose another time or resource.`,
    );
  }
  if (e?.code === '23505')
    return new Error(
      'A record with these details already exists. Reopen the existing register or choose another name.',
    );
  return new Error(
    e?.message && messages.has(e.message)
      ? `${e.message}.`
      : 'The request was not completed. Your access or the record may have changed. Reload and try again.',
  );
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const write = ['open', 'save', 'state', 'schedule'].includes(name);
  const { data, error } = await database().rpc(write ? 'operations_write' : 'operations_read', {
    tenant: args.tenant,
    request: {
      op: name,
      ...Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'tenant')),
    },
  });
  if (error) throw operationsError(error);
  return data as T;
}
export function attendanceSessions(
  tenant: string,
  classId: string,
  from: string,
  to: string,
  page: number,
) {
  return rpc<{ rows: AttendanceSession[]; count: number }>('sessions', {
    tenant,
    class_key: classId,
    from_date: from,
    to_date: to,
    page_number: page,
  });
}
export function createRegister(tenant: string, classId: string, date: string, name: string) {
  return rpc<string>('open', {
    tenant,
    class_key: classId,
    attendance_date: date,
    session_name: name.trim(),
  });
}
export function loadRegister(tenant: string, id: string) {
  return rpc<AttendanceRegister>('register', { tenant, session_key: id });
}
export function saveAttendance(tenant: string, session: AttendanceSession, rows: AttendanceRow[]) {
  validateAttendance(rows);
  return rpc<void>('save', {
    tenant,
    session_key: session.id,
    expected_version: session.version,
    entries: rows,
  });
}
export function setRegisterState(
  tenant: string,
  session: AttendanceSession,
  state: 'OPEN' | 'FINAL' | 'VOID',
) {
  return rpc<void>('state', {
    tenant,
    session_key: session.id,
    expected_version: session.version,
    next_state: state,
  });
}
export function attendanceSummary(
  tenant: string,
  from: string,
  to: string,
  classId: string | null,
  studentId: string | null,
  page: number,
) {
  return rpc<{ rows: AttendanceSummary[]; count: number }>('report', {
    tenant,
    from_date: from,
    to_date: to,
    class_key: classId,
    learner: studentId,
    page_number: page,
  });
}
export function attendanceHistory(
  tenant: string,
  from: string,
  to: string,
  studentId: string,
  page: number,
) {
  return rpc<{
    rows: {
      attended_on: string;
      class_name: string;
      session_name: string;
      status: string;
      reason: string;
    }[];
    count: number;
  }>('history', { tenant, from_date: from, to_date: to, learner: studentId, page_number: page });
}
export function schedules(
  tenant: string,
  term: string,
  classId: string | null,
  page: number,
  active = true,
) {
  return rpc<{ rows: Schedule[]; count: number }>('schedules', {
    tenant,
    term_key: term,
    class_key: classId,
    page_number: page,
    only_active: active,
  });
}
export async function saveSchedule(tenant: string, input: ScheduleInput, existing?: Schedule) {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return rpc<string>('schedule', {
    tenant,
    booking_key: existing?.id ?? null,
    expected_version: existing?.version ?? 0,
    values: parsed.data,
  });
}
export function scheduleWeek(
  tenant: string,
  term: string,
  week: string,
  kind: 'CLASS' | 'TEACHER' | 'ROOM',
  resource: string,
) {
  return rpc<Lesson[]>('week', {
    tenant,
    term_key: term,
    on_date: week,
    view_kind: kind,
    resource_key: resource,
  });
}

export function attendanceDashboard(tenant: string, date: string) {
  return rpc<import('../types/operations').AttendanceSnapshot>('dashboard', {
    tenant,
    from_date: date,
    to_date: date,
  });
}
