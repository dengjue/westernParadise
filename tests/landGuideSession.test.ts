import { describe, expect, it } from 'vitest';
import { decodeLandGuideProgress as decode } from '@/03-platform';

describe('游线续游记录', () => {
  it('区分单点、进行中和已完成的支线', () => {
    for (const [choice, stage] of [
      ['entrance', 0],
      ['grove-tour', 1],
      ['grove-tour', 3],
      ['axis-tour', 4],
    ]) {
      expect(decode(JSON.stringify({ choice, stage }))).toEqual({ choice, stage });
    }
  });
  it('损坏或过期记录回退到自由游历', () => {
    for (const raw of [
      null,
      '{',
      'null',
      '{}',
      ...[
        ['entrance', 1],
        ['axis-tour', -1],
        ['grove-tour', 4],
        ['missing', 0],
        ['axis-tour', '2'],
        ['axis-tour', 1.5],
      ].map(([choice, stage]) => JSON.stringify({ choice, stage })),
    ])
      expect(decode(raw)).toBeNull();
  });
});
