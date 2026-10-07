-- uSwap v5.3 : pointage GPS au périmètre de la station.
ALTER TABLE "Station" ADD COLUMN IF NOT EXISTS "geofenceRadiusMeters" INTEGER NOT NULL DEFAULT 150;
