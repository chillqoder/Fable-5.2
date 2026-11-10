// DEEPWAKE — authored level data.
// Collision geometry and entity placement are explicit data. The renderer draws
// this data; it never decides collisions. Cell (i, j) covers [i, i+1) x [j, j+1).

export const W = 228;
export const H = 76;

export const TILE_AIR = 0;
export const TILE_ROCK = 1;
export const TILE_METAL = 2;

export const REGIONS = [
  { id: 'workshop', name: 'Buried Workshop', x0: 0, x1: 80.5 },
  { id: 'reservoir', name: 'Crystal Reservoir', x0: 80.5, x1: 136.5 },
  { id: 'foundry', name: 'Silent Foundry', x0: 136.5, x1: 206.5 },
  { id: 'ascent', name: 'Ascent Shaft', x0: 206.5, x1: W },
];

export function regionAt(x) {
  for (const r of REGIONS) if (x < r.x1) return r.id;
  return 'ascent';
}

export function buildLevel() {
  const grid = new Uint8Array(W * H).fill(TILE_ROCK);
  const fill = (x0, y0, x1, y1, t) => {
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
      if (i >= 0 && j >= 0 && i < W && j < H) grid[j * W + i] = t;
    }
  };
  const air = (x0, y0, x1, y1) => fill(x0, y0, x1, y1, TILE_AIR);
  const rock = (x0, y0, x1, y1) => fill(x0, y0, x1, y1, TILE_ROCK);
  const metal = (x0, y0, x1, y1) => fill(x0, y0, x1, y1, TILE_METAL);

  // ───────────────────────── Buried Workshop ─────────────────────────
  air(3, 10, 13, 17);            // start room (station S0)
  air(13, 11, 15, 17);           // safe step 1
  air(15, 12, 25, 17);           // safe step 2 + hall
  metal(13, 10, 15, 11);
  metal(15, 10, 17, 12);
  air(25, 10, 28, 17);           // small safe gap (2 deep, can be jumped out of)
  air(28, 12, 33, 17);
  air(33, 12, 38, 16);           // training-seam corridor
  air(38, 12, 44, 19);           // skitter hall: observation lip
  air(44, 9, 53, 19);            // service trench (skitter surface)
  air(53, 10, 54, 19);           // exit steps
  air(54, 11, 55, 19);
  air(55, 12, 58, 19);
  metal(53, 9, 54, 10);
  metal(54, 9, 55, 11);
  air(39, 9, 44, 11);            // maintenance alcove (Archive 1) incl. hidden seam cell
  air(58, 12, 63, 17);           // cell room
  air(63, 13, 70, 17);           // raised socket floor + shutter A column
  metal(63, 12, 70, 13);
  air(70, 13, 80, 18);           // relay A room (station S1)
  air(80, 13, 81, 17);           // door A column

  // ───────────────────────── Crystal Reservoir ─────────────────────────
  air(81, 13, 87, 17);           // entry tunnel
  air(87, 13, 91, 27);           // first wall-jump shaft (safe floor beneath)
  air(91, 13, 98, 15);           // pulse-revealed side passage (hidden seam cell at 91)
  air(91, 22, 108, 29);          // upper cavern
  rock(97, 24, 99, 29);          // hanging left wall of the switch shaft
  rock(103, 24, 105, 29);        // hanging right wall of the switch shaft
  air(99, 29, 103, 43);          // switch shaft
  air(103, 32, 108, 35);         // switch pocket
  air(93, 38, 99, 42);           // upper shelf (Archive 2)
  air(108, 14, 124, 30);         // deep cooling channel
  air(124, 22, 136, 29);         // far shore (Relay B, station S2)
  air(136, 22, 137, 26);         // door B column

  // ───────────────────────── Silent Foundry ─────────────────────────
  air(137, 22, 140, 28);         // sentinel approach
  air(140, 23, 141, 28);
  air(141, 24, 142, 28);         // cover steps (beam stops here)
  air(142, 22, 144, 28);
  air(144, 22, 156, 26);         // sentinel corridor
  metal(140, 22, 141, 23);
  metal(141, 22, 142, 24);
  air(146, 20, 148, 22);         // cover recess
  air(148, 21, 149, 22);         // recess exit step
  air(151, 16, 154, 22);         // drop shaft into the hall
  air(150, 10, 182, 16);         // foundry hall
  rock(181, 14, 182, 16);        // lintel above the latch gate
  air(173, 9, 176, 23);          // counterweight lift column (pit 9..10)
  air(168, 18, 173, 22);         // upper switch alcove
  air(176, 18, 182, 21);         // service room (Archive 3) incl. door cell at 176
  for (let k = 1; k <= 8; k++) { // service stair to the relay gallery
    air(181 + k, 10 + k, 182 + k, 15 + k);
    metal(181 + k, 9 + k, 182 + k, 10 + k);
  }
  air(190, 18, 206, 23);         // relay C gallery (station S3)
  air(206, 18, 207, 22);         // door C column
  metal(150, 9, 173, 10);
  metal(176, 9, 182, 10);
  metal(190, 17, 206, 18);
  metal(142, 21, 146, 22);
  metal(149, 21, 151, 22);
  metal(154, 21, 157, 22);

  // ───────────────────────── Ascent Shaft ─────────────────────────
  air(207, 18, 224, 22);         // bottom room (station S4)
  metal(209, 18, 213, 20);       // service block under the chimney (walls are reachable from its top)
  metal(213, 18, 214, 19);       // step onto the service block
  air(209, 22, 213, 30);         // wall-jump chimney
  air(207, 30, 224, 38);         // service room 2 (2-thick slab above)
  air(221, 29, 224, 30);         // service platform pit
  air(221, 38, 224, 40);         // platform passage through the slab
  air(207, 40, 224, 46);         // lift hall
  air(207, 39, 211, 40);         // main lift seat
  air(207, 46, 211, 64);         // main lift shaft
  air(203, 64, 227, 75);         // surface terrace (open sky)
  metal(211, 38, 221, 40);
  metal(213, 29, 221, 30);

  const stations = [
    { id: 'S0', x: 6, y: 10, relay: null, label: 'Workshop' },
    { id: 'S1', x: 77, y: 13, relay: 'A', label: 'Relay A' },
    { id: 'SR', x: 94.5, y: 22, relay: null, label: 'Reservoir' },
    { id: 'S2', x: 134, y: 22, relay: 'B', label: 'Relay B' },
    { id: 'SF', x: 157, y: 10, relay: null, label: 'Foundry' },
    { id: 'S3', x: 201.5, y: 18, relay: 'C', label: 'Relay C' },
    { id: 'S4', x: 216, y: 18, relay: null, label: 'Ascent' },
  ];

  // Breakable seams occupy explicit rectangles of otherwise-air cells.
  const seams = [
    { id: 'seamT', x0: 35, y0: 12, x1: 36, y1: 16, style: 'amber' },    // tutorial seam, always visible
    { id: 'seamH1', x0: 43, y0: 9, x1: 44, y1: 11, style: 'hidden' },   // workshop alcove
    { id: 'seamH2', x0: 91, y0: 13, x1: 92, y1: 15, style: 'hidden' },  // reservoir side passage
  ];

  // Doors retract upward. `when` is a power key resolved by the simulation.
  const doors = [
    { id: 'shutterA', x: 69, y0: 13, h: 4, when: 'socket:SA', style: 'shutter' },
    { id: 'doorA', x: 80, y0: 13, h: 4, when: 'relay:A', style: 'relay' },
    { id: 'doorB', x: 136, y0: 22, h: 4, when: 'relay:B', style: 'relay' },
    { id: 'gateF', x: 181, y0: 10, h: 4, when: 'switch:SWU', style: 'shutter' },
    { id: 'serviceDoor', x: 176, y0: 18, h: 3, when: 'socket:SL', style: 'service' },
    { id: 'doorC', x: 206, y0: 18, h: 4, when: 'relay:C', style: 'relay' },
  ];

  const sockets = [
    { id: 'SA', x: 65, y: 13 },
    { id: 'SL', x: 178, y: 10 },
    { id: 'SC', x: 193, y: 18 },
  ];

  const cells = [
    { id: 'C1', x: 60, y: 12 },
    { id: 'C2', x: 170.5, y: 10 },
  ];

  const switches = [
    { id: 'SWB', x: 106, y: 32, label: 'Bridge Power' },
    { id: 'SWU', x: 169.5, y: 18, label: 'Route Latch' },
  ];

  const relays = [
    { id: 'A', x: 73.5, y: 15.2, needs: null, door: 'doorA', station: 'S1' },
    { id: 'B', x: 131.5, y: 24.4, needs: null, door: 'doorB', station: 'S2' },
    { id: 'C', x: 197.5, y: 20.4, needs: 'socket:SC', door: 'doorC', station: 'S3' },
  ];

  // Movers: `x` is the centre, `y` is the top surface. Path a -> b.
  const movers = [
    { id: 'P1', kind: 'platform', w: 4, h: 0.5, ax: 110, ay: 22, bx: 122, by: 22, speed: 2.2, pause: 2.0, when: 'switch:SWB', park: 'b' },
    { id: 'LIFT', kind: 'lift', w: 3, h: 0.5, ax: 174.5, ay: 10, bx: 174.5, by: 18, speed: 2.4, pause: 2.2, when: 'socket:SL', park: 'a' },
    { id: 'P2', kind: 'platform', w: 3, h: 0.5, ax: 222.5, ay: 30, bx: 222.5, by: 40, speed: 2.5, pause: 1.8, when: 'always', park: 'a' },
  ];

  const mainLift = { id: 'MAINLIFT', x: 209, w: 4, h: 0.5, y: 40, topY: 64, boardX0: 207.3, boardX1: 210.7, consoleX: 210.2, consoleY: 40, exitX: 215.5 };

  const press = { id: 'PRESS', x0: 166, x1: 168, top: 16, upY: 13.2, downY: 10, zone: [158, 9, 173, 17] };

  const vents = [
    { id: 'V1', x: 160, y: 10, offset: 0 },
    { id: 'V2', x: 163.2, y: 10, offset: 0.9 },
    { id: 'V3', x: 217, y: 30, offset: 0 },
  ];

  const enemies = [
    { id: 'K1', kind: 'skitter', x: 49, y: 9, dir: 1, zone: [38, 9, 58, 19] },
    { id: 'D1', kind: 'drone', ax: 126.5, ay: 24.3, bx: 130.5, by: 24.3, zone: [121, 21, 137, 30] },
    { id: 'T1', kind: 'sentinel', x: 156, y: 23.0, dir: -1, zone: [137, 19, 156.5, 29] },
    { id: 'D2', kind: 'drone', ax: 214, ay: 42.4, bx: 219, by: 42.4, zone: [207, 39.5, 224, 46] },
  ];

  const archives = [
    { id: 'AR1', x: 40.5, y: 9, title: 'Maintenance Log 7',
      text: 'Shift 7. The benches are quiet now. We sealed the lower halls ourselves — the resonance was never meant to sleep this long. If a unit wakes, let it find the relays.' },
    { id: 'AR2', x: 95, y: 38, title: 'Reservoir Survey',
      text: 'The crystals answer when we sing to them. One clear pulse and the whole cavern rings like a bell. We left the cooling water running; the station will need it when it wakes.' },
    { id: 'AR3', x: 180, y: 18, title: 'Foundry Final Entry',
      text: 'The presses stopped at dawn. We rode the lift up one last time and left the lights for whoever comes after. Three relays. One lift. The surface is still there.' },
  ];

  const caches = [
    { id: 'CA1', x: 96, y: 13 },
    { id: 'CA2', x: 155.2, y: 22 },
    { id: 'CA3', x: 208, y: 30 },
  ];

  // Kill volumes: deep cooling water. Touching one triggers checkpoint recovery.
  const killZones = [
    { id: 'water', x0: 108, y0: 0, x1: 124, y1: 19.2, kind: 'water' },
  ];
  const water = [{ x0: 108, x1: 124, y0: 14, surface: 19.5 }];

  // Contextual teaching prompts (shown by the HUD; never block play).
  const hints = [
    { id: 'move', rect: [3, 10, 12, 17], keys: 'A / D', touch: 'Arrows', text: 'Move' },
    { id: 'jump', rect: [12, 10, 24, 18], keys: 'Space', touch: 'Jump', text: 'Jump — hold for height' },
    { id: 'dash', rect: [29, 12, 35, 16], keys: 'Shift', touch: 'Dash', text: 'Dash — shatters cracked amber seams' },
    { id: 'pulse', rect: [38, 12, 44, 19], keys: 'Q', touch: 'Pulse', text: 'Echo Pulse — stuns machines; dash a stunned machine to disable it' },
    { id: 'cell', rect: [58, 12, 63, 17], keys: 'E', touch: 'Use', text: 'Lift the power cell and carry it to the socket' },
    { id: 'relay', rect: [70, 13, 76, 18], keys: 'Q', touch: 'Pulse', text: 'Echo Pulse wakes the relay' },
    { id: 'wall', rect: [84, 13, 91, 20], keys: 'Space', touch: 'Jump', text: 'Jump against a wall to kick away — climb between walls' },
    { id: 'water', rect: [104, 22, 108, 29], keys: '', touch: '', text: 'Deep cooling water — find power for the crossing platform' },
    { id: 'sentinel', rect: [137, 22, 144, 28], keys: 'Q', touch: 'Pulse', text: 'Sentinel: take cover from the beam; pulse its open core while it vents' },
    { id: 'lift', rect: [168, 10, 180, 16], keys: 'E', touch: 'Use', text: 'A powered socket drives the lift' },
  ];

  // Camera framing zones (ease between them; purely presentational).
  const cameraZones = [
    { rect: [87, 13, 91, 27], dy: 2.5, zoom: 1.0 },
    { rect: [99, 22, 103, 43], dy: 2.5, zoom: 1.0 },
    { rect: [104, 20, 128, 30], dy: 0.5, zoom: 1.12 },
    { rect: [137, 22, 151, 28], dx: 4.5, dy: -0.6, zoom: 1.2 },   // keeps the Sentinel and its lane in frame
    { rect: [151, 14, 154, 22], dy: -2.5, zoom: 1.0 },
    { rect: [209, 20, 213, 30], dy: 2.5, zoom: 1.0 },
    { rect: [213, 30, 224, 38], dy: 1.5, zoom: 1.12 },
    { rect: [207, 40, 224, 46], dy: 1.0, zoom: 1.05 },
  ];

  // Conduits: axis-aligned polylines lit by a power key (visual + pulse reveal).
  const conduits = [
    { id: 'cSA', when: 'socket:SA', pts: [[65, 13.5], [65, 17.5], [69.5, 17.5], [69.5, 17]] },
    { id: 'cRA', when: 'relay:A', pts: [[73.5, 15.2], [73.5, 18.5], [80.5, 18.5], [80.5, 17]] },
    { id: 'cRA2', when: 'relay:A', pts: [[80.5, 18.5], [86, 18.5]] },
    { id: 'cSWB', when: 'switch:SWB', pts: [[106, 32.5], [106, 31.3], [108.5, 31.3], [108.5, 30.4], [123.5, 30.4]] },
    { id: 'cSWBrail', when: 'switch:SWB', pts: [[108.5, 21.5], [123.5, 21.5]] },
    { id: 'cRB', when: 'relay:B', pts: [[131.5, 24.4], [131.5, 29.5], [136.5, 29.5], [136.5, 26]] },
    { id: 'cRB2', when: 'relay:B', pts: [[136.5, 29.5], [143, 29.5]] },
    { id: 'cSL', when: 'socket:SL', pts: [[178, 10.5], [178, 16.5], [176.4, 16.5]] },
    { id: 'cSL2', when: 'socket:SL', secondary: true, pts: [[178, 16.5], [178, 17.4], [176.5, 17.4], [176.5, 18]] },
    { id: 'cSWU', when: 'switch:SWU', pts: [[169.5, 19], [169.5, 17], [181.5, 17], [181.5, 14.3]] },
    { id: 'cSC', when: 'socket:SC', pts: [[193, 18.5], [193, 23.5], [197.5, 23.5], [197.5, 20.4]] },
    { id: 'cRC', when: 'relay:C', pts: [[197.5, 23.5], [206.5, 23.5], [206.5, 22]] },
    { id: 'tA', when: 'relay:A', pts: [[206.5, 24.2], [205.4, 24.2], [205.4, 47.2], [207, 47.2]] },
    { id: 'tB', when: 'relay:B', pts: [[206.5, 24.8], [204.8, 24.8], [204.8, 47.8], [207, 47.8]] },
    { id: 'tC', when: 'relay:C', pts: [[206.5, 25.4], [204.2, 25.4], [204.2, 48.4], [207, 48.4]] },
  ];

  const start = { x: 6, y: 10, station: 'S0' };

  return {
    W, H, grid, stations, seams, doors, sockets, cells, switches, relays, movers, mainLift,
    press, vents, enemies, archives, caches, killZones, water, hints, cameraZones, conduits, start,
  };
}
