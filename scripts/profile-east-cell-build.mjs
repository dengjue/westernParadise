/** Measure synchronous east-region cell construction with Vite's production TS aliases. */
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { createServer } from 'vite';
import { MeshStandardMaterial } from 'three';

const sampleCount = 7;
const cellSizes = [24, 48];

const vite = await createServer({
  configFile: 'vite.config.ts',
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

const ownedMaterials = Array.from({ length: 6 }, () => new MeshStandardMaterial());
const materials = {
  stone: ownedMaterials[0],
  carvedStone: ownedMaterials[1],
  dark: ownedMaterials[2],
  jade: ownedMaterials[3],
  goldDark: ownedMaterials[4],
  gold: ownedMaterials[5],
};

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
  return {
    min: sorted[0] ?? 0,
    median: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? 0,
  };
}

function inspectPayload(root) {
  const meshes = [];
  const geometries = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    meshes.push(object);
    geometries.add(object.geometry);
  });

  let vertices = 0;
  let triangles = 0;
  let attributeBytes = 0;
  let indexBytes = 0;
  for (const geometry of geometries) {
    const position = geometry.getAttribute('position');
    vertices += position?.count ?? 0;
    triangles += (geometry.index?.count ?? position?.count ?? 0) / 3;
    for (const attribute of Object.values(geometry.attributes))
      attributeBytes += attribute.array.byteLength;
    if (geometry.index) indexBytes += geometry.index.array.byteLength;
  }

  return {
    meshes: meshes.length,
    geometries: geometries.size,
    vertices,
    triangles,
    attributeBytes,
    indexBytes,
    totalBytes: attributeBytes + indexBytes,
  };
}

function cellCoordinates(bounds, origin, cellSize) {
  const minColumn = Math.floor((bounds.minX - origin.x) / cellSize);
  const maxColumn = Math.ceil((bounds.maxX - origin.x) / cellSize);
  const minRow = Math.floor((bounds.minZ - origin.z) / cellSize);
  const maxRow = Math.ceil((bounds.maxZ - origin.z) / cellSize);
  return Array.from({ length: (maxColumn - minColumn) * (maxRow - minRow) }, (_, index) => ({
    column: minColumn + Math.floor(index / (maxRow - minRow)),
    row: minRow + (index % (maxRow - minRow)),
  }));
}

try {
  const [{ LAND_WORLD }, { createEastRegionCellPayload }] = await Promise.all([
    vite.ssrLoadModule('/src/01-shared/index.ts'),
    vite.ssrLoadModule('/src/06-world/land/RegionPrototype.ts'),
  ]);
  const region = LAND_WORLD.regions.find(({ id }) => id === 'east-water-court');
  if (!region) throw new Error('east-water-court region not found');

  const report = {
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuModel: cpus()[0]?.model,
      logicalCores: cpus().length,
    },
    method: {
      samplesPerCell: sampleCount,
      warmupPassesPerCell: 1,
      timer: 'performance.now around createEastRegionCellPayload only',
      note: 'Geometry inspection and dispose are excluded from the build timer.',
    },
    cellSizes: [],
  };

  for (const cellSize of cellSizes) {
    const coordinates = cellCoordinates(region.bounds, LAND_WORLD.cellOrigin, cellSize);
    const records = new Map(coordinates.map(({ column, row }) => [`${column},${row}`, []]));
    const geometryByCell = new Map();

    for (let pass = 0; pass <= sampleCount; pass++) {
      for (const coordinate of coordinates) {
        const start = performance.now();
        const payload = createEastRegionCellPayload(coordinate, materials, cellSize);
        const elapsedMs = performance.now() - start;
        const key = payload.key;
        if (pass === 0) {
          geometryByCell.set(key, inspectPayload(payload.root));
        } else {
          records.get(key).push(elapsedMs);
        }
        payload.dispose();
      }
    }

    const perCell = coordinates.map(({ column, row }) => {
      const key = `${column},${row}`;
      return {
        key,
        buildMs: summarize(records.get(key)),
        ...geometryByCell.get(key),
      };
    });
    const totalGeometry = perCell.reduce(
      (sum, cell) => ({
        meshes: sum.meshes + cell.meshes,
        geometries: sum.geometries + cell.geometries,
        vertices: sum.vertices + cell.vertices,
        triangles: sum.triangles + cell.triangles,
        attributeBytes: sum.attributeBytes + cell.attributeBytes,
        indexBytes: sum.indexBytes + cell.indexBytes,
        totalBytes: sum.totalBytes + cell.totalBytes,
      }),
      {
        meshes: 0,
        geometries: 0,
        vertices: 0,
        triangles: 0,
        attributeBytes: 0,
        indexBytes: 0,
        totalBytes: 0,
      },
    );

    report.cellSizes.push({
      cellSize,
      cellCount: coordinates.length,
      totalBuildMs: summarize(
        Array.from({ length: sampleCount }, (_, sample) =>
          perCell.reduce((sum, cell) => sum + records.get(cell.key)[sample], 0),
        ),
      ),
      perCellBuildMs: summarize(perCell.map((cell) => cell.buildMs.median)),
      totalGeometry,
      hotspots: [...perCell].sort((a, b) => b.buildMs.median - a.buildMs.median).slice(0, 8),
      perCell,
    });
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const material of ownedMaterials) material.dispose();
  await vite.close();
}
