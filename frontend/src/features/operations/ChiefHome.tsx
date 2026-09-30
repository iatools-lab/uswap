import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { notify } from "../../ui/Toast";
import { api } from "../../api/auth-api";
import { Select } from "../../ui/Select";
import { Copy, LoaderCircle, QrCode } from "../../ui/icons";
import { dayKey, formatDate, formatCountdown, isInWindow } from "./format";
import { ShiftTable } from "./ShiftTable";
import type { OperationsViewProps, Qr } from "./types";

type Kind = "CHECKIN" | "CHECKOUT";

export function ChiefHome({ user, data }: OperationsViewProps) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Kind | null>(null);
  const [kind, setKind] = useState<Kind>("CHECKIN");
  const [shiftId, setShiftId] = useState("");
  const [qr, setQr] = useState<Qr | null>(null);
  const [image, setImage] = useState("");
  const [now, setNow] = useState(Date.now());
  const zone = data.station?.timezone || "Africa/Douala";
  const today = dayKey(new Date().toISOString(), zone);
  const published = data.shifts.filter((shift) => shift.publishedAt);
  const live = published.filter(
    (shift) => dayKey(shift.startTime, zone) === today,
  );
  const history = published.filter(
    (shift) => dayKey(shift.startTime, zone) !== today,
  );

  const target = published.find((shift) => shift.id === shiftId) || null;
  const pendingCheckout = live.filter(
    (shift) => shift.attendance && !shift.attendance.checkedOutAt,
  );
  const notCheckedIn = live.filter(
    (shift) => !shift.attendance && Date.parse(shift.startTime) <= now,
  );
  const remainingMs = qr
    ? Math.max(0, Date.parse(qr.expiresAt) - now)
    : 0;
  const remainingRatio =
    qr && qr.ttlSeconds ? remainingMs / (qr.ttlSeconds * 1000) : 0;
  const expired = Boolean(qr && remainingMs <= 0);

  useEffect(() => {
    if (published.length === 1) setShiftId(published[0].id);
  }, [published.length, published[0]?.id]);

  useEffect(() => {
    if (!qr) return;
    let active = true;
    QRCode.toDataURL(`${location.origin}/app/mon-espace#qr=${qr.token}`, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then((src) => {
        if (active) setImage(src);
      })
      .catch(() => {
        if (active) setError("Impossible de générer le visuel du QR.");
      });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [qr]);

  async function generate() {
    if (!data.station || !shiftId) {
      setError("Sélectionnez le shift publié à pointer.");
      return;
    }
    setBusy(kind);
    setError("");
    try {
      setImage("");
      const result = await api<Qr>("/attendance/qr", {
        stationId: data.station.id,
        shiftId,
        kind,
      });
      setNow(Date.now());
      setQr(result);
      notify(kind === "CHECKIN" ? "QR de début généré." : "QR de fin généré.");
    } catch (err) {
      setQr(null);
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function switchKind(next: Kind) {
    setKind(next);
    setQr(null);
    setImage("");
  }

  async function copyLink() {
    if (!qr) return;
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/app/mon-espace#qr=${qr.token}`,
      );
      notify("Lien de scan copié.");
    } catch {
      notify("Copie impossible, montrez le QR.");
    }
  }

  return (
    <>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      <section className="admin-card ops-qr-card">
        <div className="admin-card-heading">
          <div>
            <h2>QR à présenter</h2>
            <p className="operations-hint">
              Un code pour le début, un autre pour la fin. Choisissez le shift
              publié, affichez le QR aux swappeurs, puis laissez-les scanner.
            </p>
          </div>
        </div>

        <div className="ops-qr-layout">
          <div className="ops-qr-form">
            <div className="ops-segment" role="group" aria-label="Type de QR">
              <button
                type="button"
                aria-pressed={kind === "CHECKIN"}
                onClick={() => switchKind("CHECKIN")}
              >
                Début de service
              </button>
              <button
                type="button"
                aria-pressed={kind === "CHECKOUT"}
                onClick={() => switchKind("CHECKOUT")}
              >
                Fin de service
              </button>
            </div>

            <fieldset disabled={busy !== null} className="ops-form">
              <label>
                Shift publié
                {published.length ? (
                  <Select
                    ariaLabel="Shift publié"
                    value={shiftId}
                    placeholder="Sélectionner"
                    onChange={(value) => setShiftId(String(value))}
                    options={published.map((shift) => ({
                      value: shift.id,
                      label: `${shift.swapper.fullName} · ${formatDate(shift.startTime, zone)}`,
                    }))}
                  />
                ) : (
                  <span className="operations-hint">
                    Aucun shift publié pour cette station.
                  </span>
                )}
              </label>
            </fieldset>

            {target && kind === "CHECKIN" && !isInWindow(target) && (
              <p className="ops-callout ops-callout--muted" role="status">
                Ce shift n’est pas dans sa fenêtre (
                {formatDate(target.startTime, zone)} –{" "}
                {formatDate(target.endTime, zone)}). Le début sera refusé hors
                créneau.
              </p>
            )}

            <button
              type="button"
              className="admin-button primary-cta"
              disabled={busy !== null || !shiftId}
              onClick={() => void generate()}
            >
              {busy !== null && <LoaderCircle className="spin" size={16} />}
              {kind === "CHECKIN"
                ? "Afficher le QR de début"
                : "Afficher le QR de fin"}
            </button>
          </div>

          <div className={`qr-poster ${expired ? "is-expired" : ""}`}>
            {!qr ? (
              <div className="qr-poster__empty">
                <QrCode size={36} />
                <p>
                  Choisissez le shift, puis affichez le QR à l’écran.
                </p>
              </div>
            ) : expired ? (
              <div className="qr-poster__empty">
                <p role="status">QR expiré. Générez un nouveau code.</p>
              </div>
            ) : (
              <>
                <span className="admin-badge active">
                  {qr.kind === "CHECKIN" ? "Début" : "Fin"} · {qr.stationName}
                </span>
                {image ? (
                  <img
                    className="qr-image"
                    src={image}
                    alt="QR à scanner pour le pointage"
                  />
                ) : (
                  <LoaderCircle className="spin" size={32} />
                )}
                <div
                  className="qr-ttl"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={qr.ttlSeconds}
                  aria-valuenow={Math.ceil(remainingMs / 1000)}
                >
                  <i style={{ transform: `scaleX(${remainingRatio})` }} />
                </div>
                <p>
                  Expire dans{" "}
                  <strong>{formatCountdown(remainingMs)}</strong>
                </p>
                <small>
                  Validité station : {qr.ttlSeconds} s · jusqu’au{" "}
                  {formatDate(qr.expiresAt, qr.timezone, true)}
                </small>
                <button
                  type="button"
                  className="admin-button secondary small"
                  onClick={() => void copyLink()}
                >
                  <Copy size={15} />
                  Copier le lien
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {(!!pendingCheckout.length || !!notCheckedIn.length) && (
        <div className="ops-callout-row">
          {!!notCheckedIn.length && (
            <button
              type="button"
              className="ops-callout ops-callout--warn"
              onClick={() => switchKind("CHECKIN")}
            >
              <strong>
                {notCheckedIn.length} sans prise de service
              </strong>
              <span>Générez le QR de début pour les faire pointer.</span>
            </button>
          )}
          {!!pendingCheckout.length && (
            <button
              type="button"
              className="ops-callout"
              onClick={() => switchKind("CHECKOUT")}
            >
              <strong>
                {pendingCheckout.length} encore en service
              </strong>
              <span>Générez le QR de fin pour clôturer.</span>
            </button>
          )}
        </div>
      )}

      <section className="admin-card">
        <div className="admin-card-heading">
          <h2>Présence du jour · {data.station?.name}</h2>
        </div>
        <ShiftTable
          user={user}
          shifts={live}
          emptyLabel="Aucun shift publié aujourd’hui"
        />
      </section>

      <section className="admin-card">
        <div className="admin-card-heading">
          <h2>Autres affectations publiées</h2>
        </div>
        <ShiftTable
          user={user}
          shifts={history}
          emptyLabel="Aucune autre affectation publiée"
        />
        {data.shifts.length === data.limit && (
          <p className="workspace-limit">
            Les {data.limit} prochaines affectations sont affichées.
          </p>
        )}
      </section>
    </>
  );
}
