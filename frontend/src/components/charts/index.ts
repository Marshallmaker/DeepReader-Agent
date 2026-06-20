/**
 * charts/index.ts — 统一入口
 *
 * 导入即注册：通过副作用 import 触发各图表模块的 ChartRegistry.register() 调用
 */

import './LineChart'
import './BarChart'
import './PieChart'
import './GaugeCard'
import './RadarChart'
import './HeatmapChart'
