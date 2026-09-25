import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/auth-api";
import { useSession } from "../../app/session";
import {
Operations,
type OperationData,
} from "../../features/operations/Operations";
import { Building2, LoaderCircle } from "../../ui/icons";

type BackendAttendance = {
id: string;
status:
| "EXPECTED"
| "CHECKED_IN"
| "CHECKED_OUT"
| "ABSENT"
| "JUSTIFIED";
checkInAt: string | null;
checkOutAt: string | null;
stationId: string;
};

type BackendShift = {
id: string;
stationId: string;
swapperId: string;
startTime: string;
endTime: string;
station: {
id: string;
name: string;
location: string | null;
timezone: string;
latenessToleranceMinutes: number;
};
planning: {
id: string;
status: "DRAFT" | "PUBLISHED";
updatedAt: string;
} | null;
attendances: BackendAttendance[];
};

function calculateIsLate(
attendance: BackendAttendance | undefined,
shift: BackendShift,
) {
if (!attendance?.checkInAt) return false;

const toleranceMinutes =
shift.station.latenessToleranceMinutes ?? 0;

const checkIn = Date.parse(attendance.checkInAt);
const start = Date.parse(shift.startTime);

return checkIn > start + toleranceMinutes * 60 * 1000;
}

function mapShift(
shift: BackendShift,
fullName: string,
) {
const attendance = shift.attendances[0] ?? null;

return {
id: shift.id,
startTime: shift.startTime,
endTime: shift.endTime,
publishedAt:
shift.planning?.status === "PUBLISHED"
? shift.planning.updatedAt
: null,
station: {
id: shift.station.id,
name: shift.station.name,
timezone: shift.station.timezone,
latenessToleranceMinutes:
shift.station.latenessToleranceMinutes,
},
swapper: {
fullName,
},
attendance: attendance
? {
id: attendance.id,
status: attendance.status,
checkInAt: attendance.checkInAt,
checkOutAt: attendance.checkOutAt,
isLate: calculateIsLate(attendance, shift),
absenceReason: null,
}
: null,
};
}

export function OperationsPage() {
const { session, onAccessLost } = useSession();

const [data, setData] =
useState<OperationData | null>(null);

const [failure, setFailure] = useState(false);

const [revision, setRevision] = useState(0);

useEffect(() => {
let active = true;

if (!session) return;

const currentSession = session;

setData(null);
setFailure(false);

async function load() {
  try {
    if (currentSession.user.role === "SWAPPER") {
      const response = await api<BackendShift[]>(
        "/shifts/mine",
      );

      if (!active) return;

      const shifts = response.map((shift) =>
        mapShift(shift, currentSession.user.fullName),
      );

      const firstStation =
        response.length > 0
          ? response[0].station
          : null;

      setData({
        station: firstStation
          ? {
              id: firstStation.id,
              name: firstStation.name,
              location: firstStation.location,
              timezone: firstStation.timezone,
            }
          : null,
        limit: shifts.length,
        shifts,
      });

      return;
    }

    const workspace =
      await api<OperationData>("/workspace");

    if (!active) return;

    setData(workspace);
  } catch (err) {
    if (!active) return;

    if (
      err instanceof ApiError &&
      [401, 403].includes(err.status)
    ) {
      onAccessLost();
      return;
    }

    setFailure(true);
  }
}

void load();

return () => {
  active = false;
};

}, [
session?.user.id,
session?.user.role,
session?.user.fullName,
revision,
onAccessLost,
]);

if (!session) return null;

if (failure) {
return ( <section
     className="admin-card admin-empty"
     role="alert"
   > <h2>Chargement indisponible</h2>

    <button
      className="admin-button"
      onClick={() =>
        setRevision((value) => value + 1)
      }
    >
      Réessayer
    </button>
  </section>
);

}

if (!data) {
return ( <div className="admin-loading" role="status"> <LoaderCircle className="spin" />
Chargement de votre espace… </div>
);
}

if (
session.user.role === "STATION_CHIEF" &&
!data.station
) {
return ( <section className="admin-card admin-empty"> <Building2 size={36} />


    <h2>Aucune station rattachée</h2>

    <p>
      Votre administrateur doit rattacher votre compte à
      une station.
    </p>
  </section>
);


}

return (
<Operations
user={session.user}
data={data}
onChanged={() =>
setRevision((value) => value + 1)
}
/>
);
}
