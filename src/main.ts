import '@/08-ui/tokens.css';
import { bootstrap } from '@/99-boot';

/**
 * 应用入口，只做两件事：引入样式、调用装配层。
 * 所有逻辑都在 99-boot 与更低的层里，入口保持极简，
 * 避免「main.ts 逐渐膨胀成上帝文件」这个最常见的中型项目腐化路径。
 */
bootstrap();
