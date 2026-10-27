import { useState, useEffect, useRef } from "react";
import { notify } from "../../ui/Toast";
import {
  ShiftTemplates,
  shiftBreakError,
  shiftDuration,
} from "./ShiftTemplates";
import { api, usingMock } from "../../api/auth-api";
import { exportToExcel } from "../../utils/excelExport";
import { StepperModal, type StepItem } from "../../ui/StepperModal";
import { Modal } from "../../ui/Modal";
import { Select } from "../../ui/Select";
import {
  DEFAULT_LAT,
  DEFAULT_LNG,
  MAP_ATTRIBUTION,
  MAP_TILE_OPTIONS,
  MAP_TILE_URL,
  MapLocationPicker,
  loadLeaflet,
  stationMarkerIcon,
  zoomForRadius,
} from "./mapPicker";
import "./mapPickerStyles.css";
import {
  Building2,
  Clock3,
  DownloadSimple,
  LoaderCircle,
  MapPin,
  Search,
  UserRound,
} from "../../ui/icons";
import {
  CaretDownIcon,
  ListIcon,
  PencilSimpleIcon,
  PhoneIcon,
  PlusIcon,
  SquaresFourIcon,
} from "../../ui/icons";
import "./station-manager.css";

export type StationData = {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location: string | null;
  timezone: string;
  contactName: string | null;
  contactPhone: string | null;
  isActive: boolean;
  latenessToleranceMinutes: number;
  geofenceRadiusMeters: number;
  enforceMinRest: boolean;
  minRestHours: number;
  weeklyHoursLimit: number;
  blockPublishingWithVacancies: boolean;
};

const emptyForm = {
  name: "",
  address: "",
  city: "Douala",
  latitude: 4.051056 as number | string,
  longitude: 9.708533 as number | string,
  location: "",
  timezone: "Africa/Douala",
  contactName: "",
  contactPhone: "",
  latenessToleranceMinutes: 0,
  geofenceRadiusMeters: 150,
  enforceMinRest: true,
  minRestHours: 8,
  weeklyHoursLimit: 48,
  blockPublishingWithVacancies: false,
};

const blankStationForm: typeof emptyForm = {
  name: "",
  address: "",
  city: "",
  latitude: "",
  longitude: "",
  location: "",
  timezone: "",
  contactName: "",
  contactPhone: "",
  latenessToleranceMinutes: "" as unknown as number,
  geofenceRadiusMeters: "" as unknown as number,
  enforceMinRest: false,
  minRestHours: "" as unknown as number,
  weeklyHoursLimit: "" as unknown as number,
  blockPublishingWithVacancies: false,
};

const blankSharedShift = {
  label: "",
  startTime: "",
  endTime: "",
  breakStart: "",
  breakEnd: "",
  stationIds: [] as string[],
};

/* ============================================================
   Carte globale des stations
   ============================================================ */
function StationsMapView({
  stations,
  onEditStation,
}: {
  stations: StationData[];
  onEditStation: (s: StationData) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [selectedStation, setSelectedStation] = useState<StationData | null>(
    null,
  );
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    let disposed = false;
    let mapInstance: any = null;
    const initGlobalMap = (L: any) => {
      if (!L || !mapRef.current) return;

      if ((mapRef.current as any)._leaflet_id) {
        (mapRef.current as any)._leaflet_id = null;
        mapRef.current.innerHTML = "";
      }

      mapInstance = L.map(mapRef.current).setView(
        [DEFAULT_LAT, DEFAULT_LNG],
        13,
      );

      L.tileLayer(MAP_TILE_URL, {
        ...MAP_TILE_OPTIONS,
        maxZoom: 18,
        attribution: MAP_ATTRIBUTION,
      }).addTo(mapInstance);

      const validStations = (stations || []).filter(
        (s) => s?.latitude != null && s?.longitude != null,
      );

      if (validStations.length > 0) {
        const bounds = L.latLngBounds([]);

        validStations.forEach((s) => {
          const lat = Number(s.latitude);
          const lng = Number(s.longitude);
          bounds.extend([lat, lng]);

          const marker = L.marker([lat, lng], {
            icon: stationMarkerIcon(L),
          }).addTo(mapInstance);
          // Périmètre de pointage : on voit immédiatement la zone autorisée.
          L.circle([lat, lng], {
            radius: Number(s.geofenceRadiusMeters) || 150,
            color: "#2d6cdf",
            weight: 1.5,
            fillColor: "#2d6cdf",
            fillOpacity: 0.1,
          }).addTo(mapInstance);

          marker.bindPopup(`
            <div style="font-family: inherit; padding: 4px; min-width: 160px;">
              <strong id="popup-title-${s?.id}" style="font-size: 14px; color: #0b1e36; cursor: pointer; text-decoration: underline;">${s?.name}</strong><br/>
              <span style="font-size: 12px; color: #64748b;">${s?.city || "Ville non précisée"}</span><br/>
              <span style="font-size: 11px; display: inline-block; margin-top: 4px; padding: 2px 6px; background: ${
                s?.isActive ? "#eef7f1" : "#fef3c7"
              }; color: ${s?.isActive ? "#358260" : "#d97706"}; border-radius: 4px;">
                ${s?.isActive ? "Active" : "Inactive"}
              </span>
            </div>
          `);

          marker.on("popupopen", () => {
            const titleEl = document.getElementById(`popup-title-${s?.id}`);
            if (titleEl) {
              titleEl.onclick = () => setSelectedStation(s);
            }
          });
        });

        // Cadrage serré : avec une seule station, `fitBounds` sur un point
        // unique dézoomait très loin (grandes zones vides).
        if (validStations.length === 1) {
          mapInstance.setView(bounds.getCenter(), 16);
        } else {
          mapInstance.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
        }
      }

      setTimeout(() => {
        if (mapInstance) mapInstance.invalidateSize();
      }, 250);
    };

    void loadLeaflet()
      .then((L) => {
        if (!disposed) initGlobalMap(L);
      })
      .catch((error: Error) => {
        if (!disposed) setMapError(error.message);
      });

    return () => {
      disposed = true;
      if (mapInstance) mapInstance.remove();
    };
  }, [stations]);

  return (
    <div className="admin-card stations-map-card">
      <div className="stations-map-head">
        <h3>Cartographie des stations</h3>
        <p>
          Sélectionnez une station depuis son marqueur pour afficher sa fiche.
        </p>
      </div>
      <div ref={mapRef} className="stations-map-canvas" />
      {mapError && (
        <p className="error-message" role="status">
          {mapError}
        </p>
      )}

      <Modal
        open={selectedStation !== null}
        onClose={() => setSelectedStation(null)}
        title={selectedStation?.name || "Détail de la station"}
        subtitle={selectedStation?.timezone}
        footer={
          selectedStation ? (
            <>
              <button
                type="button"
                className="admin-button secondary"
                onClick={() => setSelectedStation(null)}
              >
                Fermer
              </button>
              <button
                type="button"
                className="admin-button"
                onClick={() => {
                  const station = selectedStation;
                  setSelectedStation(null);
                  onEditStation(station);
                }}
              >
                <PencilSimpleIcon size={14} />
                Modifier la station
              </button>
            </>
          ) : undefined
        }
      >
        {selectedStation && (
          <div className="stations-map-panel-content">
            <div className="stepper-summary-card stations-map-summary">
              <div className="summary-row">
                <span>Ville & Adresse :</span>
                <strong>
                  {selectedStation?.city || "—"} (
                  {selectedStation?.address ||
                    selectedStation?.location ||
                    "Non précisée"}
                  )
                </strong>
              </div>
              <div className="summary-row">
                <span>Coordonnées GPS :</span>
                <strong>
                  {selectedStation?.latitude != null &&
                  selectedStation?.longitude != null
                    ? `${Number(selectedStation.latitude).toFixed(4)}, ${Number(selectedStation.longitude).toFixed(4)}`
                    : "Non géolocalisée"}
                </strong>
              </div>
              <div className="summary-row">
                <span>Responsable :</span>
                <strong>
                  {selectedStation?.contactName || "—"}{" "}
                  {selectedStation?.contactPhone
                    ? `(${selectedStation.contactPhone})`
                    : ""}
                </strong>
              </div>
              <div className="summary-row">
                <span>Tolérance / Repos / Max :</span>
                <strong>
                  {selectedStation?.latenessToleranceMinutes}m /{" "}
                  {selectedStation?.enforceMinRest === false
                    ? "repos libre"
                    : `${selectedStation?.minRestHours}h`}{" "}
                  / {selectedStation?.weeklyHoursLimit}h
                </strong>
              </div>
              <div className="summary-row">
                <span>Statut :</span>
                <strong
                  className={
                    selectedStation?.isActive
                      ? "stations-map-status-active"
                      : "stations-map-status-inactive"
                  }
                >
                  {selectedStation?.isActive ? "Active" : "Inactive"}
                </strong>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ============================================================
   Gestionnaire Principal : StationManager
   ============================================================ */
export function StationManager({
  stations,
  activeTab,
  onChanged,
}: {
  stations: StationData[];
  activeTab: "list" | "map";
  onChanged: () => void;
}) {
  const [templateStation, setTemplateStation] = useState<StationData | null>(
    null,
  );
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [cityFilter, setCityFilter] = useState("ALL");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [confirm, setConfirm] = useState<StationData | null>(null);
  const [sharedShift, setSharedShift] = useState<
    typeof blankSharedShift | null
  >(null);

  const set = (key: string, value: unknown) =>
    setForm((old) => (old ? { ...old, [key]: value } : old));

  function edit(station?: StationData) {
    setId(station?.id || "");
    setForm(
      station
        ? {
            ...station,
            address: station.address || "",
            city: station.city || "Douala",
            latitude: station.latitude ?? DEFAULT_LAT,
            longitude: station.longitude ?? DEFAULT_LNG,
            location: station.location || "",
            contactName: station.contactName || "",
            contactPhone: station.contactPhone || "",
            geofenceRadiusMeters: station.geofenceRadiusMeters ?? 150,
            enforceMinRest: station.enforceMinRest !== false,
          }
        : { ...blankStationForm },
    );
    setError("");
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      // Garde-fou : une adresse saisie sans point de repère enregistrait les
      // coordonnées par défaut (toutes les stations au même endroit). On exige
      // un emplacement réel avant l'enregistrement.
      const latitude = form.latitude !== "" ? Number(form.latitude) : null;
      const longitude = form.longitude !== "" ? Number(form.longitude) : null;
      if (
        latitude === null ||
        longitude === null ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        setError(
          "Placez le repère sur la carte (ou saisissez une adresse reconnue) : l’emplacement GPS est obligatoire.",
        );
        setBusy(false);
        return;
      }
      if (!form.address.trim()) {
        setError("Renseignez l’adresse de la station.");
        setBusy(false);
        return;
      }
      const payload = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        latitude: form.latitude !== "" ? Number(form.latitude) : null,
        longitude: form.longitude !== "" ? Number(form.longitude) : null,
        location: form.location.trim() || null,
        timezone: form.timezone,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        latenessToleranceMinutes: Number(form.latenessToleranceMinutes),
        geofenceRadiusMeters: Number(form.geofenceRadiusMeters),
        minRestHours: Number(form.minRestHours),
        weeklyHoursLimit: Number(form.weeklyHoursLimit),
        ...(usingMock
          ? {
              enforceMinRest: Boolean(form.enforceMinRest),
              blockPublishingWithVacancies: Boolean(
                form.blockPublishingWithVacancies,
              ),
            }
          : {}),
      };

      await api(
        "/stations" + (id ? "/" + id : ""),
        payload,
        id ? "PATCH" : undefined,
      );
      setForm(null);
      notify("Station enregistrée avec succès.", "success");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (!confirm) return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/stations/" +
          confirm.id +
          "/" +
          (confirm.isActive ? "deactivate" : "activate"),
        {},
        "PATCH",
      );
      setConfirm(null);
      notify("Statut de la station mis à jour.", "success");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveSharedShift() {
    if (!sharedShift) return;
    const breakError = shiftBreakError(
      sharedShift.startTime,
      sharedShift.endTime,
      sharedShift.breakStart,
      sharedShift.breakEnd,
    );
    if (
      !sharedShift.label.trim() ||
      !shiftDuration(sharedShift.startTime, sharedShift.endTime) ||
      breakError ||
      !sharedShift.stationIds.length
    ) {
      setError(
        breakError ||
          "Renseignez le modèle et choisissez au moins une station.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        label: sharedShift.label.trim(),
        startTime: sharedShift.startTime,
        endTime: sharedShift.endTime,
        breakStart: sharedShift.breakStart || null,
        breakEnd: sharedShift.breakEnd || null,
      };
      if (usingMock) {
        await api("/shift-templates/apply", {
          stationIds: sharedShift.stationIds,
          ...payload,
        });
      } else {
        const remaining: string[] = [];
        let applied = 0;
        for (const stationId of sharedShift.stationIds) {
          try {
            await api(`/stations/${stationId}/shift-templates`, payload);
            applied += 1;
          } catch {
            remaining.push(stationId);
          }
        }
        if (remaining.length) {
          setSharedShift({ ...sharedShift, stationIds: remaining });
          throw new Error(
            `Modèle appliqué à ${applied} ${applied === 1 ? "station" : "stations"}. Les autres n’ont pas pu être enregistrées ; réessayez pour celles-ci.`,
          );
        }
      }
      notify(
        `Modèle appliqué à ${sharedShift.stationIds.length} station${sharedShift.stationIds.length === 1 ? "" : "s"}.`,
        "success",
      );
      setSharedShift(null);
      onChanged();
    } catch (reason) {
      const message = (reason as Error).message;
      setError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  }

  const cities = Array.from(
    new Set((stations || []).map((s) => s?.city).filter(Boolean)),
  );
  const activeStations = (stations || []).filter((station) => station.isActive);

  const filteredStations = (stations || []).filter((s) => {
    if (!s) return false;
    const matchesQuery = (
      (s.name || "") +
      " " +
      (s.city || "") +
      " " +
      (s.address || s.location || "") +
      " " +
      (s.contactName || "")
    )
      .toLowerCase()
      .includes((query || "").toLowerCase());

    const matchesCity = cityFilter === "ALL" || s.city === cityFilter;
    return matchesQuery && matchesCity;
  });

  function handleExportExcel() {
    if (!filteredStations.length) return;
    exportToExcel<StationData>({
      data: filteredStations,
      filename: "stations_uswap",
      sheetName: "Stations",
      columns: [
        {
          header: "Nom de la station",
          key: (s: StationData) => s?.name || "",
          width: 25,
        },
        { header: "Ville", key: (s: StationData) => s?.city || "—", width: 15 },
        {
          header: "Adresse",
          key: (s: StationData) => s?.address || s?.location || "—",
          width: 30,
        },
        {
          header: "Coordonnées GPS",
          key: (s: StationData) =>
            s?.latitude != null && s?.longitude != null
              ? `${s.latitude}, ${s.longitude}`
              : "—",
          width: 25,
        },
        {
          header: "Contact responsable",
          key: (s: StationData) => s?.contactName || "—",
          width: 22,
        },
        {
          header: "Téléphone",
          key: (s: StationData) => s?.contactPhone || "—",
          width: 18,
        },
        {
          header: "Tolérance retard (min)",
          key: (s: StationData) => s?.latenessToleranceMinutes ?? 0,
          width: 20,
        },
        {
          header: "Repos minimal (h)",
          key: (s: StationData) => s?.minRestHours ?? 0,
          width: 18,
        },
        {
          header: "Limite hebdo (h)",
          key: (s: StationData) => s?.weeklyHoursLimit ?? 0,
          width: 18,
        },
        {
          header: "Statut",
          key: (s: StationData) => (s?.isActive ? "Active" : "Inactive"),
          width: 12,
        },
      ],
    });
    notify("Exportation du fichier Excel réussie.", "success");
  }

  const stationSteps: StepItem[] = form
    ? [
        {
          id: "location",
          label: "Localisation",
          isValid: () =>
            !!form?.name?.trim() &&
            !!form?.timezone?.trim() &&
            !!form?.address?.trim() &&
            form?.latitude !== "" &&
            form?.longitude !== "",
          content: (
            <div className="stepper-form-layout">
              <div className="stepper-field-group">
                <label>NOM DE LA STATION *</label>
                <input
                  required
                  maxLength={120}
                  placeholder="ex: Station Bonamoussadi"
                  value={String(form?.name || "")}
                  onChange={(e) => set("name", e.target.value)}
                />
              </div>

              <div className="user-form-grid-2">
                <div className="stepper-field-group">
                  <label>VILLE</label>
                  <input
                    maxLength={100}
                    placeholder="ex: Douala"
                    value={String(form?.city || "")}
                    onChange={(e) => set("city", e.target.value)}
                  />
                </div>

                <div className="stepper-field-group">
                  <label>FUSEAU HORAIRE *</label>
                  <input
                    required
                    value={String(form?.timezone || "")}
                    onChange={(e) => set("timezone", e.target.value)}
                  />
                </div>
              </div>

              <MapLocationPicker
                address={String(form?.address || "")}
                latitude={form?.latitude ?? ""}
                longitude={form?.longitude ?? ""}
                geofenceRadiusMeters={Number(form?.geofenceRadiusMeters) || 150}
                onSelectLocation={(lat, lng) => {
                  set("latitude", lat);
                  set("longitude", lng);
                }}
                onSelectAddress={(addr, lat, lng) => {
                  set("address", addr);
                  set("latitude", lat);
                  set("longitude", lng);
                  // La ville suit l'adresse reconnue (ex. « Douala, Cameroun »),
                  // sans écraser une saisie manuelle volontaire.
                  const known = [
                    "Douala",
                    "Yaoundé",
                    "Yaounde",
                    "Bafoussam",
                    "Bamenda",
                    "Garoua",
                    "Kribi",
                    "Limbe",
                    "Limbé",
                    "Buea",
                    "Kumba",
                    "Ngaoundéré",
                    "Ngaoundere",
                    "Bafang",
                    "Ebolowa",
                    "Bertoua",
                  ].find((city) => addr.includes(city));
                  if (known) set("city", known);
                }}
              />
            </div>
          ),
        },
        {
          id: "contact",
          label: "Contact & Responsable",
          content: (
            <div className="stepper-form-layout">
              <div className="stepper-field-group">
                <label>NOM DU RESPONSABLE DE STATION</label>
                <input
                  placeholder="ex: Jalil KETOU"
                  value={String(form?.contactName || "")}
                  onChange={(e) => set("contactName", e.target.value)}
                />
              </div>

              <div className="stepper-field-group">
                <label>NUMÉRO DE TÉLÉPHONE DU CONTACT</label>
                <input
                  placeholder="ex: 693542271"
                  value={String(form?.contactPhone || "")}
                  onChange={(e) => set("contactPhone", e.target.value)}
                />
              </div>
            </div>
          ),
        },
        {
          id: "rules",
          label: "Règles & Sécurité",
          isValid: () =>
            String(form.latenessToleranceMinutes).trim() !== "" &&
            Number(form.latenessToleranceMinutes) >= 0 &&
            (!usingMock ||
              (String(form.geofenceRadiusMeters).trim() !== "" &&
                Number(form.geofenceRadiusMeters) >= 0)) &&
            (!form.enforceMinRest ||
              (String(form.minRestHours).trim() !== "" &&
                Number(form.minRestHours) > 0)) &&
            String(form.weeklyHoursLimit).trim() !== "" &&
            Number(form.weeklyHoursLimit) > 0,
          content: (
            <div className="stepper-form-layout">
              <div className="user-form-grid-2">
                <div className="stepper-field-group">
                  <label>TOLÉRANCE RETARD (MINUTES)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={1}
                    value={form?.latenessToleranceMinutes ?? 0}
                    onChange={(e) =>
                      set(
                        "latenessToleranceMinutes",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </div>

                <div
                  className={`stepper-field-group${form.enforceMinRest ? "" : " is-disabled"}`}
                >
                  <label>REPOS MINIMAL (HEURES)</label>
                  <input
                    type="number"
                    required={form.enforceMinRest}
                    disabled={!form.enforceMinRest}
                    min={1}
                    step={1}
                    value={form?.minRestHours ?? 0}
                    onChange={(e) =>
                      set(
                        "minRestHours",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </div>
              </div>

              <div className="user-form-grid-2">
                <div className="stepper-field-group">
                  <label>LIMITE HEBDOMADAIRE (HEURES)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    step={1}
                    value={form?.weeklyHoursLimit ?? 0}
                    onChange={(e) =>
                      set(
                        "weeklyHoursLimit",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </div>

                <div className="stepper-field-group">
                  <label>PÉRIMÈTRE DE POINTAGE (MÈTRES)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={1}
                    value={form?.geofenceRadiusMeters ?? 150}
                    onChange={(e) =>
                      set(
                        "geofenceRadiusMeters",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                  <small>
                    0 désactive la limite de distance. Sinon, le swappeur doit
                    se trouver dans le rayon indiqué pour pointer.
                  </small>
                </div>
              </div>

              <label className="station-rule-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(form?.enforceMinRest)}
                  onChange={(e) => set("enforceMinRest", e.target.checked)}
                />
                <span>
                  <strong>Contrôler le repos entre deux shifts</strong>
                  <small>
                    Lorsqu’elle est active, cette règle bloque une affectation
                    qui ne respecte pas le repos minimal indiqué.
                  </small>
                </span>
              </label>

              <label className="station-rule-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(form?.blockPublishingWithVacancies)}
                  onChange={(e) =>
                    set("blockPublishingWithVacancies", e.target.checked)
                  }
                />
                <span>
                  <strong>Exiger une couverture complète</strong>
                  <small>
                    La publication sera bloquée tant qu’un poste du planning
                    reste sans swappeur.
                  </small>
                </span>
              </label>
              {usingMock && (
                <p className="planner-form-note">
                  Les règles et le périmètre de pointage mis à jour s’appliquent
                  aussi aux shifts déjà créés. Les horaires et pauses déjà
                  planifiés restent inchangés ; vérifiez les plannings publiés
                  si vous durcissez une règle.
                </p>
              )}
            </div>
          ),
        },
        {
          id: "summary",
          label: "Récapitulatif",
          content: (
            <div className="stepper-form-layout">
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              <div className="stepper-summary-card">
                <div className="summary-row">
                  <span>Nom de la station :</span>
                  <strong>{form?.name || "—"}</strong>
                </div>
                <div className="summary-row">
                  <span>Ville & Fuseau :</span>
                  <strong>
                    {form?.city || "—"} ({form?.timezone || "—"})
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Adresse :</span>
                  <strong>{form?.address || "Non renseignée"}</strong>
                </div>
                <div className="summary-row">
                  <span>Coordonnées GPS :</span>
                  <strong>
                    {form?.latitude !== "" && form?.longitude !== ""
                      ? `${Number(form?.latitude || 0).toFixed(5)}, ${Number(form?.longitude || 0).toFixed(5)}`
                      : "Non géolocalisée"}
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Responsable :</span>
                  <strong>
                    {form?.contactName || "Aucun"}{" "}
                    {form?.contactPhone ? `(${form.contactPhone})` : ""}
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Tolérance retard :</span>
                  <strong>{form?.latenessToleranceMinutes ?? 0} min</strong>
                </div>
                <div className="summary-row">
                  <span>Repos min. / Limite hebdo :</span>
                  <strong>
                    {form?.enforceMinRest
                      ? `${form?.minRestHours ?? 0}h minimum`
                      : "Contrôle désactivé"}{" "}
                    · {form?.weeklyHoursLimit ?? 0}h max
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Postes non couverts :</span>
                  <strong>
                    {form?.blockPublishingWithVacancies
                      ? "Publication bloquée"
                      : "Publication avec avertissement"}
                  </strong>
                </div>
              </div>
              <p className="station-summary-note">
                Vérifiez les informations ci-dessus puis cliquez sur le bouton
                de validation final pour créer ou mettre à jour la station.
              </p>
            </div>
          ),
        },
      ]
    : [];

  return (
    <div className="station-manager">
      <StepperModal
        open={form !== null}
        title={id ? "Modifier la station" : "Nouvelle station"}
        icon={<Building2 size={20} />}
        steps={stationSteps}
        submitLabel={id ? "Mettre à jour" : "Valider et créer"}
        busy={busy}
        onClose={() => setForm(null)}
        onSubmit={save}
      />

      <Modal
        open={!!confirm}
        onClose={() => !busy && setConfirm(null)}
        title={
          confirm?.isActive ? "Désactiver la station" : "Réactiver la station"
        }
      >
        {confirm && (
          <div className="station-confirm">
            <p>
              {confirm.isActive
                ? `Voulez-vous désactiver la station « ${confirm.name} » ?`
                : `Voulez-vous réactiver la station « ${confirm.name} » ?`}
            </p>
            <div className="station-confirm-actions">
              <button
                type="button"
                className="admin-button secondary"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Annuler
              </button>
              <button
                type="button"
                className={`admin-button ${confirm?.isActive ? "danger" : ""}`}
                disabled={busy}
                onClick={toggle}
              >
                {busy && <LoaderCircle className="spin" size={16} />}
                Confirmer
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={sharedShift !== null}
        size="lg"
        onClose={() => !busy && setSharedShift(null)}
        title="Créer un modèle de shift"
        subtitle="Définissez le créneau une seule fois, puis choisissez les stations qui pourront l’utiliser."
      >
        {sharedShift && (
          <form
            className="shared-shift-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSharedShift();
            }}
          >
            <div className="user-form-grid shift-template-form-grid">
              <label className="wide">
                Libellé
                <input
                  autoFocus
                  required
                  placeholder="Ex. Équipe du matin"
                  value={sharedShift.label}
                  onChange={(event) =>
                    setSharedShift({
                      ...sharedShift,
                      label: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Heure de début
                <input
                  type="time"
                  required
                  value={sharedShift.startTime}
                  onChange={(event) =>
                    setSharedShift({
                      ...sharedShift,
                      startTime: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Heure de fin
                <input
                  type="time"
                  required
                  value={sharedShift.endTime}
                  onChange={(event) =>
                    setSharedShift({
                      ...sharedShift,
                      endTime: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Début de pause
                <input
                  type="time"
                  value={sharedShift.breakStart}
                  onChange={(event) =>
                    setSharedShift({
                      ...sharedShift,
                      breakStart: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Fin de pause
                <input
                  type="time"
                  value={sharedShift.breakEnd}
                  onChange={(event) =>
                    setSharedShift({
                      ...sharedShift,
                      breakEnd: event.target.value,
                    })
                  }
                />
              </label>
            </div>

            <fieldset className="shared-shift-stations">
              <div className="shared-shift-stations-head">
                <div>
                  <legend>Stations concernées</legend>
                  <p>
                    Le modèle restera modifiable séparément dans chaque station.
                  </p>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setSharedShift({
                      ...sharedShift,
                      stationIds:
                        sharedShift.stationIds.length === activeStations.length
                          ? []
                          : activeStations.map((station) => station.id),
                    })
                  }
                >
                  {sharedShift.stationIds.length === activeStations.length
                    ? "Tout désélectionner"
                    : "Tout sélectionner"}
                </button>
              </div>
              <div>
                {activeStations.map((station) => (
                  <label key={station.id}>
                    <input
                      type="checkbox"
                      checked={sharedShift.stationIds.includes(station.id)}
                      onChange={(event) =>
                        setSharedShift({
                          ...sharedShift,
                          stationIds: event.target.checked
                            ? [...sharedShift.stationIds, station.id]
                            : sharedShift.stationIds.filter(
                                (id) => id !== station.id,
                              ),
                        })
                      }
                    />
                    <span>
                      <strong>{station.name}</strong>
                      <small>
                        {station.city ||
                          station.address ||
                          "Adresse non renseignée"}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <div className="modal-form-actions">
              <button
                type="button"
                className="admin-button secondary"
                disabled={busy}
                onClick={() => setSharedShift(null)}
              >
                Annuler
              </button>
              <button
                type="submit"
                className="admin-button primary-cta"
                disabled={busy}
              >
                Appliquer aux stations
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal dédié pour ouvrir ShiftTemplates en surimpression */}
      <Modal
        open={templateStation !== null}
        size="xl"
        onClose={() => setTemplateStation(null)}
        title={
          templateStation
            ? `Modèles de shifts — ${templateStation.name}`
            : "Modèles de shifts"
        }
      >
        <div className="station-templates-modal-body">
          {templateStation && (
            <ShiftTemplates
              station={
                (stations || []).find((s) => s?.id === templateStation.id) ||
                templateStation
              }
            />
          )}
        </div>
      </Modal>

      {activeTab === "map" ? (
        <StationsMapView
          stations={stations || []}
          onEditStation={(s) => edit(s)}
        />
      ) : (
        <>
          <div className="operations-actions stations-toolbar">
            <div className="admin-search">
              <Search size={16} />
              <input
                aria-label="Rechercher une station"
                placeholder="Rechercher par nom, ville, adresse..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {cities.length > 0 && (
              <div className="stations-city-filter">
                <Select
                  size="sm"
                  value={cityFilter}
                  ariaLabel="Filtrer les stations par ville"
                  width="190px"
                  onChange={(value) => setCityFilter(String(value))}
                  options={[
                    { value: "ALL", label: "Toutes les villes" },
                    ...cities.map((city) => ({
                      value: city || "",
                      label: city || "",
                    })),
                  ]}
                />
              </div>
            )}

            <div className="stations-toolbar-actions">
              <div className="segmented-control stations-view-toggle">
                <button
                  type="button"
                  aria-pressed={viewMode === "table"}
                  onClick={() => setViewMode("table")}
                  className={`stations-view-option${viewMode === "table" ? " is-selected" : ""}`}
                >
                  <ListIcon size={14} />
                  <span>Tableau</span>
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                  className={`stations-view-option${viewMode === "grid" ? " is-selected" : ""}`}
                >
                  <SquaresFourIcon size={14} />
                  <span>Grille</span>
                </button>
              </div>

              <button
                type="button"
                className="admin-button secondary small"
                onClick={() => {
                  setError("");
                  setSharedShift({ ...blankSharedShift, stationIds: [] });
                }}
              >
                <Clock3 size={15} />
                <span>Créer un modèle de shift</span>
              </button>

              <button
                type="button"
                className="admin-button secondary small"
                onClick={handleExportExcel}
                disabled={!filteredStations?.length}
              >
                <DownloadSimple size={15} />
                <span>Excel</span>
              </button>

              <button
                type="button"
                className="admin-button small primary-cta"
                onClick={() => edit()}
              >
                <PlusIcon size={15} weight="bold" />
                <span>Créer une station</span>
              </button>
            </div>
          </div>

          {viewMode === "table" ? (
            <div className="admin-card">
              <div className="admin-table-wrap">
                <table className="admin-table station-compact-table mobile-card-table">
                  <thead>
                    <tr>
                      <th>Station</th>
                      <th>Ville & Adresse</th>
                      <th>GPS</th>
                      <th>Responsable</th>
                      <th>Contraintes</th>
                      <th>Statut</th>
                      <th className="station-cell-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStations.map((s) => (
                      <tr key={s?.id}>
                        <td data-label="Station">
                          <div className="admin-person">
                            <span className="admin-stat-icon orange station-person-icon">
                              <Building2 size={16} />
                            </span>
                            <div>
                              <strong>{s?.name}</strong>
                              <span>{s?.timezone}</span>
                            </div>
                          </div>
                        </td>
                        <td
                          data-label="Ville & adresse"
                          title={[s?.city, s?.address || s?.location]
                            .filter(Boolean)
                            .join(" — ")}
                        >
                          <div className="station-cell-city">
                            <strong>{s?.city || "Non spécifiée"}</strong>
                            <span>{s?.address || s?.location || "—"}</span>
                          </div>
                        </td>
                        <td data-label="GPS">
                          {s?.latitude != null && s?.longitude != null ? (
                            <a
                              href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-button station-map-link"
                            >
                              <MapPin size={13} />
                              <span>
                                {Number(s.latitude).toFixed(2)},{" "}
                                {Number(s.longitude).toFixed(2)}
                              </span>
                            </a>
                          ) : (
                            <span className="station-gps-empty">—</span>
                          )}
                        </td>
                        <td data-label="Responsable">
                          <div
                            className="station-cell-contact"
                            title={[s?.contactName, s?.contactPhone]
                              .filter(Boolean)
                              .join(" · ")}
                          >
                            <span>{s?.contactName || "—"}</span>
                            {s?.contactPhone && <span>{s.contactPhone}</span>}
                          </div>
                        </td>
                        <td data-label="Contraintes">
                          <div className="code-chips station-code-chips">
                            <code>
                              Tol: {s?.latenessToleranceMinutes ?? 0}m
                            </code>
                            <code>
                              Repos:{" "}
                              {s?.enforceMinRest === false
                                ? "libre"
                                : `${s?.minRestHours ?? 0}h`}
                            </code>
                            <code>Max: {s?.weeklyHoursLimit ?? 0}h</code>
                          </div>
                        </td>
                        <td data-label="Statut">
                          <span
                            className={`admin-badge ${s?.isActive ? "active" : "draft"}`}
                          >
                            {s?.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td data-label="Actions" className="station-cell-right">
                          <div className="station-row-actions">
                            <button
                              type="button"
                              className="admin-button secondary small"
                              title="Gérer les modèles de shifts"
                              onClick={() => setTemplateStation(s)}
                            >
                              <Clock3 size={13} />
                              <span>Shifts</span>
                            </button>
                            <button
                              type="button"
                              className="admin-button secondary small icon-only"
                              onClick={() => edit(s)}
                            >
                              <PencilSimpleIcon size={13} />
                            </button>
                            <button
                              type="button"
                              className={`station-toggle-btn ${s?.isActive ? "danger" : "success"}`}
                              onClick={() => setConfirm(s)}
                            >
                              {s?.isActive ? "Désactiver" : "Activer"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="admin-station-grid">
              {filteredStations.map((s) => (
                <section className="admin-card admin-station" key={s?.id}>
                  <div className="admin-station-top">
                    <span className="admin-stat-icon orange">
                      <Building2 size={22} />
                    </span>
                    <span
                      className={`admin-badge ${s?.isActive ? "active" : "draft"}`}
                    >
                      {s?.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <div className="station-main-info">
                    <h2>{s?.name}</h2>
                    <p className="station-location">
                      <MapPin size={15} />
                      <span>
                        {s?.city ? `${s.city} — ` : ""}
                        {s?.address || s?.location || "Adresse non renseignée"}
                      </span>
                    </p>
                  </div>

                  <div className="station-contact-strip">
                    <div className="contact-item">
                      <UserRound size={14} />
                      <span>{s?.contactName || "Contact non renseigné"}</span>
                    </div>
                    {s?.contactPhone && (
                      <div className="contact-item">
                        <PhoneIcon size={14} />
                        <span>{s.contactPhone}</span>
                      </div>
                    )}
                  </div>

                  <details className="station-rules-details">
                    <summary className="station-rules-summary">
                      <span>Règles & coordonnées GPS</span>
                      <CaretDownIcon size={16} className="caret-icon" />
                    </summary>

                    <div className="station-rules-grid">
                      <div className="rule-chip full-width">
                        <span className="rule-label">Position GPS (Maps)</span>
                        <strong className="rule-value">
                          {s?.latitude != null && s?.longitude != null ? (
                            <a
                              href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              className="station-rules-map-link"
                            >
                              {Number(s.latitude).toFixed(4)},{" "}
                              {Number(s.longitude).toFixed(4)} (Ouvrir Maps)
                            </a>
                          ) : (
                            "Non configuré"
                          )}
                        </strong>
                      </div>
                      <div className="rule-chip">
                        <span className="rule-label">Tolérance retard</span>
                        <strong className="rule-value">
                          {s?.latenessToleranceMinutes ?? 0} min
                        </strong>
                      </div>
                      <div className="rule-chip">
                        <span className="rule-label">Repos min.</span>
                        <strong className="rule-value">
                          {s?.enforceMinRest === false
                            ? "Non contrôlé"
                            : `${s?.minRestHours ?? 0} h`}
                        </strong>
                      </div>
                    </div>
                  </details>

                  <div className="station-card-actions">
                    <button
                      type="button"
                      className="admin-button secondary small"
                      onClick={() => setTemplateStation(s)}
                    >
                      <Clock3 size={15} />
                      Modèles de shifts
                    </button>
                    <button
                      type="button"
                      className="admin-button secondary small"
                      onClick={() => edit(s)}
                    >
                      <PencilSimpleIcon size={15} />
                      Modifier
                    </button>
                    <button
                      type="button"
                      className={`station-toggle-btn ${s?.isActive ? "danger" : "success"}`}
                      onClick={() => setConfirm(s)}
                    >
                      {s?.isActive ? "Désactiver" : "Réactiver"}
                    </button>
                  </div>
                </section>
              ))}
            </div>
          )}

          {!filteredStations?.length && (
            <div className="admin-card admin-empty">
              <Building2 size={32} />
              <h2>
                {query
                  ? "Aucune station ne correspond"
                  : "Aucune station enregistrée"}
              </h2>
              <p>
                {query
                  ? "Modifiez vos termes de recherche ou sélectionnez une autre ville."
                  : "Créez votre première station pour configurer les plannings."}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
