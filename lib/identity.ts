/**
 * Player identity.
 *
 * MiniPay forbids showing a raw `0x…` address as the primary identifier. Clash resolves an
 * address to a stable, readable alias — deterministic, so the same player always appears as the
 * same handle on the leaderboard, on every device, with no server lookup.
 *
 * The productionised path is a phone-number identity resolved through ODIS →
 * FederatedAttestations. That needs an ODIS quota and a session key, so it is deliberately not on
 * the critical path for launch; `resolveIdentity` is the seam where it slots in.
 */
import { hashSeed } from "./rng";

const ADJECTIVES = [
  "Swift", "Bold", "Sharp", "Quick", "Brave", "Clever", "Fierce", "Calm",
  "Bright", "Steady", "Wild", "Keen", "Sly", "Nimble", "Iron", "Golden",
  "Silent", "Rapid", "Lucky", "Royal", "Cosmic", "Electric", "Solar", "Turbo",
  "Neon", "Vivid", "Prime", "Alpha", "Rogue", "Stellar", "Rustic", "Crimson",
];

const NOUNS = [
  "Falcon", "Tiger", "Comet", "Panther", "Viper", "Eagle", "Fox", "Wolf",
  "Hawk", "Lynx", "Cobra", "Rhino", "Otter", "Raven", "Bison", "Jaguar",
  "Dolphin", "Puma", "Heron", "Badger", "Mantis", "Marlin", "Gecko", "Ibis",
  "Osprey", "Kestrel", "Tapir", "Oryx", "Serval", "Caracal", "Quokka", "Gazelle",
];

/**
 * Stable handle for an address. Three independent hashes of the same address give the adjective,
 * the noun and a two-digit suffix — plenty of spread to keep collisions rare on a leaderboard.
 */
export function aliasFor(address: string): string {
  const lower = address.toLowerCase();
  const a = hashSeed(`clash-adj:${lower}`) % ADJECTIVES.length;
  const n = hashSeed(`clash-noun:${lower}`) % NOUNS.length;
  const suffix = hashSeed(`clash-num:${lower}`) % 100;
  return `${ADJECTIVES[a]}${NOUNS[n]}${String(suffix).padStart(2, "0")}`;
}

export interface Identity {
  /** What the player is called everywhere in the UI. */
  displayName: string;
  /** Two initials for the avatar chip. */
  initials: string;
  /** Kept for explorer links only — never rendered as the player's name. */
  address: `0x${string}`;
}

export function resolveIdentity(address: `0x${string}`): Identity {
  const displayName = aliasFor(address);
  const upper = displayName.replace(/[^A-Z]/g, "");
  return {
    displayName,
    initials: (upper.slice(0, 1) + (upper.slice(1, 2) || "")).toUpperCase(),
    address,
  };
}

/** Deterministic accent hue for a player's avatar chip. */
export function avatarHue(address: string): number {
  return hashSeed(`clash-hue:${address.toLowerCase()}`) % 360;
}
