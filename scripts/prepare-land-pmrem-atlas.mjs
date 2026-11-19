import { gzipSync, gunzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultInput = path.join(projectRoot, 'scripts/assets/land-pmrem-v187-source.gz');
const defaultOutput = path.join(projectRoot, 'src/06-world/land/land-pmrem-v187-mip128.gz');

const ENVIRONMENT_SIZE = 256;
const MAX_MIP_SIZE = 128;
const MIN_MIP_SIZE = 8;
const TIME_COUNT = 3;
const FACE_COUNT = 6;
const CHANNEL_COUNT = 3;
const BYTES_PER_CHANNEL = 2;

/** Remove each time-of-day's unused 256px source mip and preserve all lower records verbatim. */
export function buildMip128Atlas(sourceGzip) {
  const source = gunzipSync(sourceGzip);
  const retainedRecords = [];
  let sourceOffset = 0;
  let retainedBytes = 0;

  for (let time = 0; time < TIME_COUNT; time++) {
    for (let size = ENVIRONMENT_SIZE; size >= MIN_MIP_SIZE; size >>= 1) {
      const recordBytes = size * size * CHANNEL_COUNT * BYTES_PER_CHANNEL;
      for (let face = 0; face < FACE_COUNT; face++) {
        const end = sourceOffset + recordBytes;
        if (end > source.byteLength)
          throw new Error(`PMREM 源资产在时段 ${time} / mip ${size} / 面 ${face} 处截断`);
        if (size <= MAX_MIP_SIZE) {
          retainedRecords.push(source.subarray(sourceOffset, end));
          retainedBytes += recordBytes;
        }
        sourceOffset = end;
      }
    }
  }

  if (sourceOffset !== source.byteLength)
    throw new Error(`PMREM 源资产包含额外数据：${source.byteLength - sourceOffset} B`);

  const expectedBytes =
    TIME_COUNT *
    FACE_COUNT *
    CHANNEL_COUNT *
    BYTES_PER_CHANNEL *
    Array.from({ length: Math.log2(MAX_MIP_SIZE / MIN_MIP_SIZE) + 1 }, (_, level) => {
      const size = MAX_MIP_SIZE >> level;
      return size * size;
    }).reduce((sum, pixels) => sum + pixels, 0);
  if (retainedBytes !== expectedBytes)
    throw new Error(`PMREM 保留数据长度异常：${retainedBytes} != ${expectedBytes}`);

  const decoded = Buffer.concat(retainedRecords, retainedBytes);
  return gzipSync(decoded, { level: 9, mtime: 0 });
}

const [inputPath = defaultInput, outputPath = defaultOutput] = process.argv.slice(2);
const sourceGzip = await readFile(inputPath);
const atlasGzip = buildMip128Atlas(sourceGzip);
await writeFile(outputPath, atlasGzip);
console.log(
  JSON.stringify({
    input: path.relative(projectRoot, inputPath),
    output: path.relative(projectRoot, outputPath),
    sourceGzipBytes: sourceGzip.byteLength,
    compressedBytes: atlasGzip.byteLength,
    decodedBytes: gunzipSync(atlasGzip).byteLength,
    removedMipSize: ENVIRONMENT_SIZE,
    retainedMipRange: `${MAX_MIP_SIZE}..${MIN_MIP_SIZE}`,
  }),
);
