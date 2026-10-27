import { useEffect, useRef, useState } from "react";
import { CrosshairIcon, LoaderCircle, MapPin } from "../../ui/icons";

/**
 * Sélecteur d'emplacement d'une station.
 *
 * Exigences supportées ici :
 * - une adresse saisie DOIT changer les coordonnées (géocodage Nominatim) :
 *   auparavant, tant que l'agent ne cliquait pas sur une suggestion, l'adresse
 *   changeait mais les coordonnées restaient celles par défaut (4.051056,
 *   9.708533) — toutes les stations finissaient au même point ;
 * - le marqueur et le périmètre autorisé (geofence) sont visibles et nets ;
 * - la carte cadre sur la zone utile au lieu d'afficher de grandes zones vides
 *   (zoom calculé à partir du rayon de pointage).
 */

export const DEFAULT_LAT = 4.051056;
export const DEFAULT_LNG = 9.708533;

export const MAP_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
export const MAP_TILE_OPTIONS = { tileSize: 256, zoomOffset: 0 };
export const MAP_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — sources Esri, HERE, Garmin et contributeurs OpenStreetMap';

/** Zoom correspondant à un rayon de pointage (donne un cadrage serré et lisible). */
export function zoomForRadius(radiusMeters: number): number {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return 17;
  if (radiusMeters <= 60) return 18;
  if (radiusMeters <= 150) return 17;
  if (radiusMeters <= 300) return 16;
  if (radiusMeters <= 600) return 15;
  if (radiusMeters <= 1_200) return 14;
  return 13;
}

type Leaflet = any;

/** Marqueur net : pastille rouge cerclée de blanc, avec ombre portée. */
export function stationMarkerIcon(L: Leaflet) {
  return L.divIcon({
    className: "uswap-station-pin",
    html:
      '<span class="uswap-station-pin__dot" aria-hidden="true"></span>' +
      '<span class="uswap-station-pin__tail" aria-hidden="true"></span>',
    iconSize: [30, 40],
    iconAnchor: [15, 38],
    popupAnchor: [0, -34],
  });
}

/** Adresse lisible à partir d'une réponse Nominatim. */
export function formatNominatim(item: any): string {
  if (!item) return "";
  if (item.display_name) return String(item.display_name);
  const parts = [
    item.name,
    item.address?.road,
    item.address?.suburb || item.address?.neighbourhood,
    item.address?.city || item.address?.town || item.address?.village,
  ].filter(Boolean);
  return parts.join(", ");
}

async function nominatimSearch(query: string): Promise<any[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
    query,
  )}&countrycodes=cm&limit=8&addressdetails=1&accept-language=fr`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function nominatimReverse(lat: number, lng: number): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=fr`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return "";
  const data = await response.json();
  return data?.display_name ? String(data.display_name) : "";
}

/**
 * Journalise dans la console la résolution d'une adresse pour faciliter le
 * diagnostic : si l'API de géocodage est bloquée, aucun point ne bouge et il
 * faut le voir immédiatement.
 */
export function MapLocationPicker({
  address,
  latitude,
  longitude,
  geofenceRadiusMeters = 150,
  onSelectLocation,
  onSelectAddress,
}: {
  address: string;
  latitude: number | string;
  longitude: number | string;
  geofenceRadiusMeters?: number;
  onSelectLocation: (lat: number, lng: number) => void;
  onSelectAddress: (addr: string, lat: number, lng: number) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const searchTimer = useRef<number | null>(null);
  const lastQuery = useRef("");

  const [searchQuery, setSearchQuery] = useState(address);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [mapError, setMapError] = useState("");
  const [resolved, setResolved] = useState("");

  const hasCoords =
    latitude !== "" && longitude !== "" && Number.isFinite(Number(latitude));
  const currentLat = hasCoords ? Number(latitude) : DEFAULT_LAT;
  const currentLng = hasCoords ? Number(longitude) : DEFAULT_LNG;
  const radius = Number(geofenceRadiusMeters) || 150;

  useEffect(() => {
    setSearchQuery(address);
    lastQuery.current = address.trim().toLowerCase();
  }, [address]);

  function applyPosition(lat: number, lng: number, zoom?: number) {
    const map = mapInstanceRef.current;
    const marker = markerRef.current;
    if (map && marker) {
      marker.setLatLng([lat, lng]);
      if (circleRef.current) circleRef.current.setLatLng([lat, lng]);
      map.setView([lat, lng], zoom ?? map.getZoom(), { animate: true });
      map.invalidateSize();
    }
  }

  /**
   * Résout une adresse complète et déplace le marqueur. Renvoie true si un
   * point a bien été trouvé (l'appelant peut alors enregistrer les coords).
   */
  async function resolveAddress(text: string): Promise<boolean> {
    const query = text.trim();
    if (query.length < 4) return false;
    setIsSearching(true);
    try {
      const results = await nominatimSearch(query);
      const best = results[0];
      if (!best) {
        setResolved("Adresse introuvable : précisez la ville ou placez le repère à la main.");
        return false;
      }
      const lat = Number(best.lat);
      const lng = Number(best.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      const label = formatNominatim(best);
      // Une seule mise à jour : adresse ET coordonnées, toujours ensemble.
      onSelectAddress(label, lat, lng);
      applyPosition(lat, lng, zoomForRadius(radius));
      lastQuery.current = label.trim().toLowerCase();
      setResolved("");
      return true;
    } catch (error) {
      setResolved(
        "Le service d'adresses est injoignable. Placez le repère sur la carte.",
      );
      console.warn("Géocodage impossible", error);
      return false;
    } finally {
      setIsSearching(false);
    }
  }

  async function reverseGeocode(lat: number, lng: number) {
    try {
      const label = await nominatimReverse(lat, lng);
      if (!label) return;
      onSelectAddress(label, lat, lng);
      lastQuery.current = label.trim().toLowerCase();
    } catch (error) {
      console.warn("Géocodage inversé impossible", error);
    }
  }

  function handleSearchInput(value: string) {
    setSearchQuery(value);
    setResolved("");
    if (searchTimer.current) window.clearTimeout(searchTimer.current);

    if (value.trim().length < 4) {
      setSuggestions([]);
      return;
    }

    // Suggestions + résolution automatique : même sans cliquer sur une
    // suggestion, les coordonnées suivent l'adresse saisie.
    searchTimer.current = window.setTimeout(async () => {
      try {
        const results = await nominatimSearch(value.trim());
        setSuggestions(
          results.map((item) => ({
            label: formatNominatim(item),
            lat: Number(item.lat),
            lng: Number(item.lon),
          })),
        );
      } catch {
        setSuggestions([]);
      }
    }, 450);

    searchTimer.current = searchTimer.current;
  }

  function commitSearch() {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    setSuggestions([]);
    void resolveAddress(searchQuery);
  }

  function selectSuggestion(item: { label: string; lat: number; lng: number }) {
    setSearchQuery(item.label);
    setSuggestions([]);
    onSelectAddress(item.label, item.lat, item.lng);
    applyPosition(item.lat, item.lng, zoomForRadius(radius));
  }

  useEffect(() => {
    let disposed = false;
    let disposeMap: (() => void) | undefined;

    const startMap = (L: Leaflet) => {
      if (!L || !mapContainerRef.current || mapInstanceRef.current) return;
      if ((mapContainerRef.current as any)._leaflet_id) {
        (mapContainerRef.current as any)._leaflet_id = null;
        mapContainerRef.current.innerHTML = "";
      }

      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([currentLat, currentLng], zoomForRadius(radius));
      mapInstanceRef.current = map;

      L.tileLayer(MAP_TILE_URL, {
        ...MAP_TILE_OPTIONS,
        maxZoom: 19,
        attribution: MAP_ATTRIBUTION,
      }).addTo(map);

      // Périmètre de pointage : rend visible la zone dans laquelle l'agent
      // peut valider sa prise de service.
      const circle = L.circle([currentLat, currentLng], {
        radius,
        color: "#2d6cdf",
        weight: 2,
        fillColor: "#2d6cdf",
        fillOpacity: 0.12,
      }).addTo(map);
      circleRef.current = circle;

      const marker = L.marker([currentLat, currentLng], {
        draggable: true,
        icon: stationMarkerIcon(L),
        autoPan: true,
      }).addTo(map);
      markerRef.current = marker;

      setTimeout(() => map.invalidateSize(), 150);
      setTimeout(() => map.invalidateSize(), 500);

      marker.on("dragend", (event: any) => {
        const coords = event.target.getLatLng();
        if (circleRef.current) circleRef.current.setLatLng(coords);
        onSelectLocation(coords.lat, coords.lng);
        void reverseGeocode(coords.lat, coords.lng);
      });

      map.on("click", (event: any) => {
        const { lat, lng } = event.latlng;
        marker.setLatLng([lat, lng]);
        if (circleRef.current) circleRef.current.setLatLng([lat, lng]);
        onSelectLocation(lat, lng);
        void reverseGeocode(lat, lng);
      });

      // Adresse déjà connue mais sans coordonnées (import, saisie directe) :
      // on la résout une fois la carte prête.
      if (!hasCoords && address.trim().length >= 4) {
        void resolveAddress(address);
      }

      return () => {
        map.remove();
      };
    };

    void loadLeaflet()
      .then((L) => {
        if (!disposed) disposeMap = startMap(L);
      })
      .catch((error: Error) => {
        if (!disposed) setMapError(error.message);
      });

    return () => {
      disposed = true;
      disposeMap?.();
      mapInstanceRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // La carte n'est créée qu'une fois : les mises à jour passent par les refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyPosition(currentLat, currentLng);
  }, [currentLat, currentLng]);

  useEffect(() => {
    circleRef.current?.setRadius(radius);
  }, [radius]);

  return (
    <div className="map-picker-wrapper">
      <div className="stepper-field-group map-picker-field">
        <label>ADRESSE DE LA STATION *</label>
        <div className="map-picker-input-wrap">
          <input
            maxLength={250}
            placeholder="Ex : Tradex Bonamoussadi, Douala"
            value={searchQuery}
            onChange={(event) => handleSearchInput(event.target.value)}
            onBlur={() => {
              // Quitter le champ suffit à valider l'adresse saisie.
              if (searchQuery.trim().toLowerCase() !== lastQuery.current) {
                commitSearch();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitSearch();
              }
            }}
          />
          {isSearching && (
            <span className="map-picker-spinner">
              <LoaderCircle className="spin" size={16} />
            </span>
          )}
        </div>

        {suggestions.length > 0 && (
          <div className="map-picker-suggestions">
            {suggestions.map((item) => (
              <button
                key={`${item.lat}-${item.lng}`}
                type="button"
                className="map-picker-suggestion"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(item)}
              >
                <MapPin size={14} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}
        {resolved && (
          <p className="map-picker-hint" role="status">
            {resolved}
          </p>
        )}
      </div>

      <div className="map-picker-caption">
        <span>POSITION DU REPÈRE *</span>
        <span className="map-picker-hint">
          <CrosshairIcon size={14} /> Cliquez ou glissez le repère pour ajuster
          l’emplacement
        </span>
      </div>

      <div ref={mapContainerRef} className="map-picker-canvas" />
      {mapError && (
        <p className="error-message" role="status">
          {mapError}
        </p>
      )}

      <div className="map-picker-coords">
        <div className="map-picker-coords-label">
          <MapPin size={16} />
          <span>Coordonnées GPS :</span>
        </div>
        <strong>
          {hasCoords ? Number(latitude).toFixed(6) : "—"},{" "}
          {hasCoords ? Number(longitude).toFixed(6) : "—"}
        </strong>
        <span className="map-picker-hint">Périmètre : {radius} m</span>
      </div>
    </div>
  );
}

/**
 * Charge Leaflet (CSS + JS) une seule fois. Le plugin `leaflet.heat` n'est pas
 * nécessaire ici : la carte affiche un fond de plan net et un repère unique.
 */
let leafletPromise: Promise<Leaflet> | null = null;

export function loadLeaflet(): Promise<Leaflet> {
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const globalWindow = window as any;
    if (globalWindow.L) {
      resolve(globalWindow.L);
      return;
    }
    if (!document.querySelector('link[data-uswap-leaflet="css"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.dataset.uswapLeaflet = "css";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => {
      const L = (window as any).L;
      if (L) resolve(L);
      else reject(new Error("Carte indisponible."));
    };
    script.onerror = () =>
      reject(new Error("Impossible de charger la carte (connexion requise)."));
    document.head.appendChild(script);
  });
  return leafletPromise;
}
