import {
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
} from 'three';
import type { Texture } from 'three';
import { LAND_ATMOSPHERE, LAND_PMREM_ATLAS, LAND_TIMES } from '@/01-shared';
import compressedAsset from './land-pmrem-v187.gz?inline';

interface AtlasMip {
  width: number;
  height: number;
  data: Uint16Array;
}

export interface LandPmremAtlasHandle {
  textures: DataTexture[];
  stats: {
    compressedBytes: number;
    decodedBytes: number;
    decodeMs: number;
    yieldedFrames: number;
  };
  dispose(): void;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

/** 对 PNG 风格 Paeth 残差原地还原一段完整扫描行；上一行必须已解码。 */
export function decodePaethRowsInPlace(
  bytes: Uint8Array,
  width: number,
  startRow: number,
  endRow: number,
): void {
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(startRow) ||
    !Number.isInteger(endRow) ||
    startRow < 0 ||
    endRow < startRow ||
    bytes.length < width * endRow
  ) {
    throw new RangeError('PMREM Paeth 行范围无效');
  }

  for (let row = startRow; row < endRow; row++) {
    const rowStart = row * width;
    for (let x = 0; x < width; x++) {
      const index = rowStart + x;
      const left = x > 0 ? bytes[index - 1]! : 0;
      const up = row > 0 ? bytes[index - width]! : 0;
      const upperLeft = row > 0 && x > 0 ? bytes[index - width - 1]! : 0;
      bytes[index] = (bytes[index]! + paeth(left, up, upperLeft)) & 0xff;
    }
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason ?? new DOMException('PMREM 图集解码已取消', 'AbortError');
}

/** 等到下一次浏览器绘制时机再继续，取消时同时撤销 RAF，不留下悬挂任务。 */
function yieldFrame(signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let frameId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      cleanup();
      reject(signal.reason ?? new DOMException('PMREM 图集解码已取消', 'AbortError'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (typeof requestAnimationFrame === 'function') {
      frameId = requestAnimationFrame(() => {
        cleanup();
        resolve();
      });
    } else {
      timeoutId = setTimeout(() => {
        cleanup();
        resolve();
      }, 0);
    }
  });
}

function base64Payload(dataUrl: string): string {
  const separator = dataUrl.indexOf(',');
  if (separator < 0 || !dataUrl.slice(0, separator).endsWith(';base64'))
    throw new Error('离线 PMREM 资源不是内联 base64 数据');
  return dataUrl.slice(separator + 1);
}

async function decodeBase64InFrames(
  payload: string,
  signal: AbortSignal,
  onYield: () => void,
): Promise<Uint8Array> {
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(Math.floor((payload.length * 3) / 4) - padding);
  const charsPerSlice = LAND_PMREM_ATLAS.base64CharsPerSlice;
  let byteOffset = 0;

  for (let offset = 0; offset < payload.length; offset += charsPerSlice) {
    throwIfAborted(signal);
    const binary = atob(payload.slice(offset, offset + charsPerSlice));
    for (let index = 0; index < binary.length; index++)
      bytes[byteOffset++] = binary.charCodeAt(index);
    if (offset + charsPerSlice < payload.length) {
      await yieldFrame(signal);
      onYield();
    }
  }
  if (byteOffset !== bytes.length) throw new Error('离线 PMREM base64 长度不匹配');
  return bytes;
}

function createMipPayloads(): AtlasMip[][] {
  const size = LAND_ATMOSPHERE.environment.size;
  const mipSizes: number[] = [];
  for (let mipSize = size; mipSize >= LAND_PMREM_ATLAS.minMipSize; mipSize >>= 1)
    mipSizes.push(mipSize);

  return LAND_TIMES.map(() =>
    mipSizes.map((mipSize) => ({
      width: mipSize,
      height: mipSize * 6,
      data: new Uint16Array(mipSize * mipSize * 6 * LAND_PMREM_ATLAS.rgbaChannelCount),
    })),
  );
}

async function decodeFaceRecord(
  record: Uint8Array,
  size: number,
  destination: Uint16Array,
  face: number,
  signal: AbortSignal,
  onYield: () => void,
): Promise<void> {
  const pixelCount = size * size;
  if (
    record.length !==
    pixelCount * LAND_PMREM_ATLAS.channelCount * LAND_PMREM_ATLAS.bytesPerChannel
  )
    throw new Error(`PMREM 面数据长度异常：${record.length}`);

  // 码流为 R/G/B 各自的 low/high byte 平面。按行块还原，让高分辨率面不会
  // 在一个不可取消的长循环里占住主线程；同一块的六个平面共享一个 RAF 让出点。
  for (let startRow = 0; startRow < size; startRow += LAND_PMREM_ATLAS.rowsPerDecodeSlice) {
    const endRow = Math.min(size, startRow + LAND_PMREM_ATLAS.rowsPerDecodeSlice);
    for (let plane = 0; plane < 6; plane++) {
      const bytes = record.subarray(plane * pixelCount, (plane + 1) * pixelCount);
      decodePaethRowsInPlace(bytes, size, startRow, endRow);
    }
    throwIfAborted(signal);
    if (endRow < size) {
      await yieldFrame(signal);
      onYield();
    }
  }

  const destinationOffset = face * pixelCount * LAND_PMREM_ATLAS.rgbaChannelCount;
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const rgbaOffset = destinationOffset + pixel * LAND_PMREM_ATLAS.rgbaChannelCount;
    for (let channel = 0; channel < LAND_PMREM_ATLAS.channelCount; channel++) {
      const planeOffset = channel * 2 * pixelCount;
      destination[rgbaOffset + channel] =
        record[planeOffset + pixel]! | (record[planeOffset + pixelCount + pixel]! << 8);
    }
    destination[rgbaOffset + 3] = 0x3c00; // alpha 恒为 half-float 1.0
  }
}

/** 将随单文件内联的 gzip RGB16F 数据分片解码为三张手工 mip DataTexture 图集。 */
export async function loadLandPmremAtlas(
  signal: AbortSignal,
  onStage?: (stage: string) => void,
): Promise<LandPmremAtlasHandle> {
  const startedAt = performance.now();
  const payload = base64Payload(compressedAsset);
  let yieldedFrames = 0;
  let bytesSinceYield = 0;
  const countYield = (): void => {
    yieldedFrames++;
    bytesSinceYield = 0;
  };
  onStage?.('environment:asset-base64');
  const compressed = await decodeBase64InFrames(payload, signal, countYield);
  if (compressed.byteLength !== LAND_PMREM_ATLAS.compressedBytes)
    throw new Error(`离线 PMREM gzip 长度不匹配：${compressed.byteLength}`);

  const mipPayloads = createMipPayloads();
  const decompressor = new DecompressionStream('gzip');
  const writer = decompressor.writable.getWriter();
  const reader = decompressor.readable.getReader();
  const compressedBuffer = new ArrayBuffer(compressed.byteLength);
  const compressedView = new Uint8Array(compressedBuffer);
  compressedView.set(compressed);
  let writeTask: Promise<void> | undefined;
  let activeRecord: Uint8Array | undefined;
  let recordOffset = 0;
  let mapIndex = 0;
  let mipIndex = 0;
  let faceIndex = 0;
  let decodedBytes = 0;

  const cancelStream = (): void => {
    const reason = signal.reason ?? new DOMException('PMREM 图集解码已取消', 'AbortError');
    void reader.cancel(reason).catch(() => {});
    void writer.abort(reason).catch(() => {});
  };
  signal.addEventListener('abort', cancelStream, { once: true });

  try {
    onStage?.('environment:asset-inflate');
    writeTask = writer.write(compressedView).then(() => writer.close());
    void writeTask.catch((error: unknown) => {
      void reader.cancel(error).catch(() => {});
    });
    while (true) {
      throwIfAborted(signal);
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      let chunkOffset = 0;

      while (chunkOffset < chunk.byteLength) {
        throwIfAborted(signal);
        if (mapIndex >= mipPayloads.length) throw new Error('离线 PMREM 解压数据超过预期记录数量');
        const size = LAND_ATMOSPHERE.environment.size >> mipIndex;
        const pixelCount = size * size;
        const recordBytes =
          pixelCount * LAND_PMREM_ATLAS.channelCount * LAND_PMREM_ATLAS.bytesPerChannel;
        activeRecord ??= new Uint8Array(recordBytes);
        const copyLength = Math.min(recordBytes - recordOffset, chunk.byteLength - chunkOffset);
        activeRecord.set(chunk.subarray(chunkOffset, chunkOffset + copyLength), recordOffset);
        chunkOffset += copyLength;
        recordOffset += copyLength;
        decodedBytes += copyLength;

        if (recordOffset === recordBytes) {
          const destination = mipPayloads[mapIndex]?.[mipIndex]?.data;
          if (!destination) throw new Error('离线 PMREM 图集记录顺序或 mip 数量异常');
          await decodeFaceRecord(activeRecord, size, destination, faceIndex, signal, countYield);
          bytesSinceYield += recordBytes;
          if (bytesSinceYield >= LAND_PMREM_ATLAS.bytesPerDecodeSlice) {
            await yieldFrame(signal);
            countYield();
          }
          activeRecord = undefined;
          recordOffset = 0;
          faceIndex++;
          if (faceIndex === 6) {
            faceIndex = 0;
            mipIndex++;
            if (mipIndex === mipPayloads[mapIndex]!.length) {
              mipIndex = 0;
              mapIndex++;
            }
          }
        }
      }
    }
    await writeTask;
    throwIfAborted(signal);
    if (
      activeRecord !== undefined ||
      recordOffset !== 0 ||
      mapIndex !== LAND_TIMES.length ||
      decodedBytes !== LAND_PMREM_ATLAS.decodedBytes
    ) {
      throw new Error(`离线 PMREM 解压长度或记录数量异常：${decodedBytes}`);
    }

    const textures: DataTexture[] = [];
    try {
      for (let index = 0; index < mipPayloads.length; index++) {
        const mips = mipPayloads[index]!;
        const baseMip = mips[0]!;
        const texture = new DataTexture(
          baseMip.data,
          baseMip.width,
          baseMip.height,
          RGBAFormat,
          HalfFloatType,
        );
        texture.name = `land-offline-pmrem-${LAND_TIMES[index]}`;
        texture.mipmaps = mips as unknown as Texture['mipmaps'];
        texture.generateMipmaps = false;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.magFilter = LinearFilter;
        texture.colorSpace = LinearSRGBColorSpace;
        texture.unpackAlignment = 1;
        texture.needsUpdate = true;
        textures.push(texture);
      }
    } catch (error) {
      for (const texture of textures) texture.dispose();
      throw error;
    }

    let disposed = false;
    return {
      textures,
      stats: {
        compressedBytes: compressed.byteLength,
        decodedBytes,
        decodeMs: performance.now() - startedAt,
        yieldedFrames,
      },
      dispose(): void {
        if (disposed) return;
        disposed = true;
        for (const texture of textures) texture.dispose();
      },
    };
  } catch (error) {
    cancelStream();
    await writeTask?.catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelStream);
    reader.releaseLock();
    writer.releaseLock();
  }
}
