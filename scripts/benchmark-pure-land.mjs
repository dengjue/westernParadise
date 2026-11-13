/**
 * 在已打开的生产页面中采样，适用于 Tabbit / Playwright 的 Page。
 * 页面需带 ?debug 或 ?bench。脚本只读取 scene 和 renderer，不改渲染参数。
 * 采样期间锁定四个配置机位，结束后恢复初始观景点；不用于正在步行的页面。
 */
export async function benchmarkPureLand(
  page,
  {
    warmupFrames = 60,
    sampleFrames = 180,
    viewIndices = [0, 1, 2, 3],
    sampleTimeoutMs = 30000,
  } = {},
) {
  if (
    !Number.isInteger(warmupFrames) ||
    warmupFrames < 1 ||
    !Number.isInteger(sampleFrames) ||
    sampleFrames < 1 ||
    !Number.isInteger(sampleTimeoutMs) ||
    sampleTimeoutMs < 1 ||
    viewIndices.length === 0 ||
    viewIndices.some((index) => !Number.isInteger(index) || index < 0 || index > 3)
  )
    throw new RangeError('基准需要正整数预热/采样帧数和 0–3 范围内的景点');

  await page.waitForFunction(() => window.__G?.renderer.info.render.calls > 0);
  return page.evaluate(
    async ({ warmupFrames, sampleFrames, viewIndices, sampleTimeoutMs }) => {
      const { scene, renderer, landCamera, events, quality, seed } = window.__G;
      if (document.hidden) throw new Error('请在可见页面采样');
      if (landCamera.isWalking) throw new Error('请先返回观景模式再采样');

      function summary(values) {
        const sorted = Array.from(values).sort((a, b) => a - b);
        const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
        return {
          min: sorted[0],
          p50: percentile(0.5),
          p95: percentile(0.95),
          max: sorted.at(-1),
          mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
        };
      }

      function geometryStats() {
        const geometries = new Set();
        const buffers = new Set();
        let geometryBytes = 0;
        let instanceBytes = 0;
        let vertices = 0;
        let staticBatchBytes = 0;
        let staticBatchVertices = 0;
        let staticBatchTriangles = 0;
        let meshes = 0;
        let instances = 0;

        // WebGL 按 BufferAttribute（或 InterleavedBuffer）持有缓冲；共享资源只计一次。
        function bytes(attribute) {
          const buffer = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
          if (buffers.has(buffer)) return 0;
          buffers.add(buffer);
          return buffer.array.byteLength;
        }

        scene.traverse((object) => {
          if (object.isMesh) meshes++;
          if (object.isInstancedMesh) {
            instances += object.count;
            instanceBytes += bytes(object.instanceMatrix);
            if (object.instanceColor) instanceBytes += bytes(object.instanceColor);
          }
          const geometry = object.geometry;
          if (!geometry || geometries.has(geometry)) return;
          geometries.add(geometry);
          let size = geometry.index ? bytes(geometry.index) : 0;
          for (const attribute of Object.values(geometry.attributes)) {
            // 实例风幅/相位和矩阵一样属于实例数据，不把每实例属性计作顶点几何。
            if (attribute.isInstancedBufferAttribute) instanceBytes += bytes(attribute);
            else size += bytes(attribute);
          }
          const count = geometry.getAttribute('position')?.count ?? 0;
          vertices += count;
          geometryBytes += size;
          if (object.name === 'land-static-batch') {
            staticBatchBytes += size;
            staticBatchVertices += count;
            staticBatchTriangles += (geometry.index?.count ?? count) / 3;
          }
        });
        return {
          uniqueGeometries: geometries.size,
          geometryBytes,
          instanceBytes,
          vertices,
          meshes,
          instances,
          staticBatchBytes,
          staticBatchVertices,
          staticBatchTriangles,
        };
      }

      function sampleView(index) {
        landCamera.selectView(index, true);
        const frameMs = new Float64Array(sampleFrames);
        const calls = new Float64Array(sampleFrames);
        const triangles = new Float64Array(sampleFrames);
        let seen = 0;
        return new Promise((resolve, reject) => {
          const cleanup = () => {
            remove();
            clearTimeout(deadline);
            document.removeEventListener('visibilitychange', onVisibility);
          };
          const fail = (message) => {
            cleanup();
            reject(new Error(message));
          };
          const onVisibility = () => {
            if (document.hidden) fail('采样期间页面进入后台，本组数据作废');
          };
          const remove = events.on('app:frame', ({ deltaMs }) => {
            if (seen++ < warmupFrames) return;
            const i = seen - warmupFrames - 1;
            // app:frame 在本帧绘制前发出，info 对应刚完成的上一帧；机位预热后再统计。
            frameMs[i] = deltaMs;
            calls[i] = renderer.info.render.calls;
            triangles[i] = renderer.info.render.triangles;
            if (i + 1 === sampleFrames) {
              cleanup();
              resolve({
                index,
                frameMs: summary(frameMs),
                calls: summary(calls),
                triangles: summary(triangles),
              });
            }
          });
          const deadline = setTimeout(
            () =>
              fail(
                `景点 ${index} 采样超时：完成 ${Math.max(0, seen - warmupFrames)} / ${sampleFrames} 帧`,
              ),
            sampleTimeoutMs,
          );
          document.addEventListener('visibilitychange', onVisibility);
        });
      }

      const previousIndex = landCamera.index;
      const wasTouring = landCamera.touring;
      events.emit('land:tour', { enabled: false });
      try {
        const views = [];
        for (const index of viewIndices) views.push(await sampleView(index));
        return {
          schemaVersion: 2,
          capturedAt: new Date().toISOString(),
          url: location.href,
          quality,
          seed,
          timeOfDay: new URLSearchParams(location.search).get('tod'),
          userAgent: navigator.userAgent,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          viewport: {
            width: innerWidth,
            height: innerHeight,
            devicePixelRatio,
            renderPixelRatio: renderer.getPixelRatio(),
          },
          drawingBuffer: { width: renderer.domElement.width, height: renderer.domElement.height },
          warmupFrames,
          sampleFrames,
          scene: geometryStats(),
          rendererResources: {
            ...renderer.info.memory,
            programs: renderer.info.programs?.length ?? 0,
          },
          views,
        };
      } finally {
        landCamera.selectView(previousIndex, true);
        events.emit('land:tour', { enabled: wasTouring });
      }
    },
    { warmupFrames, sampleFrames, viewIndices, sampleTimeoutMs },
  );
}
