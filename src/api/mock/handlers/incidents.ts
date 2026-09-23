import { nextId, notifyStaff, requireRole, requireUser, stationNameOf } from "../shared";
import { isoFromMs } from "../seed";
import { MockHttpError, type IncidentSeverity, type IncidentStatus, type MockIncident, type MockRoute } from "../types";

function serialize(db: Parameters<MockRoute["handler"]>[0]["db"], incident: MockIncident) {
  const reporter = db.users.find((item) => item.id === incident.reporterId);
  const assignee = db.users.find((item) => item.id === incident.assigneeId);
  return { ...incident, stationName: stationNameOf(db, incident.stationId) ?? "Station inconnue", reporterName: reporter?.fullName ?? "Compte inconnu", assigneeName: assignee?.fullName ?? null };
}

const allowedTransitions: Record<IncidentStatus, IncidentStatus[]> = {
  REPORTED: ["TO_REVIEW", "ACKNOWLEDGED"], TO_REVIEW: ["ACKNOWLEDGED"],
  ACKNOWLEDGED: ["IN_PROGRESS"], IN_PROGRESS: ["RESOLVED"], RESOLVED: ["CLOSED", "IN_PROGRESS"], CLOSED: [],
};

export const incidentRoutes: MockRoute[] = [
  {
    method: "GET", pattern: /^\/incidents$/,
    handler: ({ db, user, query }) => {
      const actor = requireRole(requireUser(db, user), ["SUPERVISOR", "STATION_CHIEF"]);
      const stationId = actor.role === "STATION_CHIEF" ? actor.stationId : query.get("stationId");
      const rows = db.incidents.filter((item) => stationId ? item.stationId === stationId : true).sort((a,b) => Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
      const resolved = rows.filter((item) => item.resolvedAt);
      const meanHours = resolved.length ? Math.round(resolved.reduce((sum,item) => sum + (Date.parse(item.resolvedAt!)-Date.parse(item.createdAt))/3600000,0)/resolved.length*10)/10 : 0;
      return { incidents: rows.map((item) => serialize(db,item)), metrics: { total: rows.length, open: rows.filter((item) => !["RESOLVED","CLOSED"].includes(item.status)).length, critical: rows.filter((item) => item.severity === "CRITICAL" && item.status !== "CLOSED").length, meanResolutionHours: meanHours }, stations: actor.role === "SUPERVISOR" ? db.stations.filter((item) => item.isActive).map((item) => ({id:item.id,name:item.name})) : [] };
    },
  },
  {
    method: "POST", pattern: /^\/incidents$/,
    handler: ({ db, user, body, now }) => {
      const actor = requireRole(requireUser(db, user), ["SUPERVISOR", "STATION_CHIEF"]);
      const stationId = actor.role === "STATION_CHIEF" ? actor.stationId : String(body.stationId ?? "");
      if (!stationId || !db.stations.some((item) => item.id === stationId)) throw new MockHttpError(400,"Sélectionnez une station valide.");
      const title = String(body.title ?? "").trim(); const description = String(body.description ?? "").trim();
      if (title.length < 5 || description.length < 12) throw new MockHttpError(400,"Décrivez précisément l’incident et son impact.");
      const severity = String(body.severity ?? "MEDIUM") as IncidentSeverity;
      const category = String(body.category ?? "OTHER") as MockIncident["category"];
      const incident: MockIncident = { id: nextId("incident"), stationId, reporterId: actor.id, assigneeId: null, category, severity, status:"REPORTED", title, description, attachmentIds:[], occurredAt:String(body.occurredAt || isoFromMs(now)), createdAt:isoFromMs(now), updatedAt:isoFromMs(now), resolvedAt:null, closedAt:null, resolution:null, actions:[] };
      incident.actions.push({id:nextId("incident-action"),incidentId:incident.id,authorId:actor.id,type:"CREATED",fromStatus:null,toStatus:"REPORTED",comment:"Incident déclaré.",createdAt:isoFromMs(now)});
      db.incidents.unshift(incident);
      notifyStaff(db, stationId, "INCIDENT", `Nouvel incident · ${incident.severity}`, `${title} à ${stationNameOf(db,stationId)}.`, [actor.id]);
      return serialize(db,incident);
    },
  },
  {
    method:"PATCH", pattern:/^\/incidents\/([^/]+)$/,
    handler:({db,user,body,params,now})=>{
      const actor=requireRole(requireUser(db,user),["SUPERVISOR"]);
      const incident=db.incidents.find((item)=>item.id===params[0]); if(!incident) throw new MockHttpError(404,"Incident introuvable.");
      const nextStatus=String(body.status ?? incident.status) as IncidentStatus;
      if(nextStatus!==incident.status && !allowedTransitions[incident.status].includes(nextStatus)) throw new MockHttpError(409,"Cette transition de statut n’est pas autorisée.");
      const comment=String(body.comment ?? "").trim();
      if(["RESOLVED","CLOSED"].includes(nextStatus) && comment.length<10) throw new MockHttpError(400,"Documentez la résolution en au moins 10 caractères.");
      const before=incident.status; incident.status=nextStatus; incident.updatedAt=isoFromMs(now);
      if(body.severity) incident.severity=body.severity as IncidentSeverity;
      if(body.assigneeId !== undefined) incident.assigneeId=String(body.assigneeId)||null;
      if(nextStatus==="RESOLVED"){incident.resolvedAt=isoFromMs(now);incident.resolution=comment;}
      if(nextStatus==="CLOSED") incident.closedAt=isoFromMs(now);
      incident.actions.unshift({id:nextId("incident-action"),incidentId:incident.id,authorId:actor.id,type:nextStatus==="CLOSED"?"CLOSED":nextStatus==="RESOLVED"?"RESOLVED":before===nextStatus?"COMMENT":"QUALIFIED",fromStatus:before,toStatus:nextStatus,comment:comment||"Statut mis à jour.",createdAt:isoFromMs(now)});
      notifyStaff(db,incident.stationId,"INCIDENT",`Incident ${nextStatus.toLowerCase()}`,`${incident.title} · ${comment||"Suivi mis à jour"}`,[incident.reporterId]);
      return serialize(db,incident);
    }
  }
];
