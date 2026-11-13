import { DEMO_PASSWORD } from "../seed";
import {
  currentUser,
  nextId,
  requireRole,
  requireUser,
  serializeUser,
  sessionFor,
} from "../shared";
import {
  MockHttpError,
  type MockCtx,
  type MockRoute,
  type MockUser,
} from "../types";

/** Rôle attendu par chaque route de connexion (`/auth/login/:role`). */
const LOGIN_SPACE_ROLE: Record<string, MockUser["role"]> = {
  superadmin: "SUPER_ADMIN",
  admin: "ADMIN",
  supervisor: "SUPERVISOR",
  swapper: "SWAPPER",
};

/** Jeton d'invitation attendu (64 caractères hexadécimaux, comme les vraies routes). */
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

const asText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

/**
 * Règles de connexion, identiques à celles du serveur :
 * identifiants (401), espace (`403` si le rôle ne correspond pas), compte
 * désactivé ou non activé (`403`).
 */
function loginBySpace(
  ctx: { db: MockCtx["db"]; body: Record<string, unknown> },
  email: string,
  password: string,
  space?: string,
) {
  const user = ctx.db.users.find((item) => item.email.toLowerCase() === email);
  if (!user || user.password !== password)
    throw new MockHttpError(401, "Identifiants invalides ou session expirée.");
  if (space) {
    const expected = LOGIN_SPACE_ROLE[space];
    if (!expected)
      throw new MockHttpError(404, "Cette page de connexion n'existe pas.");
    if (user.role !== expected)
      throw new MockHttpError(
        403,
        "Cet espace de connexion ne correspond pas à votre compte.",
      );
  }
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
}

export const authRoutes: MockRoute[] = [
  {
    method: "POST",
    // Espace inconnu (`/auth/login/autre`) : déclaré AVANT la route générique,
    // qui ignorerait le segment non reconnu et laisserait passer la connexion.
    pattern: /^\/auth\/login\/([a-z]+)$/,
    handler: (ctx) => {
      if (!LOGIN_SPACE_ROLE[ctx.params[0]])
        throw new MockHttpError(404, "Cette page de connexion n'existe pas.");
      const email = asText(ctx.body.email).toLowerCase();
      const password =
        typeof ctx.body.password === "string" ? ctx.body.password : "";
      return loginBySpace(ctx, email, password, ctx.params[0]);
    },
  },
  {
    method: "POST",
    // Connexion commune (`/auth/login`) et connexion par espace de travail
    // (`/auth/login/superadmin|admin|supervisor|swapper`). Un compte dont le
    // rôle ne correspond pas à l'espace appelé est refusé, comme côté serveur.
    pattern: /^\/auth\/login(?:\/([a-z]+))?$/,
    handler: (ctx) => {
      const email = asText(ctx.body.email).toLowerCase();
      const password =
        typeof ctx.body.password === "string" ? ctx.body.password : "";
      return loginBySpace(ctx, email, password, ctx.params[0]);
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
      const password =
        typeof ctx.body.password === "string" ? ctx.body.password : "";
      if (!TOKEN_PATTERN.test(token))
        throw new MockHttpError(
          400,
          "Ce lien est incomplet ou a expiré. Demandez-en un nouveau.",
        );
      if (password.length < 8)
        throw new MockHttpError(
          400,
          "Le mot de passe doit contenir 8 caractères minimum.",
        );
      return { ok: true };
    },
  },
  {
    method: "POST",
    pattern: /^\/auth\/register$/,
    handler: (ctx) => {
      const admin = requireRole(requireUser(ctx.db, ctx.user), [
        "SUPER_ADMIN",
        "ADMIN",
      ]);
      const fullName = asText(ctx.body.fullName);
      const email = asText(ctx.body.email).toLowerCase();
      const role = asText(ctx.body.role).toUpperCase() as MockUser["role"];
      const stationId = asText(ctx.body.stationId) || null;
      const phoneNumber = asText(ctx.body.phoneNumber) || null;
      const address = asText(ctx.body.address) || null;
      const password =
        typeof ctx.body.password === "string" ? ctx.body.password : "";
      const active = asText(ctx.body.accountStatus).toUpperCase() === "ACTIVE";
      if (!fullName || !email.includes("@"))
        throw new MockHttpError(
          400,
          "Nom complet et adresse e-mail valides requis.",
        );
      if (!["ADMIN", "SUPERVISOR", "SWAPPER"].includes(role))
        throw new MockHttpError(400, "Choisissez un rôle valide.");
      if (role !== "SWAPPER" && stationId)
        throw new MockHttpError(
          400,
          "Ce rôle ne se rattache pas à une station.",
        );
      if (role === "SWAPPER" && !stationId)
        throw new MockHttpError(
          400,
          "Sélectionnez la station rattachée à ce collaborateur.",
        );
      if (
        stationId &&
        !ctx.db.stations.some((station) => station.id === stationId)
      )
        throw new MockHttpError(
          400,
          "La station sélectionnée est introuvable.",
        );
      if (ctx.db.users.some((item) => item.email.toLowerCase() === email))
        throw new MockHttpError(
          409,
          "Un compte utilise déjà cette adresse e-mail.",
        );
      if (active && password.length < 8)
        throw new MockHttpError(
          400,
          "Le mot de passe doit contenir 8 caractères minimum.",
        );
      const now = new Date().toISOString();
      const created: MockUser = {
        id: nextId("us"),
        fullName,
        email,
        role,
        phoneNumber,
        address,
        stationId: role === "SWAPPER" ? stationId : null,
        isActive: active,
        disabledAt: null,
        updatedAt: now,
        password: active ? password : DEMO_PASSWORD,
        invitationStatus: active ? "ACTIVATED" : "SENT",
        invitationSentAt: active ? null : now,
        invitationExpiresAt: active
          ? null
          : new Date(Date.now() + 7 * 86400000).toISOString(),
        audit: [
          {
            id: nextId("aud"),
            action: "CREATED",
            actorId: admin.id,
            createdAt: now,
            before: {},
            after: { fullName, email, role, stationId, phoneNumber, address },
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
    // Même chemin que le backend réel (`users.controller.ts`) : la route est
    // préfixée par l'espace de travail (`/superadmin/users/...`, `/pilot/users/...`).
    pattern: /\/users\/invitations\/([^/]+)\/resend$/,
    handler: (ctx) => {
      requireRole(requireUser(ctx.db, ctx.user), ["SUPER_ADMIN", "ADMIN"]);
      const target = ctx.db.users.find((item) => item.id === ctx.params[0]);
      if (!target) throw new MockHttpError(404, "Compte introuvable.");
      if (target.isActive)
        throw new MockHttpError(409, "Ce compte est déjà activé.");
      target.invitationStatus = "SENT";
      target.invitationSentAt = new Date().toISOString();
      target.invitationExpiresAt = new Date(
        Date.now() + 7 * 86400000,
      ).toISOString();
      target.updatedAt = target.invitationSentAt;
      return { ok: true };
    },
  },
];
