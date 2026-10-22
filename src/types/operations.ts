export type AttendanceStatus='PRESENT'|'ABSENT'|'LATE'|'EXCUSED'|'UNMARKED';
export interface AttendanceSession {id:string;school_id:string;class_id:string;attended_on:string;name:string;status:'OPEN'|'FINAL'|'VOID';version:number}
export interface AttendanceRow {id:string;name:string;admission_number:string;status:AttendanceStatus|null;reason:string;version:number}
export interface AttendanceRegister {session:AttendanceSession;learners:AttendanceRow[]}
export interface AttendanceSummary {student_id:string;name:string;admission_number:string;present:number;absent:number;late:number;excused:number;total:number;percentage:number|null}
export interface ScheduleInput {class_subject_id:string;staff_id:string;term_id:string;room_id:string|null;time_slot_id:string;weekday:number;active:boolean}
export interface Schedule extends ScheduleInput {id:string;school_id:string;class_id:string;version:number;class_name:string;subject_name:string;teacher_name:string;room_name:string|null;period_name:string;starts_at:string;ends_at:string}
export interface Lesson extends Schedule {lesson_on:string}
export interface AttendanceSnapshot {total:number;present:number;absent:number;late:number;excused:number;percentage:number|null}
