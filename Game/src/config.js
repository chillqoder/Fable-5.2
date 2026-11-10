// DEEPWAKE — shared tuning constants. Pure data: safe to import from Node checks.

export const DT = 1 / 120;

export const C = {
  // ILO body
  bodyW: 0.75,
  bodyH: 1.5,

  // Ground / air movement
  maxSpeed: 6.5,
  carrySpeed: 4.5,
  groundAccel: 42,
  airAccel: 28,
  groundBrake: 38,
  airBrake: 8,
  gravity: 32,
  jumpSpeed: 13,
  fallLimit: 24,
  coyote: 0.11,
  jumpBuffer: 0.14,
  // Extra gravity while rising after an early release (tunes the short hop to ~1.2–1.5 u)
  releaseGravityScale: 2.8,

  // Walls
  wallSlideLimit: 3,
  wallJumpX: 7,
  wallJumpY: 12.5,
  wallSteerLock: 0.1,
  wallCoyote: 0.08,

  // Dash
  dashSpeed: 15,
  dashTime: 0.16,
  dashCooldown: 0.45,
  dashExitSpeed: 6.5,

  // Resonance energy
  energyMax: 100,
  pulseCost: 35,
  pulseCooldown: 0.7,
  pulseRadius: 6,
  pulseExpand: 0.35,
  regenDelay: 1.5,
  regenRate: 20,
  revealTime: 5,
  shieldCost: 50,
  shieldImmunity: 0.8,
  hitImmunity: 1.2,
  rebootImmunity: 1.0,
  cacheEnergy: 25,

  integrityMax: 3,

  // Interaction
  cellReach: 1.3,
  interactReach: 1.3,

  // State presentation timers (seconds)
  shutdownTime: 1.0,
  retryShutdownTime: 0.45,
  rebootTime: 0.9,
  relayTime: 2.6,

  // Enemies
  skitter: { speed: 1.4, detect: 5, telegraph: 0.5, lungeSpeed: 9.5, lungeTime: 0.38, recover: 0.9, stun: 2.0, w: 1.3, h: 0.6 },
  drone: { speed: 1.6, detect: 9, aim: 0.8, aimLock: 0.25, boltSpeed: 7, boltLife: 3.2, cooldown: 1.5, stun: 2.5, size: 0.9 },
  sentinel: { closed: 1.6, warning: 0.9, firing: 0.9, venting: 2.0, laneHalf: 0.3 },

  // Hazards
  vent: { dormant: 1.5, warning: 0.8, active: 1.0, height: 3.0, halfW: 0.45 },
  press: { wait: 1.7, telegraph: 0.7, slam: 0.16, hold: 0.55, rise: 0.9 },
  crushTime: 0.05,
};

export const STORAGE_KEY = 'deepwake.records';
export const SETTINGS_KEY = 'deepwake.settings';
export const RECORDS_VERSION = 1;
