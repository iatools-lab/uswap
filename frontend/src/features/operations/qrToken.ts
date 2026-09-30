const STORAGE_KEY = "uswap-qr-token";
const TOKEN = /^[a-f0-9]{64}$/;

/** Vrai si la chaîne est un jeton QR brut valide (64 caractères hexadécimaux). */
export function isValidQrToken(value: string): boolean {
  return TOKEN.test(value);
}

let memory = "";

function persist(value: string) {
  memory = value;
  try {
    sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* navigation privée */
  }
}

function fromHref(href: string): string {
  try {
    const url = new URL(href, window.location.origin);
    const hashQuery = new URLSearchParams(url.hash.replace(/^#/, ""));
    const hashRaw = url.hash.replace(/^#/, "");
    const candidates = [
      url.searchParams.get("qr") || "",
      hashQuery.get("qr") || "",
      hashRaw,
    ];
    for (const value of candidates) {
      if (TOKEN.test(value)) return value;
    }
    return "";
  } catch {
    return TOKEN.test(href.trim()) ? href.trim() : "";
  }
}

export function parseQrToken(input: string): string {
  const trimmed = input.trim();
  if (isValidQrToken(trimmed)) return trimmed;
  return fromHref(trimmed);
}

export function captureQrToken(): string {
  const found = fromHref(window.location.href);
  if (found) {
    persist(found);
    return found;
  }
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY) || "";
    if (TOKEN.test(stored)) {
      memory = stored;
      return stored;
    }
  } catch {
    /* ignore */
  }
  return TOKEN.test(memory) ? memory : "";
}

export function clearQrToken() {
  memory = "";
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function qrHomePath(rolePath: string, role: string): string {
  const token = captureQrToken();
  if (token && role === "SWAPPER") return `${rolePath}#qr=${token}`;
  return rolePath;
}
