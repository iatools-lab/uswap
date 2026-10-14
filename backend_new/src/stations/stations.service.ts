import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { serializeStation, serializeTemplate } from '../common/serializers';
import {
  ConflictDomain,
  ErrorCode,
  NotFoundDomain,
} from '../common/errors/domain-errors';
import { stationOf } from '../common/validation/business-rules';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';

export interface StationPayload {
  name?: string;
  address?: string | null;
  city?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  location?: string | null;
  timezone?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  latenessToleranceMinutes?: number | string;
  geofenceRadiusMeters?: number | string;
  enforceMinRest?: boolean;
  minRestHours?: number | string;
  weeklyHoursLimit?: number | string;
  blockPublishingWithVacancies?: boolean;
}

export interface TemplatePayload {
  label?: string;
  startTime?: string;
  endTime?: string;
  breakStart?: string | null;
  breakEnd?: string | null;
  isActive?: boolean;
  revision?: number;
}

@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Stations                                                          */
  /* ---------------------------------------------------------------- */

  async list() {
    const stations = await this.prisma.station.findMany({
      orderBy: { name: 'asc' },
    });
    return stations.map(serializeStation);
  }

  async detail(id: string) {
    const station = await this.prisma.station.findUnique({ where: { id } });
    if (!station) throw this.stationNotFound();
    return serializeStation(station);
  }

  async create(payload: StationPayload) {
    const data = this.stationPayload(payload);
    this.validateGeolocation(data);
    const name = data.name;
    if (!name) {
      throw this.invalid('Le nom de la station est obligatoire.');
    }
    const clash = await this.prisma.station.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (clash) {
      throw new ConflictDomain(
        'STATION_NAME_TAKEN',
        'Une station porte déjà ce nom.',
      );
    }
    const created = await this.prisma.station.create({ data: { ...data, name } });
    return serializeStation(created);
  }

  async update(id: string, payload: StationPayload) {
    const station = await this.prisma.station.findUnique({ where: { id } });
    if (!station) throw this.stationNotFound();
    const data = this.stationPayload(payload, station);
    this.validateGeolocation(data);
    if (!data.name) {
      throw this.invalid('Le nom de la station est obligatoire.');
    }
    const clash = await this.prisma.station.findFirst({
      where: {
        id: { not: id },
        name: { equals: data.name, mode: 'insensitive' },
      },
    });
    if (clash) {
      throw new ConflictDomain(
        'STATION_NAME_TAKEN',
        'Une autre station porte déjà ce nom.',
      );
    }
    const updated = await this.prisma.station.update({
      where: { id },
      data,
    });
    return serializeStation(updated);
  }

  /**
   * Active ou desactive une station.
   *
   * Une desactivation est refusee si des postes a venir existent encore : les
   * agents se retrouveraient sans lieu de pointage (regle de la maquette).
   */
  async setActive(id: string, active: boolean) {
    const station = await this.prisma.station.findUnique({ where: { id } });
    if (!station) throw this.stationNotFound();
    if (!active) {
      const pending = await this.prisma.occurrence.count({
        where: {
          stationId: id,
          endTime: { gt: new Date() },
          planning: { status: 'PUBLISHED' },
        },
      });
      if (pending) {
        throw new ConflictDomain(
          'STATION_HAS_UPCOMING_SHIFTS',
          `Impossible de désactiver : ${pending} ${
            pending === 1 ? 'affectation à venir' : 'affectations à venir'
          } sur cette station.`,
        );
      }
    }
    await this.prisma.station.update({ where: { id }, data: { isActive: active } });
    return { ok: true, isActive: active };
  }

  /* ---------------------------------------------------------------- */
  /* Modeles de shift                                                  */
  /* ---------------------------------------------------------------- */

  async templates(stationId: string) {
    await this.requireStation(stationId);
    const templates = await this.prisma.shiftTemplate.findMany({
      where: { stationId },
      orderBy: { startTime: 'asc' },
    });
    return templates.map((template) => serializeTemplate(template));
  }

  async createTemplate(stationId: string, payload: TemplatePayload) {
    await this.requireStation(stationId);
    const computed = this.validateTemplate(payload, null);
    const clash = await this.prisma.shiftTemplate.findFirst({
      where: {
        stationId,
        startTime: computed.startTime,
        endTime: computed.endTime,
      },
    });
    if (clash) {
      throw new ConflictDomain(
        'TEMPLATE_SLOT_TAKEN',
        'Un modèle occupe déjà ce créneau sur cette station.',
      );
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const template = await tx.shiftTemplate.create({
        data: {
          stationId,
          label: computed.label,
          startTime: computed.startTime,
          endTime: computed.endTime,
          breakStart: computed.breakStart,
          breakEnd: computed.breakEnd,
          breakMinutes: computed.breakMinutes,
          durationMinutes: computed.durationMinutes,
        },
      });
      await tx.shiftTemplateVersion.create({
        data: {
          templateId: template.id,
          revision: template.revision,
          label: template.label,
          startTime: template.startTime,
          endTime: template.endTime,
          breakStart: template.breakStart,
          breakEnd: template.breakEnd,
          breakMinutes: template.breakMinutes,
          durationMinutes: template.durationMinutes,
          isActive: template.isActive,
        },
      });
      return template;
    });
    return serializeTemplate(created);
  }

  /**
   * Applique le meme modele a plusieurs stations d'un coup, en refusant le lot
   * entier des qu'une station presente un conflit de creneau.
   */
  async applyTemplateToStations(
    payload: TemplatePayload & { stationIds?: string[] },
  ) {
    const stationIds = [
      ...new Set((payload.stationIds ?? []).filter(Boolean)),
    ];
    if (!stationIds.length) {
      throw this.invalid('Choisissez au moins une station.');
    }
    const computed = this.validateTemplate(payload, null);
    const stations = await this.prisma.station.findMany({
      where: { id: { in: stationIds } },
    });
    if (stations.length !== stationIds.length) {
      throw this.stationNotFound();
    }
    const conflicts = await this.prisma.shiftTemplate.findMany({
      where: {
        stationId: { in: stationIds },
        startTime: computed.startTime,
        endTime: computed.endTime,
      },
      include: { station: { select: { name: true } } },
    });
    if (conflicts.length) {
      throw new ConflictDomain(
        'TEMPLATE_SLOT_TAKEN',
        `Un modèle occupe déjà ce créneau à ${conflicts[0].station.name}.`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const results: string[] = [];
      for (const station of stations) {
        const template = await tx.shiftTemplate.create({
          data: {
            stationId: station.id,
            label: computed.label,
            startTime: computed.startTime,
            endTime: computed.endTime,
            breakStart: computed.breakStart,
            breakEnd: computed.breakEnd,
            breakMinutes: computed.breakMinutes,
            durationMinutes: computed.durationMinutes,
          },
        });
        await tx.shiftTemplateVersion.create({
          data: {
            templateId: template.id,
            revision: template.revision,
            label: template.label,
            startTime: template.startTime,
            endTime: template.endTime,
            breakStart: template.breakStart,
            breakEnd: template.breakEnd,
            breakMinutes: template.breakMinutes,
            durationMinutes: template.durationMinutes,
            isActive: template.isActive,
          },
        });
        results.push(template.id);
      }
      return results;
    });

    return { created: created.length, templateIds: created };
  }

  async updateTemplate(
    stationId: string,
    templateId: string,
    payload: TemplatePayload,
  ) {
    const template = await this.prisma.shiftTemplate.findFirst({
      where: { id: templateId, stationId },
    });
    if (!template) {
      throw new NotFoundDomain(
        'TEMPLATE_NOT_FOUND',
        'Modèle de shift introuvable.',
      );
    }
    if (
      typeof payload.revision === 'number' &&
      payload.revision !== template.revision
    ) {
      throw new ConflictDomain(
        'STALE_WRITE',
        'Ce modèle a été modifié entre-temps. Rechargez la liste.',
      );
    }

    const computed = this.validateTemplate(payload, template);
    const clash = await this.prisma.shiftTemplate.findFirst({
      where: {
        id: { not: template.id },
        stationId: template.stationId,
        startTime: computed.startTime,
        endTime: computed.endTime,
      },
    });
    if (clash) {
      throw new ConflictDomain(
        'TEMPLATE_SLOT_TAKEN',
        'Un modèle occupe déjà ce créneau sur cette station.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.shiftTemplate.update({
        where: { id: template.id },
        data: {
          label: payload.label?.trim() || template.label,
          startTime: computed.startTime,
          endTime: computed.endTime,
          breakStart: computed.breakStart,
          breakEnd: computed.breakEnd,
          breakMinutes: computed.breakMinutes,
          durationMinutes: computed.durationMinutes,
          isActive:
            typeof payload.isActive === 'boolean'
              ? payload.isActive
              : template.isActive,
          revision: template.revision + 1,
        },
      });
      // Chaque revision est conservee : l'historique reste consultable.
      await tx.shiftTemplateVersion.create({
        data: {
          templateId: next.id,
          revision: next.revision,
          label: next.label,
          startTime: next.startTime,
          endTime: next.endTime,
          breakStart: next.breakStart,
          breakEnd: next.breakEnd,
          breakMinutes: next.breakMinutes,
          durationMinutes: next.durationMinutes,
          isActive: next.isActive,
        },
      });
      return next;
    });

    return serializeTemplate(updated);
  }

  /** Historique des revisions, du plus recent au plus ancien. */
  async templateHistory(stationId: string, templateId: string) {
    const template = await this.prisma.shiftTemplate.findFirst({
      where: { id: templateId, stationId },
    });
    if (!template) {
      throw new NotFoundDomain(
        'TEMPLATE_NOT_FOUND',
        'Modèle de shift introuvable.',
      );
    }
    const versions = await this.prisma.shiftTemplateVersion.findMany({
      where: { templateId },
      orderBy: { revision: 'desc' },
    });
    return versions.map((version) => ({
      id: version.id,
      label: version.label,
      startTime: version.startTime,
      endTime: version.endTime,
      breakStart: version.breakStart,
      breakEnd: version.breakEnd,
      breakMinutes: version.breakMinutes,
      durationMinutes: version.durationMinutes,
      isActive: version.isActive,
      revision: version.revision,
      createdAt: version.createdAt.toISOString(),
    }));
  }

  /* ---------------------------------------------------------------- */
  /* Validation                                                        */
  /* ---------------------------------------------------------------- */

  private stationPayload(data: StationPayload, current?: {
    latitude: number | null;
    longitude: number | null;
    timezone: string;
    latenessToleranceMinutes: number;
    geofenceRadiusMeters: number;
    enforceMinRest: boolean;
    minRestHours: number;
    weeklyHoursLimit: number;
    blockPublishingWithVacancies: boolean;
    name: string;
  }) {
    return {
      name: this.text(data.name) || current?.name,
      address: this.text(data.address) || null,
      city: this.text(data.city) || null,
      latitude: this.coordinate(data.latitude, current?.latitude),
      longitude: this.coordinate(data.longitude, current?.longitude),
      location: this.text(data.location) || null,
      timezone:
        this.text(data.timezone) ||
        current?.timezone ||
        'Africa/Douala',
      contactName: this.text(data.contactName) || null,
      contactPhone: this.text(data.contactPhone) || null,
      latenessToleranceMinutes: this.number(
        data.latenessToleranceMinutes,
        current?.latenessToleranceMinutes ??
          this.config.get('defaultToleranceMinutes', { infer: true }),
      ),
      geofenceRadiusMeters: Math.max(
        0,
        this.number(
          data.geofenceRadiusMeters,
          current?.geofenceRadiusMeters ??
            this.config.get('defaultGeofenceRadiusMeters', { infer: true }),
        ),
      ),
      enforceMinRest:
        typeof data.enforceMinRest === 'boolean'
          ? data.enforceMinRest
          : (current?.enforceMinRest ?? true),
      minRestHours: this.number(
        data.minRestHours,
        current?.minRestHours ??
          this.config.get('defaultMinRestHours', { infer: true }),
      ),
      weeklyHoursLimit: this.number(
        data.weeklyHoursLimit,
        current?.weeklyHoursLimit ??
          this.config.get('defaultWeeklyHoursLimit', { infer: true }),
      ),
      blockPublishingWithVacancies:
        typeof data.blockPublishingWithVacancies === 'boolean'
          ? data.blockPublishingWithVacancies
          : (current?.blockPublishingWithVacancies ?? false),
    };
  }

  private validateGeolocation(payload: {
    latitude: number | null;
    longitude: number | null;
    geofenceRadiusMeters: number;
  }) {
    const hasLatitude = payload.latitude != null;
    const hasLongitude = payload.longitude != null;
    if (hasLatitude !== hasLongitude) {
      throw this.invalid(
        'Renseignez la latitude et la longitude ensemble, ou laissez les deux coordonnées vides.',
      );
    }
    if (
      (hasLatitude &&
        (!Number.isFinite(payload.latitude) ||
          payload.latitude! < -90 ||
          payload.latitude! > 90)) ||
      (hasLongitude &&
        (!Number.isFinite(payload.longitude) ||
          payload.longitude! < -180 ||
          payload.longitude! > 180))
    ) {
      throw this.invalid('Les coordonnées GPS de la station ne sont pas valides.');
    }
    if (
      !Number.isFinite(payload.geofenceRadiusMeters) ||
      payload.geofenceRadiusMeters < 0
    ) {
      throw this.invalid('Le périmètre de pointage ne peut pas être négatif.');
    }
  }

  private validateTemplate(
    payload: TemplatePayload,
    current: {
      label: string;
      startTime: string;
      endTime: string;
      breakStart: string | null;
      breakEnd: string | null;
    } | null,
  ) {
    const label = this.text(payload.label) || current?.label || '';
    const startTime = this.text(payload.startTime) || current?.startTime || '';
    const endTime = this.text(payload.endTime) || current?.endTime || '';
    if (!label || !startTime || !endTime) {
      throw this.invalid(
        'Libellé, début et fin du modèle sont obligatoires.',
      );
    }
    const durationMinutes = this.slotMinutes(startTime, endTime);
    if (durationMinutes === 0) {
      throw this.invalid('Le créneau doit avoir une durée supérieure à zéro.');
    }

    const updatesBreak =
      payload.breakStart !== undefined || payload.breakEnd !== undefined;
    const breakStart = updatesBreak
      ? this.text(payload.breakStart) || null
      : (current?.breakStart ?? null);
    const breakEnd = updatesBreak
      ? this.text(payload.breakEnd) || null
      : (current?.breakEnd ?? null);
    this.assertBreakWithinShift(startTime, endTime, breakStart, breakEnd);

    return {
      label,
      startTime,
      endTime,
      breakStart,
      breakEnd,
      breakMinutes:
        breakStart && breakEnd ? this.slotMinutes(breakStart, breakEnd) : 0,
      durationMinutes,
    };
  }

  private assertBreakWithinShift(
    start: string,
    end: string,
    breakStart: string | null,
    breakEnd: string | null,
  ) {
    if (!breakStart && !breakEnd) return;
    if (!breakStart || !breakEnd) {
      throw this.invalid('Renseignez le début et la fin de la pause.');
    }
    const shiftMinutes = this.slotMinutes(start, end);
    const pauseMinutes = this.slotMinutes(breakStart, breakEnd);
    if (!pauseMinutes) {
      throw this.invalid('La pause doit avoir une durée supérieure à zéro.');
    }
    const toMinutes = (value: string): number =>
      Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const pauseOffset = (toMinutes(breakStart) - toMinutes(start) + 1440) % 1440;
    if (
      pauseOffset >= shiftMinutes ||
      pauseOffset + pauseMinutes > shiftMinutes
    ) {
      throw this.invalid(
        'La pause doit être entièrement comprise dans les horaires du shift.',
      );
    }
  }

  private slotMinutes(start: string, end: string): number {
    const toMinutes = (value: string): number =>
      Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    return (toMinutes(end) - toMinutes(start) + 1440) % 1440;
  }

  private async requireStation(stationId: string) {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
    });
    if (!station) throw this.stationNotFound();
    return station;
  }

  private coordinate(
    value: unknown,
    fallback: number | null | undefined,
  ): number | null {
    if (value === undefined) return fallback ?? null;
    if (value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private number(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private invalid(message: string): ConflictDomain {
    return new ConflictDomain(ErrorCode.VALIDATION, message, 400);
  }

  private stationNotFound(): NotFoundDomain {
    return new NotFoundDomain(ErrorCode.NOT_FOUND, 'Station introuvable.');
  }
}

export { stationOf };
