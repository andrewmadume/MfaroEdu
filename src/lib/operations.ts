import {z} from 'zod';
import type {AttendanceRow,AttendanceSummary} from '../types/operations';
export const weekdayNames=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export const attendanceLabels={PRESENT:'Present',ABSENT:'Absent',LATE:'Late',EXCUSED:'Excused',UNMARKED:'Not marked'};
export const scheduleSchema=z.object({class_subject_id:z.uuid(),staff_id:z.uuid(),term_id:z.uuid(),room_id:z.uuid().nullable(),time_slot_id:z.uuid(),weekday:z.number().int().min(1).max(7),active:z.boolean()});
export function schoolToday(timeZone:string){return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function mondayOf(date:string){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
export function addDays(date:string,days:number){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function monthBounds(date:string){const d=new Date(`${date}T12:00:00Z`);const first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1));const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0));return {from:first.toISOString().slice(0,10),to:last.toISOString().slice(0,10)};}
export function validateAttendance(rows:AttendanceRow[]){for(const r of rows){if(!r.status||!Object.hasOwn(attendanceLabels,r.status)||r.reason.length>1000)throw new Error('Select an attendance status and keep reasons within 1,000 characters.');}}
export function attendanceTotals(rows:AttendanceSummary[]){const sum=rows.reduce((a,r)=>({present:a.present+Number(r.present),absent:a.absent+Number(r.absent),late:a.late+Number(r.late),excused:a.excused+Number(r.excused),total:a.total+Number(r.total)}),{present:0,absent:0,late:0,excused:0,total:0});return {...sum,percentage:sum.total?Math.round((sum.present+sum.late)/sum.total*10000)/100:null};}
