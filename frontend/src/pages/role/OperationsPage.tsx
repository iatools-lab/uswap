import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/auth-api";
import { useSession } from "../../app/session";
import {
  Operations,
  type OperationData,
} from "../../features/operations/Operations";
import type { OperationShift } from "../../features/operations/types";
import { LoaderCircle } from "../../ui/icons";

type BackendWorkspace = {
  station: OperationData["station"];
  limit: number;
  shifts: Array<{
    id: string;
    startTime: string;
    endTime: string;
    publishedAt: string | null;
    station: NonNullable<OperationData["station"]> & {
      latenessToleranceMinutes?: number;
      geofenceRadiusMeters?: number;
      latitude?: number | null;
      longitude?: number | null;
    };
    swapper: { fullName: string };
    attendance: {
      checkInAt: string | null;
      checkOutAt: string | null;
      isLate: boolean;
      isAbsent: boolean;
    } | null;
  }>;
};

function adaptWorkspace(payload: BackendWorkspace): OperationData {
  const shifts: OperationShift[] = payload.shifts.map((shift) => {
    const checkInAt = shift.attendance?.checkInAt ?? null;
    const checkOutAt = shift.attendance?.checkOutAt ?? null;
    const late = shift.attendance?.isLate ?? false;
    const status: NonNullable<OperationShift["attendance"]>["status"] =
      checkOutAt
        ? "CLOSED"
        : checkInAt
          ? late
            ? "LATE"
            : "PRESENT"
          : shift.attendance?.isAbsent
            ? "ABSENT"
            : "EXPECTED";
    // Un créneau dont la présence n'est pas encore renseignée est « en attente
    // de pointage » (EXPECTED), pas « absent ». Le repli sur ABSENT faisait
    // apparaître absents des services qui n'avaient pas encore commencé.
    const hasAttendance = Boolean(checkInAt || checkOutAt || shift.attendance?.isAbsent);
    const timezone = shift.station.timezone || "Africa/Douala";
    const time = (value: string) =>
      new Intl.DateTimeFormat("fr-CM", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: timezone,
      }).format(new Date(value));

    return {
      id: shift.id,
      planningId: "",
      templateId: shift.id,
      label: `Service ${time(shift.startTime)} – ${time(shift.endTime)}`,
      startTime: shift.startTime,
      endTime: shift.endTime,
      publishedAt: shift.publishedAt,
      station: {
        id: shift.station.id,
        name: shift.station.name,
        timezone,
        latitude: shift.station.latitude ?? null,
        longitude: shift.station.longitude ?? null,
        geofenceRadiusMeters: shift.station.geofenceRadiusMeters,
        latenessToleranceMinutes: shift.station.latenessToleranceMinutes,
      },
      swapper: shift.swapper,
      attendance: hasAttendance
        ? {
            status,
            checkedInAt: checkInAt ?? "",
            checkedOutAt: checkOutAt,
            isLate: late,
          }
        : null,
    };
  });
  return { station: payload.station, limit: payload.limit, shifts };
}

export function OperationsPage() {
  const { session, onAccessLost } = useSession();
  const [data, setData] = useState<OperationData | null>(null);
  const [failure, setFailure] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setData(null);
    setFailure(false);
    api<BackendWorkspace | OperationData>("/workspace")
      .then((value) => {
        if (!active) return;
        // Les données API sont déjà au format attendu par les composants. Le backend
        // Danielle est converti une seule fois à cette frontière.
        setData(
          "shifts" in value && value.shifts.every((item) => "label" in item)
            ? (value as OperationData)
            : adaptWorkspace(value as BackendWorkspace),
        );
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && [401, 403].includes(err.status))
          onAccessLost();
        else setFailure(true);
      });
    return () => {
      active = false;
    };
  }, [session?.user.id, session?.user.role, revision, onAccessLost]);

  if (!session) return null;

  if (failure)
    return (
      <section className="admin-card admin-empty" role="alert">
        <h2>Chargement indisponible</h2>
        <button
          className="admin-button"
          onClick={() => setRevision((value) => value + 1)}
        >
          Réessayer
        </button>
      </section>
    );

  if (!data)
    return (
      <div className="admin-loading" role="status">
        <LoaderCircle className="spin" />
        Chargement de votre espace…
      </div>
    );

  return (
    <Operations
      user={session.user}
      data={data}
      onChanged={() => setRevision((value) => value + 1)}
    />
  );
}
