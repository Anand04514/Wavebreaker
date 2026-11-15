/** Small localStorage helpers. Every read is defensive: storage can be blocked. */
import { AUDIO, STORAGE, type CoachTip } from '../config';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — high score just won't persist */
  }
}

export function loadHighScore(): number {
  const raw = read(STORAGE.highScoreKey);
  const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Returns true when this run set a new best. */
export function saveHighScore(score: number): boolean {
  const best = loadHighScore();
  if (score > best) {
    write(STORAGE.highScoreKey, String(Math.round(score)));
    return true;
  }
  return false;
}

/** Layout picked in the ARENA MAPS panel; an unknown or missing id falls back to the default map. */
export function loadMapId(): string {
  return read(STORAGE.mapKey) ?? '';
}

export function saveMapId(id: string): void {
  write(STORAGE.mapKey, id);
}

export function loadMuted(): boolean {
  return read(AUDIO.muteStorageKey) === '1';
}

export function saveMuted(muted: boolean): void {
  write(AUDIO.muteStorageKey, muted ? '1' : '0');
}

const COACH_KEYS: Record<CoachTip, string> = {
  bomb: STORAGE.coachBombKey,
  dash: STORAGE.coachDashKey,
};

/**
 * First-run coach banners are once per player: a tip is remembered the moment it is shown, or the
 * moment the player uses the ability before it was needed.
 */
export function loadCoachTipSeen(tip: CoachTip): boolean {
  return read(COACH_KEYS[tip]) === '1';
}

export function saveCoachTipSeen(tip: CoachTip): void {
  write(COACH_KEYS[tip], '1');
}

export function loadVolume(): number {
  const raw = read(AUDIO.volumeStorageKey);
  const parsed = raw === null ? NaN : Number.parseFloat(raw);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : AUDIO.masterVolume;
}

export function saveVolume(volume: number): void {
  write(AUDIO.volumeStorageKey, String(volume));
}

/** Music is on unless the player turned it off; a missing key means on. */
export function loadMusicEnabled(): boolean {
  return read(AUDIO.musicStorageKey) !== '0';
}

export function saveMusicEnabled(enabled: boolean): void {
  write(AUDIO.musicStorageKey, enabled ? '1' : '0');
}
