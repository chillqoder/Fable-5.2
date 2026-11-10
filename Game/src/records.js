// DEEPWAKE — persistent personal records and settings.
// Versioned, validated, and safe when storage is missing, full, or corrupt.

import { STORAGE_KEY, SETTINGS_KEY, RECORDS_VERSION } from './config.js';

const validTime = (t) => typeof t === 'number' && Number.isFinite(t) && t > 0 && t < 1e7;
const validCount = (n) => Number.isInteger(n) && n >= 0 && n < 1e6;

export function emptyRecords() {
  return { version: RECORDS_VERSION, bestTime: null, bestFullArchiveTime: null, fewestRecoveries: null };
}

/** Returns a clean records object; unknown versions and malformed fields are ignored. */
export function validateRecords(raw) {
  const out = emptyRecords();
  if (!raw || typeof raw !== 'object' || raw.version !== RECORDS_VERSION) return out;
  if (validTime(raw.bestTime)) out.bestTime = raw.bestTime;
  if (validTime(raw.bestFullArchiveTime)) out.bestFullArchiveTime = raw.bestFullArchiveTime;
  const f = raw.fewestRecoveries;
  if (f && typeof f === 'object' && validCount(f.recoveries) && validTime(f.time)) {
    out.fewestRecoveries = { recoveries: f.recoveries, time: f.time };
  }
  return out;
}

/** Only a completed expedition (all three relays, committed result) qualifies. */
export function isCompletedResult(r) {
  return !!r && validTime(r.time) && validCount(r.recoveries) && validCount(r.archives)
    && Array.isArray(r.relays) && r.relays.length === 3 && r.relays.every((x) => x && x.active === true);
}

/** Pure: merge a result into records. Returns { records, improved }. */
export function applyResult(records, result) {
  const rec = validateRecords(records);
  const improved = { bestTime: false, bestFullArchiveTime: false, fewestRecoveries: false };
  if (!isCompletedResult(result)) return { records: rec, improved };
  if (rec.bestTime === null || result.time < rec.bestTime) { rec.bestTime = result.time; improved.bestTime = true; }
  if (result.archives === 3 && (rec.bestFullArchiveTime === null || result.time < rec.bestFullArchiveTime)) {
    rec.bestFullArchiveTime = result.time; improved.bestFullArchiveTime = true;
  }
  const f = rec.fewestRecoveries;
  // Fewer recoveries wins; completion time only breaks ties.
  if (f === null || result.recoveries < f.recoveries || (result.recoveries === f.recoveries && result.time < f.time)) {
    rec.fewestRecoveries = { recoveries: result.recoveries, time: result.time }; improved.fewestRecoveries = true;
  }
  return { records: rec, improved };
}

function safeStorage(candidate) {
  if (candidate !== undefined) return candidate;
  try { return globalThis.localStorage || null; } catch { return null; }
}

export class RecordStore {
  constructor(storage) {
    this.storage = safeStorage(storage);
    this.records = emptyRecords();
    this.persisted = false;
    this.load();
  }

  load() {
    try {
      const text = this.storage ? this.storage.getItem(STORAGE_KEY) : null;
      this.records = validateRecords(text ? JSON.parse(text) : null);
    } catch {
      this.records = emptyRecords();   // corrupt or unavailable: keep playing with in-memory records
    }
    return this.records;
  }

  /** Submit a committed expedition result. Returns which records improved. */
  submit(result) {
    const { records, improved } = applyResult(this.records, result);
    this.records = records;
    try {
      if (this.storage) { this.storage.setItem(STORAGE_KEY, JSON.stringify(records)); this.persisted = true; }
    } catch {
      this.persisted = false;          // full or blocked storage: records stay in memory
    }
    return improved;
  }
}

export class SettingsStore {
  constructor(storage) {
    this.storage = safeStorage(storage);
    this.values = { muted: false, reducedMotion: false };
    try {
      const raw = this.storage ? JSON.parse(this.storage.getItem(SETTINGS_KEY) || 'null') : null;
      if (raw && typeof raw === 'object') {
        if (typeof raw.muted === 'boolean') this.values.muted = raw.muted;
        if (typeof raw.reducedMotion === 'boolean') this.values.reducedMotion = raw.reducedMotion;
      }
    } catch { /* defaults */ }
  }

  set(key, value) {
    this.values[key] = value;
    try { if (this.storage) this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.values)); } catch { /* in-memory */ }
  }
}

export function formatTime(t) {
  if (!validTime(t)) return '—';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
