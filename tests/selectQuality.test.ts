import { describe, expect, it } from 'vitest';
import type { Capabilities, PlatformParams } from '@/00-types';
import { parseParams, selectQuality } from '@/03-platform';

/**
 * 画质决策矩阵回归测试。
 *
 * 设计要点：用工厂函数构造能力快照，而不是在每个用例里手写完整对象，
 * 这样 Capabilities 以后新增字段时只需要改一处，测试不会大规模漂移。
 * 默认基线是「桌面 / WebGL2 / 8 核 / 8GB」，其余设备组合用 overrides 描述差异。
 */
function caps(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    webgl: 'webgl2',
    touch: false,
    mobile: false,
    reducedMotion: false,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
    pixelRatio: 1,
    ...overrides,
  };
}

/** 复用真实解析器生成基准参数，避免测试里另抄一份默认值与实现漂移。 */
function params(search = ''): PlatformParams {
  return parseParams(search);
}

describe('selectQuality · 优先级', () => {
  it('URL 显式指定优先级最高，设备不支持也不改写', () => {
    const decision = selectQuality(
      params('?q=ultra'),
      caps({ webgl: 'none', mobile: true }),
      'low',
    );
    expect(decision.tier).toBe('ultra');
    expect(decision.reason).toContain('URL');
  });

  it('本地记忆优先于设备能力自动决策', () => {
    const decision = selectQuality(params(), caps(), 'high');
    expect(decision.tier).toBe('high');
    expect(decision.reason).toContain('本地');
  });

  it('无 WebGL 一律返回最低档，且优先级高于本地记忆以外的推断', () => {
    const decision = selectQuality(params(), caps({ webgl: 'none' }));
    expect(decision.tier).toBe('low');
    expect(decision.reason).toContain('WebGL');
  });
});

describe('selectQuality · 自动决策矩阵', () => {
  it('移动端或双核以内降到 low', () => {
    expect(selectQuality(params(), caps({ mobile: true })).tier).toBe('low');
    expect(selectQuality(params(), caps({ hardwareConcurrency: 2 })).tier).toBe('low');
  });

  it('内存不超过 4GB 封顶 medium', () => {
    expect(selectQuality(params(), caps({ deviceMemoryGb: 4 })).tier).toBe('medium');
  });

  it('八核及以上给 high', () => {
    expect(selectQuality(params(), caps({ hardwareConcurrency: 8 })).tier).toBe('high');
    expect(selectQuality(params(), caps({ hardwareConcurrency: 16 })).tier).toBe('high');
  });

  it('中间配置回落 medium', () => {
    expect(selectQuality(params(), caps({ hardwareConcurrency: 4 })).tier).toBe('medium');
  });

  it('WebGL1 封顶 medium，CPU 再强也不给 high', () => {
    const decision = selectQuality(params(), caps({ webgl: 'webgl1' }));
    expect(decision.tier).toBe('medium');
  });

  it('自动决策永不主动给 ultra（最高档必须用户显式选）', () => {
    const combos: Partial<Capabilities>[] = [
      {},
      { hardwareConcurrency: 64, deviceMemoryGb: 128 },
      { hardwareConcurrency: 8, deviceMemoryGb: null },
      { webgl: 'webgl1', hardwareConcurrency: 32 },
      { reducedMotion: false, pixelRatio: 3 },
    ];
    for (const combo of combos) {
      expect(selectQuality(params(), caps(combo)).tier).not.toBe('ultra');
    }
  });
});

describe('selectQuality · 减动效与边界', () => {
  it('prefers-reduced-motion 再降一档', () => {
    expect(selectQuality(params(), caps({ reducedMotion: true })).tier).toBe('medium');
  });

  it('已在 low 时降档钳制到端点，不产生非法档位', () => {
    expect(selectQuality(params(), caps({ mobile: true, reducedMotion: true })).tier).toBe('low');
  });

  it('URL 显式指定时不叠加减动效降档（显式意图优先）', () => {
    expect(selectQuality(params('?q=high'), caps({ reducedMotion: true })).tier).toBe('high');
  });

  it('每条决策都带可读理由，便于日志与 UI 解释', () => {
    for (const decision of [
      selectQuality(params('?q=low'), caps()),
      selectQuality(params(), caps(), 'medium'),
      selectQuality(params(), caps()),
    ]) {
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });
});
