import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { api } from "../../api/auth-api";
import { Modal } from "../../ui/Modal";
import { Select } from "../../ui/Select";
import { Clock3, LoaderCircle, QrCode } from "../../ui/icons";
import { notify } from "../../ui/Toast";
import { formatDate, formatCountdown } from "./format";
import type { OperationData, Qr } from "./types";

type Kind = "CHECKIN" | "CHECKOUT";

export function QrManagement({ data }: { data: OperationData }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("CHECKIN");
  const [shiftId, setShiftId] = useState("");
  const [qr, setQr] = useState<Qr | null>(null);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const shifts = useMemo(
    () =>
      data.shifts
        .filter(
          (shift) =>
            shift.publishedAt &&
            shift.station.id &&
            shift.swapper.fullName !== "Poste vacant" &&
            (kind === "CHECKIN"
              ? !shift.attendance?.checkedInAt &&
                Date.parse(shift.startTime) <= now &&
                Date.parse(shift.endTime) >= now
              : Boolean(shift.attendance?.checkedInAt) &&
                !shift.attendance?.checkedOutAt),
        )
        .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)),
    [data.shifts, kind, now],
  );
  const target = shifts.find((shift) => shift.id === shiftId) ?? null;
  const remaining = qr ? Math.max(0, Date.parse(qr.expiresAt) - now) : 0;

  useEffect(() => {
    if (!open || !shiftId) return;
    setQr(null);
    setImage("");
    setError("");
  }, [open, shiftId, kind]);

  useEffect(() => {
    if (!qr) return;
    let active = true;
    QRCode.toDataURL(`${location.origin}/app/mon-espace#qr=${qr.token}`, {
      width: 260,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then((value) => active && setImage(value))
      .catch(() => active && setError("Le visuel du QR n’a pas pu être généré."));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [qr]);

  async function generate() {
    if (!target?.station.id) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Qr>("/attendance/qr", {
        stationId: target.station.id,
        shiftId: target.id,
        kind,
      });
      setNow(Date.now());
      setQr(result);
      notify(kind === "CHECKIN" ? "QR de début généré." : "QR de fin généré.");
    } catch (reason) {
      setError((reason as Error).message);
      setQr(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-card ops-qr-launcher">
      <div>
        <span className="ops-qr-launcher__icon"><QrCode size={20} /></span>
        <div>
          <h2>QR de prise et fin de service</h2>
          <p className="operations-hint">
            Générez un code temporaire pour n’importe quel shift publié de votre périmètre.
          </p>
        </div>
      </div>
      <button className="admin-button secondary" type="button" onClick={() => setOpen(true)}>
        <QrCode size={16} /> Gérer les QR
      </button>

      <Modal
        open={open}
        size="lg"
        title="Générer un QR de service"
        subtitle="Le code est lié à une station, un shift et une fenêtre de validité précise."
        onClose={() => !busy && setOpen(false)}
      >
        <div className="ops-qr-management">
          <div className="ops-qr-management__form">
            <div className="ops-segment" role="group" aria-label="Type de QR">
              <button type="button" aria-pressed={kind === "CHECKIN"} onClick={() => setKind("CHECKIN")}>Prise de service</button>
              <button type="button" aria-pressed={kind === "CHECKOUT"} onClick={() => setKind("CHECKOUT")}>Fin de service</button>
            </div>
            <label className="ops-field">
              Shift publié
              <Select
                ariaLabel="Shift publié pour le QR"
                value={shiftId}
                placeholder="Choisir un shift"
                onChange={(value) => setShiftId(String(value))}
                options={shifts.map((shift) => ({
                  value: shift.id,
                  label: `${shift.station.name} · ${shift.swapper.fullName} · ${formatDate(shift.startTime, shift.station.timezone || "Africa/Douala")}`,
                }))}
              />
            </label>
            {!shifts.length && (
              <p className="ops-callout ops-callout--muted" role="status">
                Aucun shift n’est actuellement éligible pour ce type de QR.
              </p>
            )}
            {target && (
              <div className="ops-qr-target">
                <Clock3 size={17} />
                <span>
                  <strong>{target.station.name}</strong>
                  <small>{formatDate(target.startTime, target.station.timezone || "Africa/Douala")} – {formatDate(target.endTime, target.station.timezone || "Africa/Douala")}</small>
                </span>
              </div>
            )}
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="admin-button primary-cta" type="button" disabled={!target || busy} onClick={() => void generate()}>
              {busy && <LoaderCircle className="spin" size={16} />}
              Générer le QR {kind === "CHECKIN" ? "de début" : "de fin"}
            </button>
          </div>
          <div className="ops-qr-management__poster">
            {!qr ? (
              <div className="qr-poster__empty"><QrCode size={38} /><p>Le QR apparaîtra ici.</p></div>
            ) : remaining <= 0 ? (
              <div className="qr-poster__empty"><p>Ce QR a expiré. Générez-en un nouveau.</p></div>
            ) : (
              <>
                <span className="admin-badge active">{qr.kind === "CHECKIN" ? "Début" : "Fin"} · {qr.stationName}</span>
                {image ? <img className="qr-image" src={image} alt="QR temporaire de pointage" /> : <LoaderCircle className="spin" size={30} />}
                <p>Expire dans <strong>{formatCountdown(remaining)}</strong></p>
                <small>Validité configurée : {qr.ttlSeconds} secondes</small>
              </>
            )}
          </div>
        </div>
      </Modal>
    </section>
  );
}
