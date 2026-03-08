const ROOM_SERIAL_REGEX = /\bODA-([A-Z0-9]{6})\b/i;

function randomChar(pool: string): string {
  const fallbackIndex = Math.floor(Math.random() * pool.length);

  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    return pool[fallbackIndex] ?? pool[0] ?? "A";
  }

  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  const index = bytes[0] % pool.length;
  return pool[index] ?? pool[fallbackIndex] ?? pool[0] ?? "A";
}

export function generateRoomSerial(length = 6): string {
  const pool = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const count = Math.max(4, Math.min(length, 12));
  let output = "";

  for (let i = 0; i < count; i += 1) {
    output += randomChar(pool);
  }

  return `ODA-${output}`;
}

export function extractRoomSerial(name: string | null | undefined): string | null {
  if (!name) return null;
  const match = name.match(ROOM_SERIAL_REGEX);
  if (!match?.[1]) return null;
  return `ODA-${match[1].toUpperCase()}`;
}

export function withRoomSerial(name: string, serial?: string | null): string {
  const base = name.trim() || "Oda";
  const ensuredSerial = serial?.trim() || generateRoomSerial();

  if (ROOM_SERIAL_REGEX.test(base)) {
    return base.replace(ROOM_SERIAL_REGEX, ensuredSerial.toUpperCase());
  }

  return `${base} • ${ensuredSerial.toUpperCase()}`;
}
