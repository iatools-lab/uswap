/**
 * Initialisation d'un serveur vierge (idempotent, rejouable a chaque deploiement).
 *
 *   cd backend_new && npm run bootstrap
 *
 * Cree ou met a jour, sans jamais supprimer d'exploitation :
 *  1. le referentiel minimal : reglages globaux, stations, modeles de shift ;
 *  2. le(s) compte(s) d'administration : SUPER_ADMIN (et ADMIN optionnel) ;
 *  3. les preferences de notification de chaque compte.
 *
 * Aucune donnee de demonstration (planning, pointage, conge, incident) et aucun
 * compte d'agent ne sont crees. Pour un jeu de demonstration local, utiliser
 * `npm run seed`.
 *
 * Variables (backend_new/.env ou environnement) :
 *   SUPERADMIN_EMAIL           adresse du super administrateur
 *   SUPERADMIN_PASSWORD        mot de passe initial (jamais versionne)
 *   SUPERADMIN_FULLNAME        nom affiche (optionnel)
 *   ADMIN_EMAIL / ADMIN_PASSWORD  second compte administrateur (optionnel)
 *   SUPPORT_EMAIL, TOLERANCE_MINUTES, GEOFENCE_RADIUS_METERS,
 *   MIN_REST_HOURS, WEEKLY_HOURS_LIMIT, INVITATION_VALIDITY_HOURS (optionnels)
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import 'dotenv/config';

const prisma = new PrismaClient();
const ROUNDS = 12;

const env = (name: string): string => (process.env[name] ?? '').trim();

const SUPERADMIN_EMAIL = env('SUPERADMIN_EMAIL').toLowerCase();
const SUPERADMIN_PASSWORD = env('SUPERADMIN_PASSWORD');
const ADMIN_EMAIL = env('ADMIN_EMAIL').toLowerCase();
const ADMIN_PASSWORD = env('ADMIN_PASSWORD');

const num = (name: string, fallback: number): number => {
  const value = Number(env(name));
  return Number.isFinite(value) && env(name) !== '' ? value : fallback;
};

/** Stations et modeles de shift du referentiel (identiques au seed). */
const STATIONS = [
  {
    name: 'Bonabéri',
    address: 'Zone industrielle de Bonabéri',
    city: 'Douala',
    location: 'Douala, Cameroun',
    latitude: 4.0777,
    longitude: 9.6627,
    weeklyHoursLimit: num('WEEKLY_HOURS_LIMIT', 48),
  },
  {
    name: 'Yaoundé Centre',
    address: 'Avenue Kennedy',
    city: 'Yaoundé',
    location: 'Yaoundé, Cameroun',
    latitude: 3.848,
    longitude: 11.5021,
    weeklyHoursLimit: 72,
  },
];

const TEMPLATES = [
  { station: 'Bonabéri', label: 'Matin', startTime: '06:00', endTime: '14:00', breakStart: '10:00', breakEnd: '10:30' },
  { station: 'Bonabéri', label: 'Après-midi', startTime: '14:00', endTime: '22:00', breakStart: '18:00', breakEnd: '18:30' },
  { station: 'Bonabéri', label: 'Nuit', startTime: '22:00', endTime: '06:00', breakStart: '01:00', breakEnd: '01:30' },
  { station: 'Yaoundé Centre', label: 'Matin', startTime: '07:00', endTime: '15:00', breakStart: '11:00', breakEnd: '11:30' },
  { station: 'Yaoundé Centre', label: 'Après-midi', startTime: '15:00', endTime: '23:00', breakStart: '19:00', breakEnd: '19:30' },
];

async function seedSettings() {
  await prisma.globalSettings.upsert({
    where: { id: 'global' },
    update: {},
    create: {
      id: 'global',
      sessionMinutes: 60,
      invitationValidityHours: num('INVITATION_VALIDITY_HOURS', 48),
      maxAttachmentMb: num('MAX_ATTACHMENT_MB', 5),
      notificationRetentionDays: num('NOTIFICATION_RETENTION_DAYS', 90),
      supportEmail: env('SUPPORT_EMAIL') || 'support@uswap.local',
    },
  });
  console.log('  reglages      globaux prets');
}

async function seedStations() {
  const byName = new Map<string, string>();
  for (const station of STATIONS) {
    const record = await prisma.station.upsert({
      where: { name: station.name },
      update: {
        address: station.address,
        city: station.city,
        location: station.location,
        latitude: station.latitude,
        longitude: station.longitude,
        timezone: 'Africa/Douala',
        weeklyHoursLimit: station.weeklyHoursLimit,
        isActive: true,
      },
      create: {
        name: station.name,
        address: station.address,
        city: station.city,
        location: station.location,
        latitude: station.latitude,
        longitude: station.longitude,
        timezone: 'Africa/Douala',
        weeklyHoursLimit: station.weeklyHoursLimit,
        isActive: true,
        latenessToleranceMinutes: num('TOLERANCE_MINUTES', 5),
        geofenceRadiusMeters: num('GEOFENCE_RADIUS_METERS', 150),
        minRestHours: num('MIN_REST_HOURS', 8),
      },
      select: { id: true, name: true },
    });
    byName.set(record.name, record.id);
    console.log(`  station       ${record.name}`);
  }
  return byName;
}

async function seedTemplates(stations: Map<string, string>) {
  for (const template of TEMPLATES) {
    const stationId = stations.get(template.station);
    if (!stationId) continue;
    const record = await prisma.shiftTemplate.upsert({
      where: {
        stationId_startTime_endTime: {
          stationId,
          startTime: template.startTime,
          endTime: template.endTime,
        },
      },
      update: {
        label: template.label,
        breakStart: template.breakStart,
        breakEnd: template.breakEnd,
        breakMinutes: 30,
        durationMinutes: 480,
        isActive: true,
      },
      create: {
        stationId,
        label: template.label,
        startTime: template.startTime,
        endTime: template.endTime,
        breakStart: template.breakStart,
        breakEnd: template.breakEnd,
        breakMinutes: 30,
        durationMinutes: 480,
        isActive: true,
      },
      select: { id: true },
    });
    await prisma.shiftTemplateVersion.create({
      data: {
        templateId: record.id,
        revision: 1,
        label: template.label,
        startTime: template.startTime,
        endTime: template.endTime,
        breakStart: template.breakStart,
        breakEnd: template.breakEnd,
        breakMinutes: 30,
        durationMinutes: 480,
        isActive: true,
      },
    });
    console.log(`  modele        ${template.station} — ${template.label}`);
  }
}

async function ensureAccount(input: {
  email: string;
  password: string;
  role: Role;
  fullName: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    // Le compte existe deja : on ne reecrit pas son mot de passe (il a pu
    // etre change), on garantit seulement son role et son activation.
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: input.role,
        isActive: true,
        disabledAt: null,
        lockedUntil: null,
        invitationStatus: 'ACTIVATED',
      },
    });
    console.log(`  compte        ${input.role} ${input.email} (existant : conserve)`);
    return existing.id;
  }

  const created = await prisma.user.create({
    data: {
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      passwordHash: await bcrypt.hash(input.password, ROUNDS),
      isActive: true,
      invitationStatus: 'ACTIVATED',
    },
    select: { id: true },
  });
  console.log(`  compte        ${input.role} ${input.email} (cree)`);
  return created.id;
}

async function ensurePreferences() {
  const users = await prisma.user.findMany({ select: { id: true } });
  for (const user of users) {
    const existing = await prisma.notificationPreference.findUnique({
      where: { userId: user.id },
    });
    if (existing) continue;
    await prisma.notificationPreference.create({
      data: {
        userId: user.id,
        internalEnabled: true,
        emailEnabled: true,
        pushEnabled: false,
        categories: JSON.stringify({
          PLANNING: { email: true, push: true },
          ATTENDANCE: { email: false, push: true },
          OPERATIONS: { email: true, push: true },
          LEAVE: { email: true, push: true },
          INCIDENT: { email: true, push: true },
          ACCESS: { email: true, push: false },
          REPORT: { email: true, push: false },
        }),
      },
    });
  }
  console.log(`  preferences   ${users.length} compte(s)`);
}

async function main() {
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
    throw new Error(
      'SUPERADMIN_EMAIL et SUPERADMIN_PASSWORD doivent etre definis ' +
        '(deploy/.env en production, backend_new/.env en local).',
    );
  }
  if (SUPERADMIN_PASSWORD.length < 12) {
    throw new Error('SUPERADMIN_PASSWORD doit contenir au moins 12 caracteres.');
  }

  console.log('Initialisation uSwap\n');
  await seedSettings();
  const stations = await seedStations();
  await seedTemplates(stations);

  await ensureAccount({
    email: SUPERADMIN_EMAIL,
    password: SUPERADMIN_PASSWORD,
    role: Role.SUPER_ADMIN,
    fullName: env('SUPERADMIN_FULLNAME') || 'Super administrateur',
  });

  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    await ensureAccount({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: Role.ADMIN,
      fullName: env('ADMIN_FULLNAME') || 'Administrateur',
    });
  }

  await ensurePreferences();
  console.log('\nInitialisation terminee : le super administrateur peut se connecter.');
}

main()
  .catch((error) => {
    console.error('Initialisation impossible :', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
