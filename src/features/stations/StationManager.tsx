import { useState, useEffect, useRef } from "react";
import { notify } from "../../ui/Toast";
import { ShiftTemplates, shiftBreakError, shiftDuration } from "./ShiftTemplates";
import { api } from "../../api/auth-api";
import { exportToExcel } from "../../utils/excelExport";
import { StepperModal, type StepItem } from "../../ui/StepperModal";
import { Modal } from "../../ui/Modal";
import {
  Building2,
  MapPin,
  LoaderCircle,
  Search,
  Clock3,
  UserRound,
  DownloadSimple,
} from "../../ui/icons";
import {
  PlusIcon,
  CaretDownIcon,
  PencilSimpleIcon,
  PhoneIcon,
  ListIcon,
  SquaresFourIcon,
  CrosshairIcon,
  XIcon,
} from "@phosphor-icons/react";
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
  minRestHours: number;
  weeklyHoursLimit: number;
  blockPublishingWithVacancies: boolean;
  checkinQrTtl: number;
  checkoutQrTtl: number;
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
  minRestHours: 8,
  weeklyHoursLimit: 48,
  blockPublishingWithVacancies: false,
  checkinQrTtl: 300,
  checkoutQrTtl: 300,
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
  minRestHours: "" as unknown as number,
  weeklyHoursLimit: "" as unknown as number,
  blockPublishingWithVacancies: false,
  checkinQrTtl: "" as unknown as number,
  checkoutQrTtl: "" as unknown as number,
};

const blankSharedShift = {
  label: "",
  startTime: "",
  endTime: "",
  breakStart: "",
  breakEnd: "",
  stationIds: [] as string[],
};

const DEFAULT_LAT = 4.051056;
const DEFAULT_LNG = 9.708533;
const MAP_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const MAP_TILE_OPTIONS = { tileSize: 256, zoomOffset: 0 };
const MAP_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — sources Esri, HERE, Garmin et contributeurs OpenStreetMap';

function ensureLeafletStyles() {
  if (document.querySelector('link[href*="leaflet.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  link.dataset.uswapLeafletCss = "true";
  document.head.appendChild(link);
}

function uswapMapMarker(L: any) {
  return L.divIcon({
    className: "uswap-map-marker",
    html: "<span aria-hidden=\"true\"></span>",
    iconSize: [28, 32],
    iconAnchor: [14, 30],
    popupAnchor: [0, -28],
  });
}

/* ============================================================
   Sélecteur GPS Bidirectionnel & Suggestions optimisées (Cameroun)
   ============================================================ */
function MapLocationPicker({
  address,
  latitude,
  longitude,
  onSelectLocation,
  onSelectAddress,
}: {
  address: string;
  latitude: number | string;
  longitude: number | string;
  onSelectLocation: (lat: number, lng: number) => void;
  onSelectAddress: (addr: string, lat: number, lng: number) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  const [searchQuery, setSearchQuery] = useState(address);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const currentLat = Number(latitude) || DEFAULT_LAT;
  const currentLng = Number(longitude) || DEFAULT_LNG;

  useEffect(() => {
    setSearchQuery(address);
  }, [address]);

  useEffect(() => {
    ensureLeafletStyles();
    const startMap = () => {
      const L = (window as any).L;
      if (!L || !mapContainerRef.current || mapInstanceRef.current) return;

    if ((mapContainerRef.current as any)._leaflet_id) {
      (mapContainerRef.current as any)._leaflet_id = null;
      mapContainerRef.current.innerHTML = "";
    }

    const map = L.map(mapContainerRef.current).setView([currentLat, currentLng], 15);
    mapInstanceRef.current = map;

    L.tileLayer(MAP_TILE_URL, {
      ...MAP_TILE_OPTIONS,
      maxZoom: 19,
      attribution: MAP_ATTRIBUTION,
    }).addTo(map);

    const marker = L.marker([currentLat, currentLng], {
      draggable: true,
      icon: uswapMapMarker(L),
    }).addTo(map);
    markerRef.current = marker;

    const timer1 = setTimeout(() => map.invalidateSize(), 150);
    const timer2 = setTimeout(() => map.invalidateSize(), 500);

    marker.on("dragend", async (e: any) => {
      const coords = e.target.getLatLng();
      onSelectLocation(coords.lat, coords.lng);
      await reverseGeocode(coords.lat, coords.lng);
    });

    map.on("click", async (e: any) => {
      const { lat, lng } = e.latlng;
      marker.setLatLng([lat, lng]);
      onSelectLocation(lat, lng);
      await reverseGeocode(lat, lng);
    });

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      map.remove();
    };
    };
    if ((window as any).L) return startMap();
    const existing = document.querySelector('script[data-uswap-leaflet]') as HTMLScriptElement | null;
    if (existing) { existing.addEventListener("load", startMap); return () => existing.removeEventListener("load", startMap); }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.dataset.uswapLeaflet = "true";
    script.onload = startMap;
    document.head.appendChild(script);
    return () => { script.onload = null; };
  }, []);

  useEffect(() => {
    if (markerRef.current && mapInstanceRef.current) {
      const currentPos = markerRef.current.getLatLng();
      if (currentPos.lat !== currentLat || currentPos.lng !== currentLng) {
        markerRef.current.setLatLng([currentLat, currentLng]);
        mapInstanceRef.current.setView([currentLat, currentLng], mapInstanceRef.current.getZoom());
        mapInstanceRef.current.invalidateSize();
      }
    }
  }, [currentLat, currentLng]);

  function formatDetailedAddress(feature: any) {
    if (!feature) return "";
    const text = feature?.text || "";
    const placeName = feature?.place_name || "";
    const context = feature?.context || [];

    if (placeName && placeName.includes(",")) {
      return placeName;
    }

    const parts = [text];
    context.forEach((ctx: any) => {
      if (ctx?.text && !parts.includes(ctx.text)) {
        parts.push(ctx.text);
      }
    });

    return parts.length > 1 ? parts.join(", ") : (placeName || text);
  }

  async function reverseGeocode(lat: number, lng: number) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=fr`;
      const res = await fetch(url);
      const data = await res.json();
      const feature = data?.display_name
        ? { place_name: data.display_name, text: data.name || data.display_name }
        : null;
      if (feature) {
        const detailedName = formatDetailedAddress(feature);
        setSearchQuery(detailedName);
        onSelectAddress(detailedName, lat, lng);
      }
    } catch (e) {
      console.error("Erreur de géocodage inversé", e);
    }
  }

  async function handleSearchInput(value: string) {
    setSearchQuery(value);
    onSelectAddress(value, currentLat, currentLng);

    if (!value || value.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);
    try {
      const queryText = encodeURIComponent(value);
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${queryText}&countrycodes=cm&limit=10&addressdetails=1&accept-language=fr`;
      const res = await fetch(url);
      const data = await res.json();
      const features = Array.isArray(data)
        ? data.map((item: any) => ({
            text: item.name || item.display_name,
            place_name: item.display_name,
            center: [Number(item.lon), Number(item.lat)],
          }))
        : [];
      setSuggestions(features);
    } catch (e) {
      console.error("Erreur de recherche de stations", e);
    } finally {
      setIsSearching(false);
    }
  }

  function selectSuggestion(feature: any) {
    if (!feature?.center) return;
    const [lng, lat] = feature.center;
    const detailedName = formatDetailedAddress(feature);

    setSearchQuery(detailedName);
    setSuggestions([]);

    if (markerRef.current && mapInstanceRef.current) {
      markerRef.current.setLatLng([lat, lng]);
      mapInstanceRef.current.setView([lat, lng], 17);
      mapInstanceRef.current.invalidateSize();
    }

    onSelectAddress(detailedName, lat, lng);
  }

  return (
    <div className="map-picker-wrapper">
      <div className="stepper-field-group map-picker-field">
        <label>NOM DE LA STATION / EMPLACEMENT OU ADRESSE *</label>
        <div className="map-picker-input-wrap">
          <input
            required
            maxLength={250}
            placeholder="Tapez le nom d'une station (ex: Tradex, Total, Bonamoussadi)..."
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
          />
          {isSearching && (
            <span className="map-picker-spinner">
              <LoaderCircle className="spin" size={16} />
            </span>
          )}
        </div>

        {suggestions?.length > 0 && (
          <div className="map-picker-suggestions">
            {suggestions.map((item, idx) => {
              const displayName = formatDetailedAddress(item);
              return (
                <button
                  key={idx}
                  type="button"
                  className="map-picker-suggestion"
                  onClick={() => selectSuggestion(item)}
                >
                  <MapPin size={14} />
                  <span>{displayName}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="map-picker-caption">
        <span>POSITIONNER OU DÉPLACER LE MARQUEUR *</span>
        <span className="map-picker-hint">
          <CrosshairIcon size={14} /> Glissez pour actualiser l'adresse
        </span>
      </div>

      <div ref={mapContainerRef} className="map-picker-canvas" />

      <div className="map-picker-coords">
        <div className="map-picker-coords-label">
          <MapPin size={16} />
          <span>Coordonnées GPS capturées :</span>
        </div>
        <strong>
          {latitude !== "" ? Number(latitude).toFixed(6) : "—"}, {longitude !== "" ? Number(longitude).toFixed(6) : "—"}
        </strong>
      </div>
    </div>
  );
}

/* ============================================================
   Vue Carte Globale des Stations
   ============================================================ */
function StationsMapView({
  stations,
  onEditStation,
}: {
  stations: StationData[];
  onEditStation: (s: StationData) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [selectedStation, setSelectedStation] = useState<StationData | null>(null);

  useEffect(() => {
    let mapInstance: any = null;

    const initGlobalMap = () => {
      const L = (window as any).L;
      if (!L || !mapRef.current) return;

      if ((mapRef.current as any)._leaflet_id) {
        (mapRef.current as any)._leaflet_id = null;
        mapRef.current.innerHTML = "";
      }

      mapInstance = L.map(mapRef.current).setView([DEFAULT_LAT, DEFAULT_LNG], 7);

      L.tileLayer(MAP_TILE_URL, {
        ...MAP_TILE_OPTIONS,
        maxZoom: 18,
        attribution: MAP_ATTRIBUTION,
      }).addTo(mapInstance);

      const validStations = (stations || []).filter((s) => s?.latitude != null && s?.longitude != null);

      if (validStations.length > 0) {
        const bounds = L.latLngBounds([]);

        validStations.forEach((s) => {
          const lat = Number(s.latitude);
          const lng = Number(s.longitude);
          bounds.extend([lat, lng]);

          const marker = L.marker([lat, lng], { icon: uswapMapMarker(L) }).addTo(mapInstance);
          
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

        mapInstance.fitBounds(bounds, { padding: [40, 40] });
      }

      setTimeout(() => {
        if (mapInstance) mapInstance.invalidateSize();
      }, 250);
    };

    if (!(window as any).L) {
      ensureLeafletStyles();

      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => initGlobalMap();
      document.head.appendChild(script);
    } else {
      initGlobalMap();
    }

    return () => {
      if (mapInstance) mapInstance.remove();
    };
  }, [stations]);

  return (
    <div className="admin-card stations-map-card">
      <div className="stations-map-head">
        <h3>Cartographie des Stations</h3>
        <p>
          Cliquez sur le nom d'une station dans son marqueur pour consulter ses informations.
        </p>
      </div>
      <div ref={mapRef} className="stations-map-canvas" />

      {selectedStation && (
        <div className="stepper-overlay" onClick={() => setSelectedStation(null)}>
          <div className="admin-card stations-map-panel" onClick={(e) => e.stopPropagation()}>
            <div className="stations-map-panel-head">
              <div className="stations-map-panel-title">
                <span className="admin-stat-icon orange">
                  <Building2 size={18} />
                </span>
                <div>
                  <h3>{selectedStation?.name}</h3>
                  <span>{selectedStation?.timezone}</span>
                </div>
              </div>
              <button
                type="button"
                className="stepper-close-btn stations-map-close"
                onClick={() => setSelectedStation(null)}
              >
                <XIcon size={16} />
              </button>
            </div>

            <div className="stepper-summary-card stations-map-summary">
              <div className="summary-row">
                <span>Ville & Adresse :</span>
                <strong>{selectedStation?.city || "—"} ({selectedStation?.address || selectedStation?.location || "Non précisée"})</strong>
              </div>
              <div className="summary-row">
                <span>Coordonnées GPS :</span>
                <strong>
                  {selectedStation?.latitude != null && selectedStation?.longitude != null
                    ? `${Number(selectedStation.latitude).toFixed(4)}, ${Number(selectedStation.longitude).toFixed(4)}`
                    : "Non géolocalisée"}
                </strong>
              </div>
              <div className="summary-row">
                <span>Responsable :</span>
                <strong>{selectedStation?.contactName || "—"} {selectedStation?.contactPhone ? `(${selectedStation.contactPhone})` : ""}</strong>
              </div>
              <div className="summary-row">
                <span>Tolérance / Repos / Max :</span>
                <strong>{selectedStation?.latenessToleranceMinutes}m / {selectedStation?.minRestHours}h / {selectedStation?.weeklyHoursLimit}h</strong>
              </div>
              <div className="summary-row">
                <span>Statut :</span>
                <strong className={selectedStation?.isActive ? "stations-map-status-active" : "stations-map-status-inactive"}>
                  {selectedStation?.isActive ? "Active" : "Inactive"}
                </strong>
              </div>
            </div>

            <div className="stations-map-panel-actions">
              <button
                type="button"
                className="admin-button secondary small"
                onClick={() => setSelectedStation(null)}
              >
                Fermer
              </button>
              <button
                type="button"
                className="admin-button small"
                onClick={() => {
                  const st = selectedStation;
                  setSelectedStation(null);
                  if (st) onEditStation(st);
                }}
              >
                <PencilSimpleIcon size={14} />
                <span>Modifier</span>
              </button>
            </div>
          </div>
        </div>
      )}
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
  const [templateStation, setTemplateStation] = useState<StationData | null>(null);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [cityFilter, setCityFilter] = useState("ALL");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [confirm, setConfirm] = useState<StationData | null>(null);
  const [sharedShift, setSharedShift] = useState<typeof blankSharedShift | null>(null);
  
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setCityDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
        minRestHours: Number(form.minRestHours),
        weeklyHoursLimit: Number(form.weeklyHoursLimit),
        blockPublishingWithVacancies: Boolean(form.blockPublishingWithVacancies),
        checkinQrTtl: Number(form.checkinQrTtl),
        checkoutQrTtl: Number(form.checkoutQrTtl),
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
    if (!sharedShift.label.trim() || !shiftDuration(sharedShift.startTime, sharedShift.endTime) || breakError || !sharedShift.stationIds.length) {
      setError(breakError || "Renseignez le modèle et choisissez au moins une station.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/shift-templates/apply", {
        stationIds: sharedShift.stationIds,
        label: sharedShift.label.trim(),
        startTime: sharedShift.startTime,
        endTime: sharedShift.endTime,
        breakStart: sharedShift.breakStart || null,
        breakEnd: sharedShift.breakEnd || null,
      });
      notify(
        `Modèle appliqué à ${sharedShift.stationIds.length} station${sharedShift.stationIds.length > 1 ? "s" : ""}.`,
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

  const cities = Array.from(new Set((stations || []).map((s) => s?.city).filter(Boolean)));

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
        { header: "Nom de la station", key: (s: StationData) => s?.name || "", width: 25 },
        { header: "Ville", key: (s: StationData) => s?.city || "—", width: 15 },
        { header: "Adresse", key: (s: StationData) => s?.address || s?.location || "—", width: 30 },
        {
          header: "Coordonnées GPS",
          key: (s: StationData) => (s?.latitude != null && s?.longitude != null ? `${s.latitude}, ${s.longitude}` : "—"),
          width: 25,
        },
        { header: "Contact responsable", key: (s: StationData) => s?.contactName || "—", width: 22 },
        { header: "Téléphone", key: (s: StationData) => s?.contactPhone || "—", width: 18 },
        { header: "Tolérance retard (min)", key: (s: StationData) => s?.latenessToleranceMinutes ?? 0, width: 20 },
        { header: "Repos minimal (h)", key: (s: StationData) => s?.minRestHours ?? 0, width: 18 },
        { header: "Limite hebdo (h)", key: (s: StationData) => s?.weeklyHoursLimit ?? 0, width: 18 },
        { header: "Statut", key: (s: StationData) => (s?.isActive ? "Active" : "Inactive"), width: 12 },
      ],
    });
    notify("Exportation du fichier Excel réussie.", "success");
  }

  const stationSteps: StepItem[] = form
    ? [
        {
          id: "location",
          label: "Localisation",
          isValid: () => !!form?.name?.trim() && !!form?.timezone?.trim(),
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
                latitude={form?.latitude ?? DEFAULT_LAT}
                longitude={form?.longitude ?? DEFAULT_LNG}
                onSelectLocation={(lat, lng) => {
                  set("latitude", lat);
                  set("longitude", lng);
                }}
                onSelectAddress={(addr, lat, lng) => {
                  set("address", addr);
                  set("latitude", lat);
                  set("longitude", lng);
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
            String(form.minRestHours).trim() !== "" &&
            Number(form.minRestHours) >= 0 &&
            String(form.weeklyHoursLimit).trim() !== "" &&
            Number(form.weeklyHoursLimit) > 0 &&
            String(form.checkinQrTtl).trim() !== "" &&
            Number(form.checkinQrTtl) > 0,
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
                    onChange={(e) => set("latenessToleranceMinutes", e.target.value === "" ? "" : Number(e.target.value))}
                  />
                </div>

                <div className="stepper-field-group">
                  <label>REPOS MINIMAL (HEURES)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={1}
                    value={form?.minRestHours ?? 0}
                    onChange={(e) => set("minRestHours", e.target.value === "" ? "" : Number(e.target.value))}
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
                    onChange={(e) => set("weeklyHoursLimit", e.target.value === "" ? "" : Number(e.target.value))}
                  />
                </div>

                <div className="stepper-field-group">
                  <label>VALIDITÉ QR DEB/FIN (MINUTES)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    step={1}
                    value={form?.checkinQrTtl ? Number(form.checkinQrTtl) / 60 : ""}
                    onChange={(e) => {
                      const val = e.target.value === "" ? "" : Number(e.target.value) * 60;
                      set("checkinQrTtl", val);
                      set("checkoutQrTtl", val);
                    }}
                  />
                </div>
              </div>

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
            </div>
          ),
        },
        {
          id: "summary",
          label: "Récapitulatif",
          content: (
            <div className="stepper-form-layout">
              {error && <p className="error-message" role="alert">{error}</p>}
              <div className="stepper-summary-card">
                <div className="summary-row">
                  <span>Nom de la station :</span>
                  <strong>{form?.name || "—"}</strong>
                </div>
                <div className="summary-row">
                  <span>Ville & Fuseau :</span>
                  <strong>{form?.city || "—"} ({form?.timezone || "—"})</strong>
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
                    {form?.contactName || "Aucun"} {form?.contactPhone ? `(${form.contactPhone})` : ""}
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Tolérance retard :</span>
                  <strong>{form?.latenessToleranceMinutes ?? 0} min</strong>
                </div>
                <div className="summary-row">
                  <span>Repos min. / Limite hebdo :</span>
                  <strong>{form?.minRestHours ?? 0}h / {form?.weeklyHoursLimit ?? 0}h max</strong>
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
                Vérifiez les informations ci-dessus puis cliquez sur le bouton de validation final pour créer ou mettre à jour la station.
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
        title={confirm?.isActive ? "Désactiver la station" : "Réactiver la station"}
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
                  onChange={(event) => setSharedShift({ ...sharedShift, label: event.target.value })}
                />
              </label>
              <label>
                Heure de début
                <input type="time" required value={sharedShift.startTime} onChange={(event) => setSharedShift({ ...sharedShift, startTime: event.target.value })} />
              </label>
              <label>
                Heure de fin
                <input type="time" required value={sharedShift.endTime} onChange={(event) => setSharedShift({ ...sharedShift, endTime: event.target.value })} />
              </label>
              <label>
                Début de pause
                <input type="time" value={sharedShift.breakStart} onChange={(event) => setSharedShift({ ...sharedShift, breakStart: event.target.value })} />
              </label>
              <label>
                Fin de pause
                <input type="time" value={sharedShift.breakEnd} onChange={(event) => setSharedShift({ ...sharedShift, breakEnd: event.target.value })} />
              </label>
            </div>

            <fieldset className="shared-shift-stations">
              <legend>Stations concernées</legend>
              <p>Le modèle restera modifiable séparément dans chaque station.</p>
              <div>
                {(stations || []).filter((station) => station.isActive).map((station) => (
                  <label key={station.id}>
                    <input
                      type="checkbox"
                      checked={sharedShift.stationIds.includes(station.id)}
                      onChange={(event) =>
                        setSharedShift({
                          ...sharedShift,
                          stationIds: event.target.checked
                            ? [...sharedShift.stationIds, station.id]
                            : sharedShift.stationIds.filter((id) => id !== station.id),
                        })
                      }
                    />
                    <span><strong>{station.name}</strong><small>{station.city || station.address || "Adresse non renseignée"}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>

            {error && <p className="error-message" role="alert">{error}</p>}
            <div className="modal-form-actions">
              <button type="button" className="admin-button secondary" disabled={busy} onClick={() => setSharedShift(null)}>Annuler</button>
              <button type="submit" className="admin-button primary-cta" disabled={busy}>Appliquer aux stations</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal dédié pour ouvrir ShiftTemplates en surimpression */}
      <Modal
        open={templateStation !== null}
        size="xl"
        onClose={() => setTemplateStation(null)}
        title={templateStation ? `Modèles de shifts — ${templateStation.name}` : "Modèles de shifts"}
      >
        <div className="station-templates-modal-body">
          {templateStation && (
            <ShiftTemplates
              station={(stations || []).find((s) => s?.id === templateStation.id) || templateStation}
              onBack={() => setTemplateStation(null)}
            />
          )}
        </div>
      </Modal>

      {activeTab === "map" ? (
        <StationsMapView stations={stations || []} onEditStation={(s) => edit(s)} />
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
              <div ref={dropdownRef} className="stations-city-filter">
                <button
                  type="button"
                  className="stations-city-toggle"
                  onClick={() => setCityDropdownOpen(!cityDropdownOpen)}
                >
                  <span>Ville :</span>
                  <strong>
                    {cityFilter === "ALL" ? "Toutes les villes" : cityFilter}
                  </strong>
                  <CaretDownIcon size={14} className={`caret${cityDropdownOpen ? " is-open" : ""}`} />
                </button>

                {cityDropdownOpen && (
                  <div className="stations-city-menu">
                    <button
                      type="button"
                      className={`stations-city-option${cityFilter === "ALL" ? " is-selected" : ""}`}
                      onClick={() => { setCityFilter("ALL"); setCityDropdownOpen(false); }}
                    >
                      Toutes les villes
                    </button>
                    {cities.map((city) => (
                      <button
                        key={city}
                        type="button"
                        className={`stations-city-option${cityFilter === city ? " is-selected" : ""}`}
                        onClick={() => { setCityFilter(city || "ALL"); setCityDropdownOpen(false); }}
                      >
                        {city}
                      </button>
                    ))}
                  </div>
                )}
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
                <table className="admin-table station-compact-table">
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
                        <td>
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
                        <td>
                          <div className="station-cell-city">
                            <strong>{s?.city || "Non spécifiée"}</strong>
                            <span>{s?.address || s?.location || "—"}</span>
                          </div>
                        </td>
                        <td>
                          {s?.latitude != null && s?.longitude != null ? (
                            <a
                              href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-button station-map-link"
                            >
                              <MapPin size={13} />
                              <span>{Number(s.latitude).toFixed(2)}, {Number(s.longitude).toFixed(2)}</span>
                            </a>
                          ) : (
                            <span className="station-gps-empty">—</span>
                          )}
                        </td>
                        <td>
                          <div className="station-cell-contact">
                            <span>{s?.contactName || "—"}</span>
                            {s?.contactPhone && <span>{s.contactPhone}</span>}
                          </div>
                        </td>
                        <td>
                          <div className="code-chips station-code-chips">
                            <code>Tol: {s?.latenessToleranceMinutes ?? 0}m</code>
                            <code>Repos: {s?.minRestHours ?? 0}h</code>
                            <code>Max: {s?.weeklyHoursLimit ?? 0}h</code>
                          </div>
                        </td>
                        <td>
                          <span className={`admin-badge ${s?.isActive ? "active" : "draft"}`}>
                            {s?.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="station-cell-right">
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
                    <span className={`admin-badge ${s?.isActive ? "active" : "draft"}`}>
                      {s?.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <div className="station-main-info">
                    <h2>{s?.name}</h2>
                    <p className="station-location">
                      <MapPin size={15} />
                      <span>{s?.city ? `${s.city} — ` : ""}{s?.address || s?.location || "Adresse non renseignée"}</span>
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
                              {Number(s.latitude).toFixed(4)}, {Number(s.longitude).toFixed(4)} (Ouvrir Maps)
                            </a>
                          ) : (
                            "Non configuré"
                          )}
                        </strong>
                      </div>
                      <div className="rule-chip">
                        <span className="rule-label">Tolérance retard</span>
                        <strong className="rule-value">{s?.latenessToleranceMinutes ?? 0} min</strong>
                      </div>
                      <div className="rule-chip">
                        <span className="rule-label">Repos min.</span>
                        <strong className="rule-value">{s?.minRestHours ?? 0} h</strong>
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
              <h2>{query ? "Aucune station ne correspond" : "Aucune station enregistrée"}</h2>
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
