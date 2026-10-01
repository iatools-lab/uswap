import { durationHours, nextId, requireRole, requireUser, stationNameOf } from "../shared";
import { isoFromMs } from "../seed";
import { MockHttpError, type MockRoute } from "../types";

const text=(value:unknown)=>typeof value==="string"?value.trim():"";

export const reportRoutes:MockRoute[]=[
  {method:"GET",pattern:/^\/reports\/dashboard$/,handler:({db,user,query,now})=>{
    const actor=requireRole(requireUser(db,user),["SUPERVISOR","STATION_CHIEF"]);
    const from=Date.parse(query.get("from")||isoFromMs(now-30*86400000));
    const to=Date.parse(query.get("to")||isoFromMs(now+86400000));
    const requestedStation=text(query.get("stationId"));
    const stationId=actor.role==="STATION_CHIEF"?actor.stationId:requestedStation||null;
    const occurrences=db.occurrences.filter(item=>Date.parse(item.startTime)>=from&&Date.parse(item.startTime)<=to).filter(item=>stationId?item.stationId===stationId:true);
    const attendance=occurrences.map(item=>({occurrence:item,record:db.attendance.find(row=>row.shiftId===item.id)}));
    const status={present:0,late:0,absent:0,closed:0,expected:0,justified:0};
    for(const row of attendance){const value=row.record?.status??(db.absences.some(a=>a.shiftId===row.occurrence.id)?"ABSENT":"EXPECTED");if(value==="PRESENT")status.present++;else if(value==="LATE")status.late++;else if(value==="ABSENT")status.absent++;else if(value==="CLOSED")status.closed++;else if(value==="JUSTIFIED")status.justified++;else status.expected++;}
    const assigned=occurrences.filter(item=>item.swapperId).length;
    const hoursBySwapper=new Map<string,{name:string;station:string;hours:number}>();
    for(const item of occurrences.filter(row=>row.swapperId)){const person=db.users.find(u=>u.id===item.swapperId);if(!person)continue;const current=hoursBySwapper.get(person.id)??{name:person.fullName,station:stationNameOf(db,item.stationId)??"—",hours:0};current.hours=Math.round((current.hours+durationHours(db,item))*10)/10;hoursBySwapper.set(person.id,current)}
    const changes=db.changes.filter(item=>Date.parse(item.createdAt)>=from&&Date.parse(item.createdAt)<=to).filter(item=>stationId?item.stationId===stationId:true);
    const leaves=db.leaves.filter(item=>Date.parse(item.startTime)<=to&&Date.parse(item.endTime)>=from&&item.status==="APPROVED");
    const stationRows=db.stations.filter(station=>station.isActive&&(stationId?station.id===stationId:true)).map(station=>{const rows=occurrences.filter(item=>item.stationId===station.id);const filled=rows.filter(item=>item.swapperId).length;return{id:station.id,name:station.name,total:rows.length,filled,coverage:rows.length?Math.round(filled/rows.length*100):0,incidents:db.incidents.filter(item=>item.stationId===station.id&&!["RESOLVED","CLOSED"].includes(item.status)).length}});
    return {period:{from:new Date(from).toISOString(),to:new Date(to).toISOString()},filters:{stationId},stations:db.stations.filter(item=>item.isActive).map(item=>({id:item.id,name:item.name})),kpis:{shifts:occurrences.length,coverageRate:occurrences.length?Math.round(assigned/occurrences.length*100):0,attendanceRate:assigned?Math.round((status.present+status.closed+status.late)/assigned*100):0,absences:status.absent,late:status.late,approvedLeaves:leaves.length,movements:changes.length,totalHours:Array.from(hoursBySwapper.values()).reduce((s,r)=>s+r.hours,0)},attendance:status,stationRows,hours:Array.from(hoursBySwapper.values()).sort((a,b)=>b.hours-a.hours).slice(0,8),changes:changes.map(item=>({date:item.createdAt,station:item.station,type:item.type,from:item.outSwapper,to:item.inSwapper}))};
  }},
  {method:"GET",pattern:/^\/admin\/reports\/schedules$/,handler:({db,user})=>{requireRole(requireUser(db,user),["ADMIN"]);return db.scheduledReports.slice().sort((a,b)=>Date.parse(a.nextRunAt)-Date.parse(b.nextRunAt));}},
  {method:"POST",pattern:/^\/admin\/reports\/schedules$/,handler:({db,user,body,now})=>{const actor=requireRole(requireUser(db,user),["ADMIN"]);const name=text(body.name);const recipients=Array.isArray(body.recipients)?body.recipients.map(text).filter(v=>v.includes("@")):[];if(name.length<4||!recipients.length)throw new MockHttpError(400,"Indiquez un nom et au moins un destinataire valide.");const frequency=(["DAILY","WEEKLY","MONTHLY"].includes(text(body.frequency))?text(body.frequency):"WEEKLY") as "DAILY"|"WEEKLY"|"MONTHLY";const delay=frequency==="DAILY"?86400000:frequency==="WEEKLY"?7*86400000:30*86400000;const created={id:nextId("report"),ownerId:actor.id,name,frequency,format:text(body.format)==="CSV"?"CSV" as const:"XLSX" as const,scope:"NETWORK" as const,stationId:null,recipients,sections:["ATTENDANCE","COVERAGE","HOURS","MOVEMENTS"],isActive:true,nextRunAt:isoFromMs(now+delay),lastRunAt:null,createdAt:isoFromMs(now)};db.scheduledReports.push(created);return created;}},
  {method:"PATCH",pattern:/^\/admin\/reports\/schedules\/([^/]+)$/,handler:({db,user,params,body})=>{requireRole(requireUser(db,user),["ADMIN"]);const report=db.scheduledReports.find(item=>item.id===params[0]);if(!report)throw new MockHttpError(404,"Rapport programmé introuvable.");report.isActive=body.isActive===true;return report;}},
];
