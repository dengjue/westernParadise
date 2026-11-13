/** 米、秒、弧度。路线控制点绕开楼阁与屋檐，停留时不自动绕转。 */
export const LAND_JOURNEY = Object.freeze({
  eyeHeight: 1.7,
  walkSpeed: 6,
  maxDeltaSeconds: 0.05,
  heightEase: 12,
  pitchLimit: 1.15,
  orbitPitch: [-0.25, 1.2],
  zoom: [0.55, 1.6],
  zoomStep: 0.06,
  holdSeconds: 10,
  travelSeconds: 10,
  moveRadiusPx: 46,
  touchSensitivity: 0.004,
  mouseSensitivity: 0.003,
  stepDistance: 1.7,
  entries: [
    [0, 85],
    [0, 52],
    [0, 10],
    [0, -42],
    [-63, 24],
    [63, 24],
    [-63, 82],
    [63, 82],
  ],
  curves: [
    [
      [65, 30, 90],
      [28, 12, 72],
    ],
    [
      [20, 8, 38],
      [6, 9, 24],
    ],
    [
      [-12, 15, 14],
      [-45, 16, 35],
    ],
    [
      [-78, 28, 80],
      [18, 46, 142],
    ],
  ],
} as const);
