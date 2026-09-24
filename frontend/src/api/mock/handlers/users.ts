import * as XLSX from "xlsx";
import {
  nextId,
  requireRole,
  requireUser,
  serializeDetail,
  serializeMember,
  serializeUser,
} from "../shared";
import { MockHttpError, type MockRoute, type MockUser } from "../types";

const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_ALIASES: Record<string, MockUser["role"]> = {
  admin: "ADMIN",
  administrateur: "ADMIN",
  superviseur: "SUPERVISOR",
  supervisor: "SUPERVISOR",
  "chef de station": "STATION_CHIEF",
  chef: "STATION_CHIEF",
  station_chief: "STATION_CHIEF",
  swappeur: "SWAPPER",
  swapper: "SWAPPER",
};

const memberStatusOf = (user: MockUser) =>
  user.disabledAt ? "inactive" : user.isActive ? "active" : "pending";

function filteredMembers(db: MockUser[], query: URLSearchParams) {
  const search = asText(query.get("q")).toLowerCase();
  const role = asText(query.get("role")).toUpperCase();
  const status = asText(query.get("status")).toLowerCase();
  const stationId = asText(query.get("stationId"));
  return db.filter((user) => {
    if (search && !`${user.fullName} ${user.email}`.toLowerCase().includes(search))
      return false;
    if (role && user.role !== role) return false;
    if (status && memberStatusOf(user) !== status) return false;
    if (stationId && user.stationId !== stationId) return false;
    return true;
  });
}

type ImportRow = {
  line: number;
  fullName: string;
  email: string;
  role: string;
  status: "READY" | "IGNORED" | "REJECTED" | "CREATED";
  reason: string;
};

export const userRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: /^\/users$/,
    handler: (ctx) => {
      requireUser(ctx.db, ctx.user);
      const role = asText(ctx.query.get("role")).toUpperCase();
      return ctx.db.users
        .filter((item) => (role ? item.role === role : true))
        .map((item) => ({ ...serializeUser(ctx.db, item), isActive: item.isActive }));
    },
  },
  {
    method: "GET",
    pattern: /^\/users\/page$/,
    handler: (ctx) => {
      requireUser(ctx.db, ctx.user);
      const sort = asText(ctx.query.get("sort")) || "recent";
      const sorted = [...filteredMembers(ctx.db.users, ctx.query)].sort((a, b) => {
        if (sort === "name") return a.fullName.localeCompare(b.fullName, "fr");
        if (sort === "role") return a.role.localeCompare(b.role);
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      });
      const limit = Math.max(1, Number(ctx.query.get("limit")) || 8);
      const total = sorted.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const page = Math.min(Math.max(1, Number(ctx.query.get("page")) || 1), totalPages);
      const counts = { all: 0, active: 0, pending: 0, inactive: 0 };
      for (const user of ctx.db.users) counts[memberStatusOf(user)] += 1;
      return {
        data: sorted
          .slice((page - 1) * limit, page * limit)
          .map((item) => serializeMember(ctx.db, item)),
        total,
        page,
        totalPages,
        statusCounts: counts,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/users\/export$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN", "SUPERVISOR"]);
      const rows = filteredMembers(ctx.db.users, ctx.query);
      const header = ["Nom complet", "E-mail", "Rôle", "Station", "Statut", "Téléphone"];
      const lines = rows.map((user) =>
        [
          user.fullName,
          user.email,
          user.role,
          ctx.db.stations.find((item) => item.id === user.stationId)?.name ?? "",
          memberStatusOf(user),
          user.phoneNumber ?? "",
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(";"),
      );
      return {
        csv: [header.join(";"), ...lines].join("\r\n"),
        filename: "utilisateurs-uswap.csv",
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/users\/imports\/preview$/,
    handler: async (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN"]);
      if (!ctx.file) throw new MockHttpError(400, "Choisissez un fichier CSV ou XLSX.");
      if (ctx.file.size > 2 * 1024 * 1024)
        throw new MockHttpError(413, "Le fichier dépasse la limite de 2 Mo.");
      const buffer = await ctx.file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new MockHttpError(400, "Le fichier ne contient aucune feuille.");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const seen = new Set<string>();
      const rows: ImportRow[] = raw.map((entry, index) => {
        const pick = (...keys: string[]) => {
          for (const key of keys) {
            const found = Object.keys(entry).find(
              (header) => header.toLowerCase() === key.toLowerCase(),
            );
            if (found) return asText(entry[found]);
          }
          return "";
        };
        const fullName = pick("nom complet", "nom", "name", "fullname");
        const email = pick("email", "e-mail", "adresse e-mail", "mail").toLowerCase();
        const roleRaw = pick("rôle", "role");
        const role = ROLE_ALIASES[roleRaw.toLowerCase()] ?? "";
        const line = index + 2;
        if (!fullName || !email)
          return { line, fullName, email, role: roleRaw, status: "REJECTED", reason: "Nom ou e-mail manquant." };
        if (!EMAIL_PATTERN.test(email))
          return { line, fullName, email, role: roleRaw, status: "REJECTED", reason: "Adresse e-mail invalide." };
        if (!role)
          return { line, fullName, email, role: roleRaw, status: "REJECTED", reason: "Rôle non reconnu." };
        if (seen.has(email) || ctx.db.users.some((item) => item.email.toLowerCase() === email))
          return { line, fullName, email, role, status: "IGNORED", reason: "Adresse déjà connue." };
        seen.add(email);
        return { line, fullName, email, role, status: "READY", reason: "" };
      });
      const expiresAt = new Date(Date.now() + 30 * 60000).toISOString();
      const batchId = nextId("batch");
      ctx.db.importBatches = ctx.db.importBatches.filter(
        (batch) => Date.parse(batch.expiresAt) > Date.now(),
      );
      ctx.db.importBatches.push({
        id: batchId,
        createdAt: new Date().toISOString(),
        expiresAt,
        rows,
      });
      return {
        batchId,
        expiresAt,
        rows,
        ready: rows.filter((row) => row.status === "READY").length,
        created: 0,
        ignored: rows.filter((row) => row.status === "IGNORED").length,
        rejected: rows.filter((row) => row.status === "REJECTED").length,
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/users\/imports\/([^/]+)\/confirm$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN"]);
      const batch = ctx.db.importBatches.find((item) => item.id === ctx.params[0]);
      if (!batch) throw new MockHttpError(410, "Ce lot d'import est introuvable.");
      if (Date.parse(batch.expiresAt) < Date.now())
        throw new MockHttpError(410, "Ce lot d'import a expiré. Relancez l'analyse.");
      const now = new Date().toISOString();
      let created = 0;
      for (const row of batch.rows) {
        if (row.status !== "READY") continue;
        ctx.db.users.push({
          id: nextId("us"),
          fullName: row.fullName,
          email: row.email,
          role: row.role as MockUser["role"],
          phoneNumber: null,
          address: null,
          stationId: null,
          isActive: false,
          disabledAt: null,
          updatedAt: now,
          password: "uswap2026",
          invitationStatus: "SENT",
          invitationSentAt: now,
          invitationExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          audit: [
            {
              id: nextId("aud"),
              action: "IMPORTED",
              createdAt: now,
              before: {},
              after: { fullName: row.fullName, email: row.email, role: row.role },
            },
          ],
        });
        row.status = "CREATED";
        row.reason = "Invitation envoyée.";
        created += 1;
      }
      return {
        batchId: batch.id,
        expiresAt: batch.expiresAt,
        rows: batch.rows,
        ready: 0,
        created,
        ignored: batch.rows.filter((row) => row.status === "IGNORED").length,
        rejected: batch.rows.filter((row) => row.status === "REJECTED").length,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/users\/([^/]+)$/,
    handler: (ctx) => {
      const viewer = requireUser(ctx.db, ctx.user);
      const target = ctx.db.users.find((item) => item.id === ctx.params[0]);
      if (!target) throw new MockHttpError(404, "Compte introuvable.");
      const allowed =
        ["ADMIN", "SUPERVISOR"].includes(viewer.role) || viewer.id === target.id;
      if (!allowed) throw new MockHttpError(403, "Vous ne disposez pas des droits nécessaires.");
      return serializeDetail(ctx.db, target);
    },
  },
  {
    method: "PATCH",
    pattern: /^\/users\/([^/]+)$/,
    handler: (ctx) => {
      const admin = requireRole(requireUser(ctx.db, ctx.user), ["ADMIN"]);
      const target = ctx.db.users.find((item) => item.id === ctx.params[0]);
      if (!target) throw new MockHttpError(404, "Compte introuvable.");
      const expected = asText(ctx.body.updatedAt);
      if (expected && expected !== target.updatedAt)
        throw new MockHttpError(
          409,
          "Ces informations ont été modifiées entre-temps. Rechargez la fiche.",
        );
      const email = asText(ctx.body.email).toLowerCase();
      if (email && email !== target.email) {
        if (!EMAIL_PATTERN.test(email))
          throw new MockHttpError(400, "Adresse e-mail invalide.");
        if (ctx.db.users.some((item) => item.email.toLowerCase() === email))
          throw new MockHttpError(409, "Un autre compte utilise déjà cette adresse.");
      }
      const role = (asText(ctx.body.role).toUpperCase() || target.role) as MockUser["role"];
      const before = {
        fullName: target.fullName,
        email: target.email,
        role: target.role,
        phoneNumber: target.phoneNumber,
        address: target.address,
        stationId: target.stationId,
      };
      target.fullName = asText(ctx.body.fullName) || target.fullName;
      target.email = email || target.email;
      target.role = role;
      target.phoneNumber = asText(ctx.body.phoneNumber) || null;
      target.address = asText(ctx.body.address) || null;
      target.stationId =
        role === "SWAPPER" || role === "STATION_CHIEF"
          ? asText(ctx.body.stationId) || null
          : null;
      target.updatedAt = new Date().toISOString();
      target.audit.unshift({
        id: nextId("aud"),
        action: "UPDATED",
        createdAt: target.updatedAt,
        before,
        after: {
          fullName: target.fullName,
          email: target.email,
          role: target.role,
          phoneNumber: target.phoneNumber,
          address: target.address,
          stationId: target.stationId,
        },
      });
      return { ...serializeDetail(ctx.db, target), author: admin.id };
    },
  },
  {
    method: "PATCH",
    pattern: /^\/users\/([^/]+)\/status$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN"]);
      const target = ctx.db.users.find((item) => item.id === ctx.params[0]);
      if (!target) throw new MockHttpError(404, "Compte introuvable.");
      const expected = asText(ctx.body.updatedAt);
      if (expected && expected !== target.updatedAt)
        throw new MockHttpError(
          409,
          "Le statut a changé entre-temps. Fermez ce menu puis rouvrez la liste.",
        );
      const enabled = ctx.body.enabled === true;
      const before = { isActive: target.isActive, disabledAt: target.disabledAt };
      target.isActive = enabled;
      target.disabledAt = enabled ? null : new Date().toISOString();
      if (enabled) target.invitationStatus = "ACTIVATED";
      target.updatedAt = new Date().toISOString();
      target.audit.unshift({
        id: nextId("aud"),
        action: enabled ? "REACTIVATED" : "DISABLED",
        createdAt: target.updatedAt,
        before,
        after: { isActive: target.isActive, disabledAt: target.disabledAt },
      });
      if (!enabled && ctx.db.sessionEmail === target.email) ctx.db.sessionEmail = null;
      return { ok: true };
    },
  },
  {
    method: "POST",
    pattern: /^\/users\/([^/]+)\/activate$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN"]);
      const target = ctx.db.users.find((item) => item.id === ctx.params[0]);
      if (!target) throw new MockHttpError(404, "Compte introuvable.");
      if (target.isActive)
        throw new MockHttpError(409, "Ce compte est déjà activé.");
      const before = { isActive: target.isActive, invitationStatus: target.invitationStatus };
      target.isActive = true;
      target.disabledAt = null;
      target.invitationStatus = "SENT";
      target.invitationSentAt = new Date().toISOString();
      target.invitationExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      target.updatedAt = target.invitationSentAt;
      target.audit.unshift({
        id: nextId("aud"),
        action: "ACTIVATED",
        createdAt: target.updatedAt,
        before,
        after: { isActive: true, invitationStatus: "SENT" },
      });
      return { ok: true };
    },
  },
];