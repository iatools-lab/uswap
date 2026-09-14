import { notify } from "./Notifications";
import { ShiftConstraints, useShiftConstraints } from "./ShiftConstraints";
import { useEffect, useState, useMemo, type FormEvent } from "react";
import QRCode from "qrcode";
import { api, type User } from "./auth-api";
import { Clock3, LoaderCircle } from "./icons";
import { Modal } from "./modal";
import { X, MagnifyingGlass, Buildings } from "@phosphor-icons/react";

export type OperationData = {
  station: { id: string; name: string; location: string | null } | null;
  limit: number;
  shifts: {
    id: string;
    startTime: string;
    endTime: string;
    publishedAt: string | null;
    station: { name: string };
    swapper: { fullName: string };
    attendance: {
      checkedInAt: string;
      checkedOutAt: string | null;
      isLate: boolean;
    } | null;
  }[];
};

type Qr = {
  token: string;
  kind: string;
  stationName: string;
  createdAt: string;
  expiresAt: string;
  timezone: string;
};

let scanned = new URLSearchParams(location.hash.slice(1)).get("qr") || "";
if (scanned) history.replaceState(null, "", location.pathname);

const formatDate = (value: string, zone = "Africa/Douala", seconds = false) =>
  new Intl.DateTimeFormat("fr-CM", {
    dateStyle: "medium",
    timeStyle: seconds ? "medium" : "short",
    timeZone: zone,
  }).format(new Date(value));

export function Operations({
  user,
  data,
  onChanged,
}: {
  user: User;
  data: OperationData;
  onChanged: () => void;
}) {
  const [stations, setStations] = useState<
    { id: string; name: string; city?: string | null; isActive: boolean }[]
  >([]);
  const [swappers, setSwappers] = useState<(User & { isActive: boolean })[]>([]);

  const [stationId, setStationId] = useState("");
  const [stationQuery, setStationQuery] = useState("");
  const [isStationDropdownOpen, setIsStationDropdownOpen] = useState(false);

  const [swapperIds, setSwapperIds] = useState<string[]>([]);
  const [swapperQuery, setSwapperQuery] = useState("");
  const [isSwapperDropdownOpen, setIsSwapperDropdownOpen] = useState(false);

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [form, setForm] = useState(false);

  const constraints = useShiftConstraints(
    user.role === "SUPERVISOR" && form,
    stationId,
    swapperIds[0] || "",
    start,
    end,
  );

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<Qr | null>(null);
  const [image, setImage] = useState("");
  const [now, setNow] = useState(Date.now());
  const [token, setToken] = useState(scanned);
  const [shiftId, setShift] = useState("");

  const filteredStations = useMemo(() => {
    if (!stationQuery) return stations;
    return stations.filter(
      (s) =>
        s.name.toLowerCase().includes(stationQuery.toLowerCase()) ||
        (s.city && s.city.toLowerCase().includes(stationQuery.toLowerCase()))
    );
  }, [stations, stationQuery]);

  const filteredSwappers = useMemo(() => {
    if (!swapperQuery) return swappers;
    return swappers.filter(
      (s) =>
        s.fullName.toLowerCase().includes(swapperQuery.toLowerCase()) ||
        s.email.toLowerCase().includes(swapperQuery.toLowerCase())
    );
  }, [swappers, swapperQuery]);

  const selectedStationObj = stations.find((s) => s.id === stationId);

  useEffect(() => {
    scanned = "";
    const receive = () => {
      const value = new URLSearchParams(location.hash.slice(1)).get("qr");
      if (value) {
        setToken(value);
        history.replaceState(null, "", location.pathname);
      }
    };
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);

  useEffect(() => {
    if (user.role !== "SUPERVISOR") return;
    let active = true;

    Promise.all([
      api<typeof stations>("/stations"),
      api<typeof swappers>("/users?role=SWAPPER"),
    ])
      .then(([s, u]) => {
        if (active) {
          setStations(s.filter((x) => x.isActive));
          setSwappers(u.filter((x) => x.isActive));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });

    return () => {
      active = false;
    };
  }, [user.role]);

  useEffect(() => {
    if (!qr) return;
    let active = true;

    QRCode.toDataURL(location.origin + "/app/mon-espace#qr=" + qr.token, {
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

  async function act(run: () => Promise<unknown>, reload = true) {
    setBusy(true);
    setError("");
    try {
      await run();
      if (reload) {
        notify("Opération enregistrée.");
        onChanged();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    if (swapperIds.length === 0) {
      setError("Veuillez sélectionner au moins un swappeur.");
      return;
    }

    void act(async () => {
      for (const swapperId of swapperIds) {
        await api("/shifts", {
          stationId,
          swapperId,
          startTime: new Date(start).toISOString(),
          endTime: new Date(end).toISOString(),
        });
      }
    }).then(() => {
      setForm(false);
      setSwapperIds([]);
      setStationId("");
    });
  }

  function punch(e: FormEvent) {
    e.preventDefault();
    let raw = token.trim();
    try {
      raw = new URLSearchParams(new URL(raw).hash.slice(1)).get("qr") || raw;
    } catch {}

    if (!/^[a-f0-9]{64}$/.test(raw)) {
      setError(
        "Scannez le QR ou collez le lien fourni par le chef de station.",
      );
      return;
    }

    void act(async () => {
      await api("/attendance", { shiftId, token: raw });
      setToken("");
    });
  }

  return (
    <>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {user.role === "SUPERVISOR" && (
        <section className="admin-card user-form-card station-editor">
          <button
            type="button"
            className="admin-button"
            disabled={busy}
            onClick={() => setForm(true)}
          >
            Nouvelle affectation
          </button>

          {form && (
            <Modal open title="Préparer des affectations" onClose={() => setForm(false)}>
              <form onSubmit={create}>
                <fieldset disabled={busy} className="planner-fieldset">
                  <div className="user-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", alignItems: "start" }}>
                    
                    {/* Station */}
                    <div style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 500, position: "relative" }}>
                      <span>Station (Optionnel)</span>
                      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                        <Buildings size={16} style={{ position: "absolute", left: "12px", color: "#64748b", pointerEvents: "none" }} />
                        <input
                          type="text"
                          placeholder={selectedStationObj ? selectedStationObj.name : "Rechercher une station..."}
                          value={stationQuery}
                          onFocus={() => setIsStationDropdownOpen(true)}
                          onChange={(e) => {
                            setStationQuery(e.target.value);
                            setIsStationDropdownOpen(true);
                          }}
                          style={{
                            width: "100%",
                            height: "42px",
                            paddingLeft: "36px",
                            paddingRight: "36px",
                            borderRadius: "8px",
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            fontSize: "13.5px",
                            outline: "none"
                          }}
                        />
                        {stationId && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setStationId("");
                              setStationQuery("");
                            }}
                            style={{ position: "absolute", right: "10px", background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
                            title="Effacer"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>

                      {isStationDropdownOpen && (
                        <>
                          <div 
                            style={{ position: "fixed", inset: 0, zIndex: 990 }} 
                            onClick={() => setIsStationDropdownOpen(false)} 
                          />
                          <div style={{
                            position: "absolute",
                            top: "calc(100% + 4px)",
                            left: 0,
                            right: 0,
                            background: "#fff",
                            border: "1px solid #cbd5e1",
                            borderRadius: "8px",
                            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15)",
                            maxHeight: "180px",
                            overflowY: "auto",
                            zIndex: 1000,
                            display: "grid",
                            padding: "4px"
                          }}>
                            <button
                              type="button"
                              onClick={() => {
                                setStationId("");
                                setStationQuery("");
                                setIsStationDropdownOpen(false);
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                padding: "9px 12px",
                                borderRadius: "6px",
                                background: stationId === "" ? "#f0f9ff" : "transparent",
                                border: "none",
                                cursor: "pointer",
                                textAlign: "left",
                                fontSize: "13px",
                                width: "100%",
                                color: "#64748b"
                              }}
                            >
                              Aucune station (Optionnel)
                            </button>

                            {filteredStations.map((st) => {
                              const isSelected = stationId === st.id;
                              return (
                                <button
                                  type="button"
                                  key={st.id}
                                  onClick={() => {
                                    setStationId(st.id);
                                    setStationQuery("");
                                    setIsStationDropdownOpen(false);
                                  }}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "9px 12px",
                                    borderRadius: "6px",
                                    background: isSelected ? "#f0f9ff" : "transparent",
                                    border: "none",
                                    cursor: "pointer",
                                    textAlign: "left",
                                    fontSize: "13px",
                                    width: "100%",
                                    transition: "background 0.15s"
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = isSelected ? "#f0f9ff" : "#f8fafc")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? "#f0f9ff" : "transparent")}
                                >
                                  <span>
                                    <strong>{st.name}</strong> {st.city ? <span style={{ color: "#64748b" }}>({st.city})</span> : ""}
                                  </span>
                                  {isSelected && <span style={{ color: "#0284c7", fontWeight: 600, fontSize: "12px" }}>Sélectionné ✓</span>}
                                </button>
                              );
                            })}
                            {filteredStations.length === 0 && (
                              <div style={{ padding: "12px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
                                Aucune station trouvée
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Swappeurs (Sélection multiple) */}
                    <div style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 500, position: "relative" }}>
                      <span>Swappeurs (Sélection multiple)</span>
                      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                        <MagnifyingGlass size={16} style={{ position: "absolute", left: "12px", color: "#64748b", pointerEvents: "none" }} />
                        <input
                          type="text"
                          placeholder="Rechercher et ajouter un swappeur..."
                          value={swapperQuery}
                          onFocus={() => setIsSwapperDropdownOpen(true)}
                          onChange={(e) => {
                            setSwapperQuery(e.target.value);
                            setIsSwapperDropdownOpen(true);
                          }}
                          style={{
                            width: "100%",
                            height: "42px",
                            paddingLeft: "36px",
                            paddingRight: "12px",
                            borderRadius: "8px",
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            fontSize: "13.5px",
                            outline: "none"
                          }}
                        />
                      </div>

                      {isSwapperDropdownOpen && (
                        <>
                          <div 
                            style={{ position: "fixed", inset: 0, zIndex: 990 }} 
                            onClick={() => setIsSwapperDropdownOpen(false)} 
                          />
                          <div style={{
                            position: "absolute",
                            top: "calc(100% + 4px)",
                            left: 0,
                            right: 0,
                            background: "#fff",
                            border: "1px solid #cbd5e1",
                            borderRadius: "8px",
                            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15)",
                            maxHeight: "180px",
                            overflowY: "auto",
                            zIndex: 1000,
                            display: "grid",
                            padding: "4px"
                          }}>
                            {filteredSwappers.map((s) => {
                              const isSelected = swapperIds.includes(s.id);
                              return (
                                <button
                                  type="button"
                                  key={s.id}
                                  onClick={() => {
                                    if (isSelected) {
                                      setSwapperIds(swapperIds.filter((id) => id !== s.id));
                                    } else {
                                      setSwapperIds([...swapperIds, s.id]);
                                    }
                                    setSwapperQuery("");
                                    setIsSwapperDropdownOpen(false);
                                  }}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "9px 12px",
                                    borderRadius: "6px",
                                    background: isSelected ? "#f0f9ff" : "transparent",
                                    border: "none",
                                    cursor: "pointer",
                                    textAlign: "left",
                                    fontSize: "13px",
                                    width: "100%",
                                    transition: "background 0.15s"
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = isSelected ? "#f0f9ff" : "#f8fafc")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? "#f0f9ff" : "transparent")}
                                >
                                  <span>
                                    <strong>{s.fullName}</strong> <span style={{ color: "#64748b" }}>({s.email})</span>
                                  </span>
                                  {isSelected && <span style={{ color: "#0284c7", fontWeight: 600, fontSize: "12px" }}>Sélectionné ✓</span>}
                                </button>
                              );
                            })}
                            {filteredSwappers.length === 0 && (
                              <div style={{ padding: "12px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
                                Aucun swappeur trouvé
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      <div style={{ minHeight: "28px", maxHeight: "56px", overflowY: "auto", display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "2px" }}>
                        {swapperIds.map((id) => {
                          const swapper = swappers.find((s) => s.id === id);
                          if (!swapper) return null;
                          return (
                            <span
                              key={id}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                background: "#e0f2fe",
                                color: "#0369a1",
                                padding: "2px 8px",
                                borderRadius: "20px",
                                fontSize: "11.5px",
                                fontWeight: 500,
                                border: "1px solid #bae6fd",
                                height: "24px"
                              }}
                            >
                              {swapper.fullName}
                              <button
                                type="button"
                                onClick={() => setSwapperIds(swapperIds.filter((item) => item !== id))}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "#0369a1", display: "grid", placeItems: "center", padding: 0 }}
                                title="Retirer"
                              >
                                <X size={11} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* Début */}
                    <div style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 500 }}>
                      <span>Début</span>
                      <input
                        required
                        type="datetime-local"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                        style={{ width: "100%", height: "42px", padding: "0 12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#fff" }}
                      />
                    </div>

                    {/* Fin */}
                    <div style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 500 }}>
                      <span>Fin</span>
                      <input
                        required
                        type="datetime-local"
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                        style={{ width: "100%", height: "42px", padding: "0 12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#fff" }}
                      />
                    </div>

                  </div>
                </fieldset>

                <p className="workspace-limit" style={{ marginTop: "16px" }}>
                  Heures de cet appareil : {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                </p>

                <ShiftConstraints state={constraints} />

                <div className="user-form-actions planner-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
                  <button
                    type="button"
                    className="admin-button secondary"
                    disabled={busy}
                    onClick={() => setForm(false)}
                  >
                    Annuler
                  </button>
                  <button
                    className="admin-button"
                    disabled={busy || swapperIds.length === 0}
                  >
                    {busy && <LoaderCircle className="spin" size={16} />}
                    Enregistrer {swapperIds.length > 1 ? `les ${swapperIds.length} affectations` : "le brouillon"}
                  </button>
                </div>
              </form>
            </Modal>
          )}
        </section>
      )}

      {user.role === "STATION_CHIEF" && data.station && (
        <section className="admin-card user-form-card station-editor">
          <h2>QR de pointage</h2>
          <div className="operations-actions">
            {(["CHECKIN", "CHECKOUT"] as const).map((kind) => (
              <button
                type="button"
                className="admin-button secondary"
                key={kind}
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    setImage("");
                    const result = await api<Qr>("/attendance/qr", {
                      stationId: data.station!.id,
                      kind,
                    });
                    setNow(Date.now());
                    setQr(result);
                  }, false)
                }
              >
                {kind === "CHECKIN"
                  ? "Générer le QR de début"
                  : "Générer le QR de fin"}
              </button>
            ))}
          </div>

          {qr && (
            <div className="qr-window">
              <strong>
                {qr.kind === "CHECKIN" ? "Début de service" : "Fin de service"}{" "}
                · {qr.stationName}
              </strong>
              {now < Date.parse(qr.expiresAt) ? (
                <>
                  {image ? (
                    <img
                      className="qr-image"
                      src={image}
                      alt="QR à scanner pour le pointage"
                    />
                  ) : (
                    <LoaderCircle className="spin" size={32} />
                  )}
                  <p>
                    Valide du {formatDate(qr.createdAt, qr.timezone, true)} au{" "}
                    {formatDate(qr.expiresAt, qr.timezone, true)} ({qr.timezone}).
                  </p>
                  <p>
                    Expire dans{" "}
                    {Math.max(
                      0,
                      Math.ceil((Date.parse(qr.expiresAt) - now) / 1000),
                    )}{" "}
                    s.
                  </p>
                </>
              ) : (
                <p role="status">QR expiré. Générez un nouveau code.</p>
              )}
            </div>
          )}
        </section>
      )}

      {user.role === "SWAPPER" &&
        data.shifts.some((s) => !s.attendance?.checkedOutAt) && (
          <section className="admin-card user-form-card station-editor">
            <form onSubmit={punch}>
              <h2>Pointer mon service</h2>
              <fieldset disabled={busy} className="planner-fieldset">
                <div className="user-form-grid">
                  <label>
                    Affectation
                    <select
                      aria-label="Affectation"
                      required
                      value={shiftId}
                      onChange={(e) => setShift(e.target.value)}
                    >
                      <option value="">Sélectionner</option>
                      {data.shifts
                        .filter((s) => !s.attendance?.checkedOutAt)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s?.station?.name} · {formatDate(s?.startTime)}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label>
                    Lien ou code QR
                    <input
                      required
                      autoComplete="off"
                      value={token || ""}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Scannez le QR avec l’appareil photo"
                    />
                  </label>
                </div>
              </fieldset>

              <div className="user-form-actions planner-actions">
                <button className="admin-button" disabled={busy || !shiftId}>
                  {busy && <LoaderCircle className="spin" size={16} />}
                  Confirmer le pointage
                </button>
              </div>
            </form>
          </section>
        )}

      <section className="admin-card">
        <div className="admin-card-heading">
          <h2>
            {data.station?.name ||
              (user.role === "SWAPPER"
                ? "Mes affectations"
                : "Affectations à venir")}
          </h2>
        </div>

        {data.shifts.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Station</th>
                  {user.role !== "SWAPPER" && <th>Swappeur</th>}
                  <th>Début</th>
                  <th>Fin</th>
                  <th>Statut</th>
                  {user.role === "SUPERVISOR" && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {data.shifts.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s?.station?.name}</strong>
                    </td>
                    {user.role !== "SWAPPER" && <td>{s?.swapper?.fullName}</td>}
                    <td>{formatDate(s?.startTime)}</td>
                    <td>{formatDate(s?.endTime)}</td>
                    <td>
                      <span
                        className={`admin-badge ${s.publishedAt ? "active" : "draft"}`}
                      >
                        {s.attendance?.checkedOutAt
                          ? "Terminé"
                          : s.attendance
                          ? s.attendance.isLate
                            ? "Présent · en retard"
                            : "Présent"
                          : s.publishedAt
                          ? "Publié"
                          : "Brouillon"}
                      </span>
                    </td>
                    {user.role === "SUPERVISOR" && (
                      <td>
                        {!s.publishedAt && (
                          <button
                            type="button"
                            className="admin-button secondary small"
                            disabled={busy}
                            onClick={() =>
                              act(() => api("/shifts/" + s.id + "/publish", {}))
                            }
                          >
                            Publier
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-empty">
            <Clock3 size={36} />
            <h3>Aucune affectation à venir</h3>
          </div>
        )}

        {data.shifts.length === data.limit && (
          <p className="workspace-limit">
            Les {data.limit} prochaines affectations sont affichées.
          </p>
        )}
      </section>
    </>
  );
}