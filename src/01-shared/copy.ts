import { APP } from './config';

/**
 * 全部用户可见文案集中在此，便于逐条过合规审查。
 * 文案与场景配置分离：时段、天气和导览模块只引用这里的键，避免同一文字在多个
 * 配置文件中漂移。后续新增文案必须先过 02-方案/03-风险与合规红线.md 第 3 节。
 */
const GUIDE_COPY = Object.freeze({
  taiji: Object.freeze({
    title: '台基',
    body: '台基是木构建筑的基础：以砖石砌筑的高台把木柱架离地面，防潮防沉降，同时衬托建筑体量。台基越高，通常对应建筑等级越高。',
  }),
  zhulie: Object.freeze({
    title: '柱列',
    body: '柱是木构建筑的主要承重构件，柱脚垫柱础以隔潮分散荷载。檐廊下整齐排列的柱列划出廊道的空间节奏，是庭院视线里反复出现的韵律。',
  }),
  wuyan: Object.freeze({
    title: '屋檐',
    body: '屋檐挑出墙身之外，坡面把雨水导离基础。檐口微微起翘，兼顾排水与采光，是传统屋顶最具辨识度的轮廓特征。',
  }),
  puzhuang: Object.freeze({
    title: '铺装',
    body: '庭院铺装以青砖石板拼接，缝隙里的苔痕记录雨水与时间的走向。铺装的纹理与走向无声地引导脚步，是园林里的路线语言。',
  }),
} as const);

export const COPY = Object.freeze({
  loading: '正在准备空间…',
  noWebgl: '当前浏览器不支持 WebGL，无法运行 3D 场景。请更换浏览器或开启硬件加速。',
  noCanvas: '当前环境无法创建绘图画布。',
  reducedMotion: '已按系统「减少动态效果」偏好降低动效。',
  lowEnd: '检测到设备性能有限，已自动降低画质。',
  fatalTitle: '无法启动',
  fatalHint: '请刷新页面重试；若持续出现，请查看控制台错误信息。',
  fatalRetry: '重新加载',
  about: APP.about,
  smokeBadge: '工程冒烟验证 · 程序化庭院',
  timeOfDay: Object.freeze({
    dawn: '晨',
    noon: '午',
    dusk: '暮',
  }),
  weather: Object.freeze({
    clear: '晴',
    mist: '雾',
    rain: '雨',
  }),
  qualityLabel: '画质',
  aboutLabel: '关于',
  switchHint: Object.freeze({
    timeOfDay: '点击切换时段',
    weather: '点击切换天气',
  }),
  controlsHint: 'WASD 移动 · 右键拖拽视角 · 滚轮缩放',
  guide: GUIDE_COPY,
} as const);
