import { useEffect, useRef, useState } from "react";
import { CrosshairIcon, LoaderCircle, MapPin } from "../../ui/icons";
import "./mapPickerStyles.css";

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

/**
 * Clé Google Maps (Maps JavaScript API + Places), lue à l'exécution.
 *
 * Absente : la carte reste entièrement fonctionnelle avec OpenStreetMap et
 * Nominatim. Présente : Google Maps devient le fond de référence, ce qui
 * garantit que le repère, le périmètre et les adresses sont exactement ceux
 * que l'agent voit dans l'application Google Maps.
 */
export function googleMapsApiKey(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return String(env?.VITE_GOOGLE_MAPS_API_KEY || "").trim();
}

/**
 * État de l'autorisation de géolocalisation, sans déclencher de demande.
 *
 * `denied` signifie que l'agent a déjà refusé (ou que le système bloque) :
 * relancer `getCurrentPosition` échouerait immédiatement, sans que le
 * navigateur ne redemande. Il faut donc l'inviter à l'activer explicitement.
 * `unknown` = navigateur sans Permissions API : on laisse le relevé décider.
 */
export async function readGeolocationPermission(): Promise<
  "granted" | "denied" | "prompt" | "unknown"
> {
  try {
    const permissions = (navigator as any)?.permissions;
    if (!permissions?.query) return "unknown";
    const status = await permissions.query({ name: "geolocation" });
    return status?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Charge l'API Google Maps une seule fois.
 *
 * `libraries=places` donne l'autocomplétion d'adresses et `geometry` les
 * calculs de distance ; `v=weekly` évite d'épingler une version obsolète.
 */
let googleMapsPromise: Promise<any> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<any> {
  const existing = (window as any).google?.maps;
  if (existing) return Promise.resolve(existing);
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(apiKey)}` +
      "&libraries=places,geometry&language=fr&region=CM&v=weekly";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const maps = (window as any).google?.maps;
      if (maps) resolve(maps);
      else reject(new Error("Google Maps indisponible."));
    };
    script.onerror = () => {
      googleMapsPromise = null;
      reject(new Error("Impossible de charger Google Maps (clé ou réseau)."));
    };
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

/**
 * Analyse une coordonnée saisie à la main.
 *
 * Accepte les formats réellement utilisés sur le terrain :
 *   - décimal point ou virgule : `4.051056`, `4,051056` ;
 *   - degrés/minutes/secondes : `4°03'03.8"N`, `9°42'30.7"E` ;
 *   - degrés décimaux avec hémisphère : `4.051056 N`, `9.708533 E`.
 * Renvoie `null` si la valeur n'est pas exploitable.
 */
export function parseCoordinate(
  raw: string,
  kind: "lat" | "lng",
): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const limit = kind === "lat" ? 90 : 180;
  // L'hémisphère n'est cherché qu'en fin de saisie : « S » de « Sud » ou « E »
  // de « Est » ne doivent pas être confondus avec un chiffre.
  const hemisphere = /([NSEW])\s*$/i.exec(text)?.[1]?.toUpperCase();
  const negative = hemisphere === "S" || hemisphere === "W" || /^-/.test(text);

  const dms = /(\d+(?:[.,]\d+)?)\s*[°d]\s*(?:(\d+(?:[.,]\d+)?)\s*['′m])?\s*(?:(\d+(?:[.,]\d+)?)\s*(?:"|″|s)?)?/.exec(
    text,
  );
  if (dms && /[°d'′"″]/.test(text)) {
    const deg = Number(dms[1].replace(",", "."));
    const min = Number((dms[2] || "0").replace(",", "."));
    const sec = Number((dms[3] || "0").replace(",", "."));
    if (![deg, min, sec].every(Number.isFinite)) return null;
    const value = deg + min / 60 + sec / 3600;
    if (value > limit) return null;
    return negative ? -value : value;
  }

  // Saisie décimale : on ne garde que chiffres, signe et séparateur décimal.
  // Une saisie sans aucun chiffre (« abc ») doit être refusée, pas lue comme 0.
  const cleaned = text.replace(/[^0-9.,-]/g, "").replace(",", ".");
  if (!/\d/.test(cleaned)) return null;
  const plain = Number(cleaned);
  if (!Number.isFinite(plain) || Math.abs(plain) > limit) return null;
  // Le signe explicite (« -4.05 ») prime sur l'hémisphère.
  if (plain < 0) return plain;
  return negative ? -plain : plain;
}

/**
 * Analyse une paire « lat, lng » collée d'un seul bloc (Google Maps, GPS).
 * Google Maps copie `4.051056, 9.708533` ; certains appareils ajoutent des
 * espaces ou des parenthèses. On accepte aussi l'ordre inversé quand la
 * première valeur dépasse 90 (donc forcément une longitude).
 */
export function parseCoordinatePair(
  raw: string,
): { lat: number; lng: number } | null {
  const numbers = String(raw ?? "")
    .replace(/,/g, (match, offset, whole) =>
      // Une virgule décimale est suivie d'un chiffre sans espace : on la garde.
      /\d\s*$/.test(whole.slice(0, offset)) &&
      /^\d{1,2}\s*$/.test(whole.slice(offset + 1, offset + 4))
        ? "."
        : " ",
    )
    .match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 2) return null;
  const first = Number(numbers[0]);
  const second = Number(numbers[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  const firstIsLat = Math.abs(first) <= 90;
  const secondIsLat = Math.abs(second) <= 90;
  const firstIsLng = Math.abs(first) <= 180;
  const secondIsLng = Math.abs(second) <= 180;
  // Ordre normal (lat, lng) dès que la première valeur peut être une latitude.
  if (firstIsLat && secondIsLng) return { lat: first, lng: second };
  // Ordre inversé (lng, lat) : la première valeur dépasse forcément 90.
  if (secondIsLat && firstIsLng) return { lat: second, lng: first };
  return null;
}

/*
 * Fond de carte : OpenStreetMap standard.
 *
 * Le fournisseur précédent (Esri World Street Map) ne servait au Cameroun que
 * des tuiles pauvres — mesuré à Douala, zoom 17 : 2 à 6 ko par tuile contre
 * 20 à 29 ko pour OpenStreetMap. Résultat visible : aucun carrefour, aucune
 * rue nommée, aucun bâtiment, alors que l'adresse d'une station doit être
 * reconnaissable sur le terrain (rond-point, marché, école, snack…).
 *
 * OpenStreetMap contient ces références, et les tuiles sont plus rapides
 * (500 ms contre 1 100 ms).
 *
 * Projection : Web Mercator (EPSG:3857), exactement celle de Google Maps.
 * Une même paire latitude/longitude tombe donc au même endroit sur les deux
 * cartes ; aucun décalage n'est introduit côté Leaflet.
 */
export const MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_TILE_OPTIONS = {
  tileSize: 256,
  zoomOffset: 0,
  // Une tuile manquante ne doit pas laisser un trou gris.
  detectRetina: true,
  /*
   * OpenStreetMap limite le débit par client : un écran de carte demande
   * facilement 20 tuiles d'un coup, et le fournisseur en refuse une partie
   * (403), ce qui laissait des zones grises. On n'ouvre donc pas plus de
   * quelques connexions simultanées et on conserve les tuiles déjà obtenues.
   */
  maxNativeZoom: 19,
  crossOrigin: true,
  keepBuffer: 4,
};
export const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> — rues, bâtiments et points d’intérêt';

/**
 * Couche de repères (rues nommées, marchés, écoles, hôpitaux, hôtels,
 * boutiques, entreprises, carrefours, ronds-points…).
 *
 * Les tuiles raster OpenStreetMap n'affichent que les libellés majeurs : à
 * l'échelle d'une station, l'agent ne reconnaît ni le marché voisin ni
 * l'école d'en face. Cette couche vectorielle superpose les points d'intérêt
 * et les noms de rues, sans changer la géométrie de la carte (donc sans
 * décalage par rapport à Google Maps).
 */
export const MAP_POI_TILE_URL =
  "https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png";
export const MAP_POI_ATTRIBUTION =
  '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

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

/**
 * Recherche d'adresse auprès de Nominatim (OpenStreetMap).
 *
 * Trois règles imposées par le service, sans lesquelles il répond vide ou
 * bloque la requête :
 *   - un `User-Agent` identifiable (un navigateur seul n'en envoie pas un
 *     assez explicite) ;
 *   - pas de rafale de requêtes (d'où la marge côté appelant) ;
 *   - une requête suffisamment large : `countrycodes=cm` rejetait des
 *     adresses saisies sans le pays, la recherche renvoyait alors zéro
 *     résultat et la carte restait sans référence.
 */
async function nominatimSearch(query: string): Promise<any[]> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2' +
    `&q=${encodeURIComponent(query)}` +
    '&limit=8&addressdetails=1&accept-language=fr';
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      // Identifie l'application, comme l'exige la charte d'usage de Nominatim.
      'User-Agent': 'uSwap/1.0 (gestion de stations)',
    },
  });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Recherche d'un lieu par son nom, restreinte au Cameroun.
 *
 * Nominatim classe les résultats par pertinence textuelle, pas par proximité :
 * « Ndobo » peut renvoyer un hameau homonyme à l'autre bout du pays. On demande
 * donc explicitement le pays et on privilégie les résultats proches du point de
 * référence (la ville saisie, ou le centre de la carte).
 */
async function nominatimSearchNear(
  query: string,
  near: { lat: number; lng: number } | null,
): Promise<any[]> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2' +
    `&q=${encodeURIComponent(query)}` +
    '&limit=10&addressdetails=1&accept-language=fr&countrycodes=cm' +
    (near
      ? `&viewbox=${near.lng - 0.6},${near.lat + 0.6},${near.lng + 0.6},${near.lat - 0.6}&bounded=0`
      : '');
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'uSwap/1.0 (gestion de stations)',
    },
  });
  if (!response.ok) return [];
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  if (!near) return data;
  // Tri par distance : le lieu le plus proche du point de référence d'abord.
  return [...data].sort(
    (a, b) =>
      distanceMeters(near, Number(a.lat), Number(a.lon)) -
      distanceMeters(near, Number(b.lat), Number(b.lon)),
  );
}

/** Distance approximative (mètres) entre deux points, suffisante pour trier. */
function distanceMeters(
  from: { lat: number; lng: number },
  lat: number,
  lng: number,
): number {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Number.MAX_VALUE;
  const dLat = (lat - from.lat) * 111_320;
  const dLng =
    (lng - from.lng) * 111_320 * Math.cos((from.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
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
  // Saisie manuelle des coordonnées : l'agent qui possède déjà le point GPS
  // (relevé terrain, Google Maps) doit pouvoir le coller tel quel.
  const [latInput, setLatInput] = useState(
    latitude === "" || latitude == null ? "" : String(latitude),
  );
  const [lngInput, setLngInput] = useState(
    longitude === "" || longitude == null ? "" : String(longitude),
  );
  const [coordsError, setCoordsError] = useState("");
  // Position de l'appareil (téléphone de l'agent sur le terrain).
  const [locating, setLocating] = useState(false);
  const [locateInfo, setLocateInfo] = useState("");
  const [locateError, setLocateError] = useState("");
  // Dernier point réellement retenu (clic, glisser, GPS, adresse). Il sert de
  // référence pour départager les homonymes d'adresse, même quand le parent
  // n'a pas encore propagé les coordonnées.
  const lastPoint = useRef<{ lat: number; lng: number } | null>(null);
  // Moteur cartographique réellement affiché : Google Maps si une clé est
  // configurée, sinon OpenStreetMap (Leaflet).
  const [engine, setEngine] = useState<"google" | "osm">(
    googleMapsApiKey() ? "google" : "osm",
  );
  const googleMapRef = useRef<any>(null);
  const googleMarkerRef = useRef<any>(null);
  const googleCircleRef = useRef<any>(null);
  const googleGeocoderRef = useRef<any>(null);
  const googleAutocompleteRef = useRef<any>(null);

  const hasCoords =
    latitude !== "" &&
    latitude != null &&
    longitude !== "" &&
    longitude != null &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude));
  const currentLat = hasCoords ? Number(latitude) : DEFAULT_LAT;
  const currentLng = hasCoords ? Number(longitude) : DEFAULT_LNG;
  const radius = Number(geofenceRadiusMeters) || 150;

  useEffect(() => {
    setSearchQuery(address);
    lastQuery.current = address.trim().toLowerCase();
  }, [address]);

  // Les champs GPS suivent les coordonnées réellement retenues (clic sur la
  // carte, glisser du repère, suggestion d'adresse), sans écraser une saisie
  // en cours de frappe.
  useEffect(() => {
    if (!hasCoords) return;
    const lat = Number(latitude);
    const lng = Number(longitude);
    setLatInput((old) =>
      parseCoordinate(old, "lat") === lat ? old : lat.toFixed(6),
    );
    setLngInput((old) =>
      parseCoordinate(old, "lng") === lng ? old : lng.toFixed(6),
    );
  }, [latitude, longitude, hasCoords]);

  function applyPosition(lat: number, lng: number, zoom?: number) {
    lastPoint.current = { lat, lng };

    // Google Maps : mêmes coordonnées, même projection (WGS84 / Web Mercator).
    const gMap = googleMapRef.current;
    if (gMap) {
      const position = { lat, lng };
      googleMarkerRef.current?.setPosition(position);
      googleCircleRef.current?.setCenter(position);
      gMap.panTo(position);
      if (zoom) gMap.setZoom(zoom);
      return;
    }

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
   * Géocodage via Google Maps quand il est disponible.
   *
   * C'est la seule façon de garantir que l'adresse et le point affichés sont
   * exactement ceux de Google Maps : Nominatim et Google n'ont pas la même
   * base d'adresses, et un même nom de quartier peut y désigner deux points
   * distants de plusieurs centaines de mètres.
   */
  async function googleGeocode(
    query: string,
  ): Promise<{ lat: number; lng: number; label: string } | null> {
    const geocoder = googleGeocoderRef.current;
    if (!geocoder) return null;
    try {
      const response = await geocoder.geocode({
        address: query,
        componentRestrictions: { country: "CM" },
        region: "CM",
      });
      const best = response?.results?.[0];
      const location = best?.geometry?.location;
      if (!location) return null;
      return {
        lat: location.lat(),
        lng: location.lng(),
        label: best.formatted_address || query,
      };
    } catch (error) {
      console.warn("Géocodage Google Maps impossible", error);
      return null;
    }
  }

  /**
   * Suggestions d'adresses via Google Places (autocomplétion).
   *
   * Les résultats sont triés par distance au point de référence : Google
   * classe par pertinence mondiale, ce qui fait remonter des homonymes
   * lointains (« Ndobo » existe dans plusieurs villes du Cameroun).
   */
  async function googlePlacesSuggestions(
    query: string,
    near: { lat: number; lng: number } | null,
  ): Promise<Array<{ label: string; lat: number; lng: number }>> {
    const places = (window as any).google?.maps?.places;
    if (!places) return [];
    try {
      const service = new places.AutocompleteService();
      const predictions: any[] = await new Promise((resolve) => {
        service.getPlacePredictions(
          {
            input: query,
            componentRestrictions: { country: "cm" },
            language: "fr",
            ...(near
              ? {
                  location: new (window as any).google.maps.LatLng(
                    near.lat,
                    near.lng,
                  ),
                  radius: 50_000,
                }
              : {}),
          },
          (results: any[] | null) => resolve(results || []),
        );
      });
      if (!predictions.length) return [];

      const geocoder = googleGeocoderRef.current;
      const detailed = await Promise.all(
        predictions.slice(0, 6).map(
          (prediction) =>
            new Promise<{ label: string; lat: number; lng: number } | null>(
              (resolve) => {
                if (!geocoder) return resolve(null);
                geocoder.geocode(
                  { placeId: prediction.place_id, language: "fr" },
                  (response: any, status: string) => {
                    const location =
                      status === "OK"
                        ? response?.[0]?.geometry?.location
                        : null;
                    if (!location) return resolve(null);
                    resolve({
                      label:
                        response[0].formatted_address ||
                        prediction.description,
                      lat: location.lat(),
                      lng: location.lng(),
                    });
                  },
                );
              },
            ),
        ),
      );
      const found = detailed.filter(
        (item): item is { label: string; lat: number; lng: number } => !!item,
      );
      if (!near) return found;
      return found.sort(
        (a, b) =>
          distanceMeters(near, a.lat, a.lng) -
          distanceMeters(near, b.lat, b.lng),
      );
    } catch (error) {
      console.warn("Suggestions Google Maps indisponibles", error);
      return [];
    }
  }

  /** Adresse lisible d'un point, via Google Maps si disponible. */
  async function googleReverse(lat: number, lng: number): Promise<string> {
    const geocoder = googleGeocoderRef.current;
    if (!geocoder) return "";
    try {
      const response = await geocoder.geocode({
        location: { lat, lng },
        language: "fr",
      });
      return response?.results?.[0]?.formatted_address || "";
    } catch {
      return "";
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
      /*
       * Point de référence : la position déjà retenue (saisie GPS, clic sur la
       * carte) ou, à défaut, le centre de la carte. Il sert à départager les
       * homonymes — « Ndobo » existe dans plusieurs villes du Cameroun.
       */
      const map = mapInstanceRef.current;
      const center = map?.getCenter?.();
      const near = hasCoords
        ? { lat: Number(latitude), lng: Number(longitude) }
        : (lastPoint.current ??
          (center ? { lat: center.lat, lng: center.lng } : null));

      // Google Maps d'abord : c'est la référence demandée par le terrain.
      const google = await googleGeocode(query);
      if (google) {
        onSelectAddress(google.label, google.lat, google.lng);
        applyPosition(google.lat, google.lng, zoomForRadius(radius));
        lastQuery.current = google.label.trim().toLowerCase();
        setResolved("");
        return true;
      }

      let results = await nominatimSearchNear(query, near);
      if (!results.length) results = await nominatimSearch(query);
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
      // Google Maps d'abord : l'adresse affichée doit être celle que l'agent
      // retrouve en collant les coordonnées dans Google Maps.
      const label =
        (await googleReverse(lat, lng)) || (await nominatimReverse(lat, lng));
      if (!label) return;
      onSelectAddress(label, lat, lng);
      lastQuery.current = label.trim().toLowerCase();
    } catch (error) {
      console.warn("Géocodage inversé impossible", error);
    }
  }

  /**
   * Applique une paire de coordonnées saisie à la main.
   *
   * Le point est posé immédiatement sur la carte (sans attendre le géocodage
   * inverse, qui peut être lent ou indisponible) : c'est la position exacte
   * demandée par l'agent. L'adresse est ensuite complétée si le service
   * répond, sans jamais déplacer le repère.
   */
  function applyManualCoords(lat: number, lng: number) {
    setCoordsError("");
    onSelectLocation(lat, lng);
    const currentZoom =
      googleMapRef.current?.getZoom?.() ?? mapInstanceRef.current?.getZoom?.() ?? 0;
    applyPosition(lat, lng, Math.max(currentZoom, 17));
    void reverseGeocode(lat, lng);
  }

  /**
   * Récupère la position de l'appareil et la pose comme emplacement.
   *
   * C'est le cas d'usage terrain : l'agent est devant la station, avec son
   * téléphone, et veut enregistrer le point exact sans le relever à la main.
   *
   * Contraintes mobiles prises en compte :
   *   - l'API n'existe que sur une origine sécurisée (HTTPS ou localhost) ;
   *   - le navigateur exige un geste utilisateur (d'où le bouton, jamais un
   *     appel automatique au chargement) ;
   *   - `enableHighAccuracy` + `maximumAge: 0` évitent un point mis en cache ;
   *   - un premier relevé peut être grossier (antenne relais) : on attend une
   *     mesure précise pendant quelques secondes avant de valider.
   */
  async function useMyLocation() {
    setLocateError("");
    setLocateInfo("");

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateError(
        "La géolocalisation n’est pas disponible sur cet appareil ou ce navigateur.",
      );
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.isSecureContext &&
      !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ) {
      setLocateError(
        "La localisation exige une connexion sécurisée (HTTPS). Ouvrez le site en https:// puis réessayez.",
      );
      return;
    }

    /*
     * Étape 1 — la localisation est-elle activée sur l'appareil ?
     *
     * Si l'agent a refusé l'autorisation lors d'une visite précédente, le
     * navigateur répond « refusé » instantanément, sans jamais demander. On
     * vérifie donc l'état AVANT de lancer le relevé, pour afficher une consigne
     * d'activation au lieu d'un échec silencieux.
     */
    const permission = await readGeolocationPermission();
    if (permission === "denied") {
      setLocateError(
        "La localisation est désactivée pour ce site. Activez-la avant de continuer : " +
          "appuyez sur l’icône de cadenas (ou de réglages) à gauche de l’adresse, " +
          "puis autorisez « Position / Localisation », et réessayez.",
      );
      return;
    }

    setLocating(true);
    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 20_000,
            maximumAge: 0,
          });
        },
      );

      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracy = Math.round(position.coords.accuracy || 0);

      setLatInput(lat.toFixed(6));
      setLngInput(lng.toFixed(6));
      applyManualCoords(lat, lng);

      setLocateInfo(
        accuracy > 0
          ? `Position de l’appareil appliquée (précision ±${accuracy} m).`
          : "Position de l’appareil appliquée.",
      );
      if (accuracy > 100) {
        setLocateInfo(
          `Position appliquée mais imprécise (±${accuracy} m) : déplacez le repère sur la carte pour affiner.`,
        );
      }
    } catch (error) {
      const positionError = error as GeolocationPositionError;
      setLocateError(geolocationErrorMessage(positionError));
    } finally {
      setLocating(false);
    }
  }

  /**
   * Message d'erreur de géolocalisation, avec la consigne d'activation.
   *
   * Code 1 = autorisation refusée (ou localisation coupée au niveau du
   * système) : on explique comment l'activer, au lieu de constater l'échec.
   * Code 2 = position indisponible (GPS coupé, mode avion, intérieur).
   * Code 3 = délai dépassé.
   */
  function geolocationErrorMessage(error: GeolocationPositionError): string {
    if (error?.code === 1) {
      return (
        "La localisation est désactivée. Activez-la avant de continuer : " +
        "réglages du téléphone → Localisation, puis autorisez la position pour ce site " +
        "(icône de cadenas à gauche de l’adresse), et réessayez."
      );
    }
    if (error?.code === 2) {
      return (
        "Position indisponible : activez la localisation (GPS) du téléphone, " +
        "sortez à découvert et réessayez."
      );
    }
    if (error?.code === 3) {
      return "La localisation prend trop de temps. Activez le GPS, sortez à découvert et réessayez.";
    }
    return "Position introuvable. Vérifiez que la localisation du téléphone est activée.";
  }

  function commitManualCoords() {
    // Champs vides : la saisie GPS est facultative, l'adresse ou le clic sur la
    // carte suffisent. On ne signale une erreur que sur une valeur réellement
    // saisie mais inexploitable.
    if (!latInput.trim() && !lngInput.trim()) {
      setCoordsError("");
      return;
    }
    const lat = parseCoordinate(latInput, "lat");
    const lng = parseCoordinate(lngInput, "lng");
    if (lat === null || lng === null) {
      setCoordsError(
        "Coordonnées invalides : latitude entre -90 et 90, longitude entre -180 et 180.",
      );
      return;
    }
    applyManualCoords(lat, lng);
  }

  /** Colle « 4.051056, 9.708533 » (format Google Maps) dans les deux champs. */
  function handlePastePair(value: string) {
    const pair = parseCoordinatePair(value);
    if (!pair) return false;
    setLatInput(pair.lat.toFixed(6));
    setLngInput(pair.lng.toFixed(6));
    applyManualCoords(pair.lat, pair.lng);
    return true;
  }

  function handleSearchInput(value: string) {
    setSearchQuery(value);
    setResolved("");
    if (searchTimer.current) window.clearTimeout(searchTimer.current);

    /*
     * Une paire de coordonnées collée dans le champ adresse (lien Google Maps,
     * relevé GPS) est traitée comme telle : on ne l'envoie pas au géocodeur,
     * qui ne saurait pas la lire.
     */
    if (parseCoordinatePair(value)) {
      setSuggestions([]);
      return;
    }

    if (value.trim().length < 4) {
      setSuggestions([]);
      return;
    }

    // Suggestions + résolution automatique : même sans cliquer sur une
    // suggestion, les coordonnées suivent l'adresse saisie.
    searchTimer.current = window.setTimeout(async () => {
      try {
        const map = mapInstanceRef.current;
        const center = map?.getCenter?.();
        const near = hasCoords
          ? { lat: Number(latitude), lng: Number(longitude) }
          : (lastPoint.current ??
            (center ? { lat: center.lat, lng: center.lng } : null));

        // Google Places d'abord : mêmes suggestions que dans Google Maps.
        const places = await googlePlacesSuggestions(value.trim(), near);
        if (places.length) {
          setSuggestions(places);
          return;
        }

        const results = await nominatimSearchNear(value.trim(), near);
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
    // Coordonnées collées dans le champ adresse : on les applique directement.
    if (handlePastePair(searchQuery)) return;
    void resolveAddress(searchQuery);
  }

  function selectSuggestion(item: { label: string; lat: number; lng: number }) {
    setSearchQuery(item.label);
    setSuggestions([]);
    onSelectAddress(item.label, item.lat, item.lng);
    applyPosition(item.lat, item.lng, zoomForRadius(radius));
  }

  /*
   * Moteur cartographique.
   *
   * Google Maps est utilisé dès qu'une clé est configurée : c'est la seule
   * façon de garantir que le repère, le périmètre et les adresses sont
   * exactement ceux de Google Maps. Sans clé (ou si le chargement échoue), on
   * retombe sur OpenStreetMap/Leaflet, qui reste pleinement fonctionnel.
   */
  useEffect(() => {
    const apiKey = googleMapsApiKey();
    if (!apiKey) return;
    let disposed = false;

    void loadGoogleMaps(apiKey)
      .then((maps) => {
        if (disposed || !mapContainerRef.current) return;
        if (mapInstanceRef.current) {
          // Leaflet déjà monté : on le retire avant de basculer sur Google.
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
          markerRef.current = null;
          circleRef.current = null;
        }
        mapContainerRef.current.innerHTML = "";

        const map = new maps.Map(mapContainerRef.current, {
          center: { lat: currentLat, lng: currentLng },
          zoom: zoomForRadius(radius),
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
          clickableIcons: true,
          gestureHandling: "greedy",
          language: "fr",
          region: "CM",
        });
        googleMapRef.current = map;
        googleGeocoderRef.current = new maps.Geocoder();

        const marker = new maps.Marker({
          position: { lat: currentLat, lng: currentLng },
          map,
          draggable: true,
          title: "Emplacement de la station",
        });
        googleMarkerRef.current = marker;

        // Périmètre de pointage : même rayon, mêmes mètres que côté Leaflet.
        const circle = new maps.Circle({
          center: { lat: currentLat, lng: currentLng },
          radius,
          map,
          strokeColor: "#2d6cdf",
          strokeWeight: 2,
          fillColor: "#2d6cdf",
          fillOpacity: 0.12,
        });
        googleCircleRef.current = circle;

        marker.addListener("dragend", () => {
          const position = marker.getPosition();
          if (!position) return;
          const lat = position.lat();
          const lng = position.lng();
          lastPoint.current = { lat, lng };
          circle.setCenter(position);
          onSelectLocation(lat, lng);
          void reverseGeocode(lat, lng);
        });

        map.addListener("click", (event: any) => {
          const lat = event.latLng.lat();
          const lng = event.latLng.lng();
          lastPoint.current = { lat, lng };
          marker.setPosition({ lat, lng });
          circle.setCenter({ lat, lng });
          onSelectLocation(lat, lng);
          void reverseGeocode(lat, lng);
        });

        setEngine("google");
        setMapError("");

        if (!hasCoords) {
          marker.setVisible(false);
          circle.setVisible(false);
          if (address.trim().length >= 4) {
            void resolveAddress(address).then((found) => {
              if (found) return;
              marker.setVisible(true);
              circle.setVisible(true);
            });
          } else {
            marker.setVisible(true);
            circle.setVisible(true);
          }
        }
      })
      .catch((error: Error) => {
        if (disposed) return;
        // Clé invalide ou réseau bloqué : on garde OpenStreetMap.
        console.warn("Google Maps indisponible, bascule sur OpenStreetMap", error);
        setEngine("osm");
      });

    return () => {
      disposed = true;
      googleMapRef.current = null;
      googleMarkerRef.current = null;
      googleCircleRef.current = null;
      googleGeocoderRef.current = null;
    };
    // Carte créée une seule fois : les mises à jour passent par les refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (engine === "google") return;
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

      /*
       * Deux couches superposées, strictement alignées (même projection Web
       * Mercator, même origine de tuiles) :
       *   1. le fond OpenStreetMap, qui donne les rues, les bâtiments et les
       *      libellés majeurs ;
       *   2. la couche de repères (marchés, écoles, hôpitaux, hôtels, boutiques,
       *      entreprises, carrefours, ronds-points, noms de rues) qui rend la
       *      carte explicite à l'échelle d'une station.
       * Si la seconde couche est indisponible, la première reste affichée :
       * la carte ne doit jamais devenir vide.
       */
      L.tileLayer(MAP_TILE_URL, {
        ...MAP_TILE_OPTIONS,
        maxZoom: 20,
        // Sans limite basse, un zoom arrière extrême demandait des tuiles
        // inexistantes et affichait un fond vide.
        minZoom: 3,
        attribution: MAP_ATTRIBUTION,
      }).addTo(map);

      const poiLayer = L.tileLayer(MAP_POI_TILE_URL, {
        maxZoom: 20,
        minZoom: 3,
        maxNativeZoom: 20,
        detectRetina: true,
        crossOrigin: true,
        keepBuffer: 4,
        attribution: MAP_POI_ATTRIBUTION,
      });
      poiLayer.on("tileerror", () => {
        // Fournisseur de repères indisponible : on retire la couche pour ne
        // pas laisser de tuiles grises par-dessus le fond OpenStreetMap.
        if (map.hasLayer(poiLayer)) map.removeLayer(poiLayer);
      });
      poiLayer.addTo(map);

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
        lastPoint.current = { lat: coords.lat, lng: coords.lng };
        if (circleRef.current) circleRef.current.setLatLng(coords);
        onSelectLocation(coords.lat, coords.lng);
        void reverseGeocode(coords.lat, coords.lng);
      });

      map.on("click", (event: any) => {
        const { lat, lng } = event.latlng;
        lastPoint.current = { lat, lng };
        marker.setLatLng([lat, lng]);
        if (circleRef.current) circleRef.current.setLatLng([lat, lng]);
        onSelectLocation(lat, lng);
        void reverseGeocode(lat, lng);
      });

      /*
       * Adresse déjà connue mais sans coordonnées (import, saisie directe) :
       * on la résout une fois la carte prête. Le repère est alors placé sur le
       * point trouvé, et non laissé au centre de Douala.
       *
       * Le repère n'est PAS affiché au centre de Douala tant que la résolution
       * n'a pas abouti : un point inventé se lit comme « la station est ici ».
       */
      if (!hasCoords) {
        if (address.trim().length >= 4) {
          marker.setOpacity(0);
          circle.setStyle({ opacity: 0, fillOpacity: 0 });
          void resolveAddress(address).then((found) => {
            if (found) return;
            // Adresse non résolue : on rend le repère pour un placement manuel.
            marker.setOpacity(1);
            circle.setStyle({ opacity: 1, fillOpacity: 0.12 });
          });
        } else {
          // Aucune adresse, aucune coordonnée : le repère reste visible pour
          // que l'agent puisse le poser lui-même.
          marker.setOpacity(1);
        }
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

  /*
   * Le repère suit les coordonnées retenues, mais la carte ne se recentre que
   * si le point sort du cadre visible. Avant, chaque changement de coordonnées
   * (clic, glisser, saisie GPS) forçait un `setView` : la carte sautait sous le
   * doigt de l'agent et le repère semblait se déplacer tout seul.
   */
  useEffect(() => {
    // Google Maps : mêmes règles, mêmes coordonnées.
    const gMap = googleMapRef.current;
    const gMarker = googleMarkerRef.current;
    const gCircle = googleCircleRef.current;
    if (gMap && gMarker) {
      if (!hasCoords) {
        gMarker.setVisible(false);
        gCircle?.setVisible(false);
        return;
      }
      const position = { lat: currentLat, lng: currentLng };
      gMarker.setVisible(true);
      gCircle?.setVisible(true);
      gMarker.setPosition(position);
      gCircle?.setCenter(position);
      const bounds = gMap.getBounds();
      if (!bounds || !bounds.contains(position)) {
        gMap.panTo(position);
      }
      return;
    }

    const map = mapInstanceRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    // Sans coordonnées réelles, le repère reste au centre de Douala mais
    // invisible : il ne doit pas passer pour l'emplacement de la station.
    if (!hasCoords) {
      marker.setOpacity(0);
      circleRef.current?.setStyle({ opacity: 0, fillOpacity: 0 });
      return;
    }
    marker.setOpacity(1);
    circleRef.current?.setStyle({ opacity: 1, fillOpacity: 0.12 });
    marker.setLatLng([currentLat, currentLng]);
    circleRef.current?.setLatLng([currentLat, currentLng]);
    if (!map.getBounds().pad(-0.15).contains([currentLat, currentLng])) {
      map.setView([currentLat, currentLng], map.getZoom(), { animate: true });
    }
  }, [currentLat, currentLng, hasCoords]);

  useEffect(() => {
    circleRef.current?.setRadius(radius);
    googleCircleRef.current?.setRadius(radius);
  }, [radius]);

  return (
    <div className="map-picker-wrapper">
      <div className="stepper-field-group map-picker-field">
        <label>ADRESSE DE LA STATION *</label>
        <div className="map-picker-input-wrap">
          <input
            maxLength={250}
            placeholder="Ex : Tradex Bonamoussadi, Douala — ou collez 4.051056, 9.708533"
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
                {/*
                 * Coordonnées visibles : l'agent voit immédiatement si le
                 * résultat est le bon lieu (homonymes fréquents : « Ndobo »
                 * existe dans plusieurs villes).
                 */}
                <small className="map-picker-suggestion-coords">
                  {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                </small>
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

      {/*
       * Saisie directe des coordonnées : l'agent qui possède déjà le point
       * exact (relevé GPS, lien Google Maps) n'a pas à chercher l'adresse.
       * Dès que les deux valeurs sont valides, le repère se place dessus.
       */}
      <div className="map-picker-gps">
        <div className="map-picker-gps-head">
          <span>COORDONNÉES GPS (OPTIONNEL)</span>
          <span className="map-picker-hint">
            Collez « lat, lng » ou saisissez chaque valeur
          </span>
        </div>
        <div className="map-picker-gps-grid">
          <div className="stepper-field-group">
            <label htmlFor="station-latitude">LATITUDE</label>
            <input
              id="station-latitude"
              inputMode="decimal"
              autoComplete="off"
              placeholder="ex : 4.051056"
              value={latInput}
              onChange={(event) => {
                setLatInput(event.target.value);
                setCoordsError("");
              }}
              onPaste={(event) => {
                const text = event.clipboardData.getData("text");
                if (handlePastePair(text)) event.preventDefault();
              }}
              onBlur={commitManualCoords}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitManualCoords();
                }
              }}
            />
          </div>
          <div className="stepper-field-group">
            <label htmlFor="station-longitude">LONGITUDE</label>
            <input
              id="station-longitude"
              inputMode="decimal"
              autoComplete="off"
              placeholder="ex : 9.708533"
              value={lngInput}
              onChange={(event) => {
                setLngInput(event.target.value);
                setCoordsError("");
              }}
              onPaste={(event) => {
                const text = event.clipboardData.getData("text");
                if (handlePastePair(text)) event.preventDefault();
              }}
              onBlur={commitManualCoords}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitManualCoords();
                }
              }}
            />
          </div>
        </div>
        {/*
         * Relevé direct sur le terrain : l'agent est devant la station avec
         * son téléphone, il appuie une fois et le point est posé.
         */}
        <button
          type="button"
          className="map-picker-locate"
          onClick={() => void useMyLocation()}
          disabled={locating}
        >
          {locating ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <CrosshairIcon size={16} />
          )}
          {locating
            ? "Recherche de votre position…"
            : "Utiliser ma position actuelle"}
        </button>
        {locateInfo && (
          <p className="map-picker-locate-info" role="status">
            {locateInfo}
          </p>
        )}
        {locateError && (
          <p className="map-picker-error" role="alert">
            {locateError}
          </p>
        )}
        {coordsError && (
          <p className="map-picker-error" role="alert">
            {coordsError}
          </p>
        )}
      </div>

      <div className="map-picker-caption">
        <span>POSITION DU REPÈRE *</span>
        <span className="map-picker-hint">
          <CrosshairIcon size={14} /> Cliquez ou glissez le repère pour ajuster
          l’emplacement
        </span>
        {/*
         * Indique le fond réellement affiché : l'agent sait si les adresses
         * proviennent de Google Maps (référence terrain) ou d'OpenStreetMap.
         */}
        <span className="map-picker-engine">
          {engine === "google" ? "Fond Google Maps" : "Fond OpenStreetMap"}
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
        {hasCoords && (
          <a
            className="map-picker-verify"
            href={`https://www.google.com/maps?q=${Number(latitude)},${Number(longitude)}`}
            target="_blank"
            rel="noreferrer"
          >
            Vérifier sur Google Maps
          </a>
        )}
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
