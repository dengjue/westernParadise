import { APP } from './config';

/**
 * 全部用户可见文案集中在此，便于逐条过合规审查。
 * 注意：这里只放中性的工程提示，不含任何题材内容、建筑说明或引用文本。
 * 后续新增文案必须先过 02-方案/03-风险与合规红线.md 第 3 节。
 */
export const COPY = Object.freeze({
  loading: '正在准备空间…',
  noWebgl: '当前浏览器不支持 WebGL，无法运行 3D 场景。请更换浏览器或开启硬件加速。',
  noCanvas: '当前环境无法创建绘图画布。',
  reducedMotion: '已按系统「减少动态效果」偏好降低动效。',
  lowEnd: '检测到设备性能有限，已自动降低画质。',
  fatalTitle: '无法启动',
  fatalHint: '请刷新页面重试；若持续出现，请查看控制台错误信息。',
  about: APP.about,
  smokeBadge: '工程冒烟验证 · 占位场景',
} as const);
