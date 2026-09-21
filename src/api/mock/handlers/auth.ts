import { DEMO_PASSWORD } from "../seed";
import {
  currentUser,
  nextId,
  requireRole,
  requireUser,
  serializeUser,
  sessionFor,
} from "../shared";
import { MockHttpError, type MockRoute, type MockUser } from "../types";

/** Jeton d'invitation attendu (64 caractères hexadécimaux, comme les vraies routes). */
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const authRoutes: MockRoute[] = [
  {
    method: "POST",
    pattern: /^\/auth\/login$/,
    handler: (ctx) => {
      const email = asText(ctx.body.email).toLowerCase();
      const password = typeof ctx.body.password === "string" ? ctx.body.password : "";
      const user = ctx.db.users.find((item) => item.email.toLowerCase() === email);
      if (!user || user.password !== password)
        throw new MockHttpError(401, "Identifiants invalides ou session expirée.");
      if (user.disabledAt)
        throw new MockHttpError(
          403,
          "Ce compte est désactivé. Contactez votre administrateur.",
        );
      if (!user.isActive)
        throw new MockHttpError(
          403,
          "Ce compte n'est pas encore activé. Ouvrez le lien reçu par e-mail.",
        );
      ctx.db.sessionEmail = user.email;
      return sessionFor(ctx.db, user);
    },
  },
  {
    method: "POST",
    pattern: /^\/auth\/refresh$/,
    handler: (ctx) => {
      const user = currentUser(ctx.db);
      if (!user) throw new MockHttpError(401, "Session fermée.");
      if (user.disabledAt) {
        ctx.db.sessionEmail = null;
        throw new MockHttpError(403, "Ce compte est désactivé.");
      }
      return sessionFor(ctx.db, user);
    },
  },
  {
    method: "POST",
    pattern: /^\/auth\/logout$/,
    handler: (ctx) => {
      ctx.db.sessionEmail = null;
      return { ok: true };
    },
  },
  {
    method: "GET",
    pattern: /^\/auth\/me$/,
    handler: (ctx) => ({
      user: serializeUser(ctx.db, requireUser(ctx.db, ctx.user)),
    }),
  },
  {
    method: "POST",
    pattern: /^\/auth\/forgot-password$/,
    handler: () => ({ ok: true }),
  },
  {
    method: "POST",
    pattern: /^\/auth\/(activate-account|reset-password)$/,
    handler: (ctx) => {
      const token = asText(ctx.body.token);
      const password = typeof ctx.body.password === "string" ? ctx.body.password : "";
      if (!TOKEN_PATTERN.test(token))
        throw new MockHttpError(
          400,
          "Ce lien est incomplet ou a expiré. Demandez-en un nouveau.",
        );
      if (password.length < 8)
        throw new MockHttpError(400, "Le mot de passe doit contenir 8 caractères minimum.");
      return { ok: true };
    },
  },
  {
    method: "POST",
    pattern: /^\/auth\/register$/,
    handler: (ctx) => {
      const admin = requireRole(
        requireUser(ctx.db, ctx.user),
        ["ADMIN"],
      );
      const fullName = asText(ctx.body.fullName);
      const email = asText(ctx.body.email).toLowerCase();
      const role = asText(ctx.body.role).toUpperCase() as MockUser["role"];
      const stationId = asText(ctx.body.stationId) || null;
      const password = typeof ctx.body.password === "string" ? ctx.body.password : "";
      const active = asText(ctx.body.accountStatus).toUpperCase() === "ACTIVE";
      if (!fullName || !email.includes("@"))
        throw new MockHttpError(400, "Nom complet et adresse e-mail valides requis.");
      if (!["ADMIN", "SUPERVISOR", "STATION_CHIEF", "SWAPPER"].includes(role))
        throw new MockHttpError(400, "Choisissez un rôle valide.");
      if (role !== "SWAPPER" && role !== "STATION_CHIEF" && stationId)
        throw new MockHttpError(400, "Ce rôle ne se rattache pas à une station.");
      if ((role === "SWAPPER" || role === "STATION_CHIEF") && !stationId)
        throw new MockHttpError(400, "Sélectionnez la station rattachée à ce collaborateur.");
      if (stationId && !ctx.db.stations.some((station) => station.id === stationId))
        throw new MockHttpError(400, "La station sélectionnée est introuvable.");
      if (ctx.db.users.some((item) => item.email.toLowerCase() === email))
        throw new MockHttpError(409, "Un compte utilise déjà cette adresse e-mail.");
      if (active && password.length < 8)
        throw new MockHttpError(400, "Le mot de passe doit contenir 8 caractères minimum.");
      const now = new Date().toISOString();
      const created: MockUser = {
        id: nextId("us"),
        fullName,
        email,
        role,
        phoneNumber: null,
        address: null,
        stationId: role === "SWAPPER" || role === "STATION_CHIEF" ? stationId : null,
        isActive: active,
        disabledAt: null,
        updatedAt: now,
        password: active ? password : DEMO_PASSWORD,
        invitationStatus: active ? "ACTIVATED" : "SENT",
        invitationSentAt: active ? null : now,
        invitationExpiresAt: active ? null : new Date(Date.now() + 7 * 86400000).toISOString(),
        audit: [
          {
            id: nextId("aud"),
            action: "CREATED",
            createdAt: now,
            before: {},
            after: { fullName, email, role, stationId },
          },
        ],
      };
      ctx.db.users.push(created);
      return {
        id: created.id,
        invitationStatus: created.invitationStatus,
        isActive: created.isActive,
        author: admin.id,
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/auth\/invitations\/([^/]+)\/resend$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["ADMIN"]);
      const target = ctx.db.users.find((item) => item.id === ctx.params[0]);
      if (!target) throw new MockHttpError(404, "Compte introuvable.");
      if (target.isActive)
        throw new MockHttpError(409, "Ce compte est déjà activé.");
      target.invitationStatus = "SENT";
      target.invitationSentAt = new Date().toISOString();
      target.invitationExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      target.updatedAt = target.invitationSentAt;
      return { ok: true };
    },
  },
];
