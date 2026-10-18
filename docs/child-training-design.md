# 弱视小游戏设计依据

## 产品边界

弱视小游戏是面向手机的辅助练习，不替代眼科检查、屈光矫正、遮盖治疗或医生制定的方案。普通屏幕任务用于练习对比、方向、拥挤、位置、运动、轮廓、形状、注意和手眼协调；只有佩戴红青眼镜并完成校准后，三项红蓝游戏才属于分视任务。

项目不宣称十二个游戏都已分别通过临床试验。游戏把已有研究中的视觉任务转化为更容易坚持的交互形式，疗效仍会因弱视类型、年龄、屈光矫正、依从性和训练剂量而不同。

## 十二个游戏

| 游戏 | 主要任务 | 难度变化 | 是否需要红青眼镜 |
| --- | --- | --- | --- |
| 星光捕手 | 在灰色背景中找到低对比目标 | 目标数量增加、亮度差减小 | 否 |
| 方向森林 | 在多个图案中找到朝向不同的目标 | 目标数量增加、方向差减小 | 否 |
| 缺口侦探 | 判断被周边图案包围的中央 Landolt C 缺口 | 图案、周边边缘间距和中央缺口逐步缩小 | 否 |
| 对齐积木 | 判断两段线条的位置是否对齐 | 横向偏移逐步减小 | 否 |
| 红蓝合环 | 两眼分别看到红色和青色半环，判断哪组能融合成完整圆环 | 错位量逐步减小 | 是 |
| 红蓝寻宝 | 两眼分别看到红色和青色标记，寻找重合位置 | 网格增大、非目标错位量减小 | 是 |
| 风向雷达 | 判断点群的整体运动方向 | 相干点比例降低、点数增加 | 否 |
| 曲线寻踪 | 从随机线段中找到连贯轮廓 | 线段增加、方向抖动增大 | 否 |
| 拼图工坊 | 在相似图形中匹配样板 | 形状差异逐步减小 | 否 |
| 记忆翻牌 | 记住并匹配由多个元素组成的图案 | 元素增加、预览时间缩短 | 否 |
| 萤火追击 | 追踪并点击持续移动的目标 | 目标变小、速度和干扰物增加 | 否 |
| 红蓝深度球 | 利用红青水平视差判断更靠前的一侧 | 双眼视差逐步减小 | 是 |

### 选择理由、操作与局限

- **星光捕手**：孩子点击灰底中亮度不同的星星，把对比检测知觉学习变成直接的寻找任务，对应 Polat、Zhou 等对比敏感度训练研究。屏幕亮度、反光和环境光都会改变实际对比度，因此等级只能在同一设备内比较。
- **方向森林**：点击朝向不同的小树，同时练习方向差辨别和视觉搜索。方向知觉学习有研究基础，但表现也受注意力和扫视策略影响，不能单独解释为视力变化。
- **缺口侦探**：看中央 Landolt C 并点选缺口方向，周围 C 用于逐级增加拥挤。17 级后会同时缩小圆环、中央缺口和周边图形的边缘间距；最高级仍保留至少 1 个画布像素的真实间隙，不使用图形遮挡制造难度。任务参考弱视的拥挤效应研究；这里以屏幕像素控制图形，不是标准视力表结果。
- **对齐积木**：比较左右两组线段，选择更接近对齐的一组，对应 Vernier/位置辨别训练。结果是当前设备上的相对位置精度，不能直接换算为视力。
- **红蓝合环**：红、青镜片分别传递两侧半环，孩子选择更容易拼成完整环的一组，借鉴双眼分视与抑制平衡思路。普通红青眼镜串色、屏幕色差和镜片方向会显著影响结果，也不等同于立体视训练。
- **红蓝寻宝**：在网格中点击红青标记重合的一格，把双眼分视与视觉搜索结合。表现会受搜索速度和眼动影响，且重合判断不是临床双眼平衡测量。
- **风向雷达**：从带有噪声的点群中判断多数点的共同方向，借鉴全局运动相干任务。设备性能和注意状态都会影响表现。
- **曲线寻踪**：在随机短线中寻找空间上连续的曲线，针对弱视研究中反复报告的轮廓整合困难。它是像素化任务，不能代替临床轮廓整合检查。
- **拼图工坊**：在相似多边形中匹配样板，练习整体形状辨别。成绩同时受旋转策略和理解能力影响。
- **记忆翻牌**：记住由多个彩色元素组成的样板，再从候选项中匹配，补充视觉注意和短时视觉记忆。它不是专门的弱视治疗试验，也不能用于评价儿童认知能力。
- **萤火追击**：追踪移动目标并触摸，结合动态视觉、持续注意和手眼协调。触屏延迟、手部动作和设备刷新率都会进入反应时间。
- **红蓝深度球**：以红青水平视差近似呈现前后深度，选择看起来更靠前的一侧。普通红青眼镜只能做粗略分视，不能替代随机点立体图或专业立体视检查。

多宝视及同类儿童产品常用游戏包装来提高完成意愿，本模块只借鉴“短任务、即时反馈、逐级变化”的产品思路；游戏名称、图形、规则参数、代码和文案均重新设计，没有复制其具体游戏、美术或关卡。

所有游戏默认每局 24 题。连续答对两题升一级，答错一题降一级，等级范围为 1–30。前八级用于熟悉任务，之后逐步缩小对比、方向差、位置差、运动相干比例或双眼视差；拥挤、记忆和追踪任务还会同步调整图形大小、干扰量、呈现时间或运动速度。每个相邻等级至少有一项实际刺激参数变化。每局保留题目参数、答案、反应时间、训练前后等级和完成状态。训练记录使用独立的儿童数据命名空间，不与电脑版或原掌上训练共享难度。

训练页允许随时暂停、继续或结束。暂停期间不接受点击，暂停时长不计入当前题反应时间；主动退出、切到后台或页面销毁会把已完成题目保存为未完成会话。为避免一次触摸重复计分，题目接受首个有效答案后立即锁定并切换为中性遮罩，反馈结束后才一次性显示下一题，避免通过前后两帧的闪动或相对位移猜答案。记忆翻牌从样板切换到选项时也保留 220 ms 空白间隔。连续三题错误会显示重新集中注意力的提示。

三端共用 `child-games-core.js` 的游戏元数据、试题生成、答案判定、24 题长度和 2 对 1 错阶梯规则。网页、小红书和微信各自实现 Canvas 与本地存储适配，不共享运行时数据库：

- 手机网页：`oraenViewChildDB`
- 小红书小工具：当前容器源下独立的 `oraenViewChildDB`
- 微信小程序：`oraenViewWechat:child:v1` 本地存储前缀

训练数据提供完成次数、累计题数、正确率、游戏分布、十二项当前等级、等级趋势、最近会话和逐题明细。清除儿童数据不会清除电脑版或掌上训练数据。

## 红青眼镜设置

- 使用常见的红/青（cyan）眼镜，不使用红/蓝深蓝镜片代替。
- 进入分视游戏前选择红色镜片位于左眼还是右眼，并选择弱视眼。
- 校准页分别显示纯红和纯青图案。透过单侧镜片观察时，另一颜色应明显变暗；如果两眼都能清楚看到两种颜色，说明串色过大，不应进行分视训练。
- 初始时弱视眼通道保持较高可见度，另一眼通道降低对比度。该比例只能作为屏幕端近似控制，无法替代专业设备的亮度校准。

## 研究参考

1. Polat U, et al. Improving vision in adult amblyopia by perceptual learning. PNAS, 2004. https://doi.org/10.1073/pnas.0401200101
2. Zhou Y, et al. Perceptual learning improves contrast sensitivity and visual acuity in adults with anisometropic amblyopia. Vision Research, 2006. https://doi.org/10.1016/j.visres.2005.07.031
3. Levi DM, Li RW. Perceptual learning as a potential treatment for amblyopia: a mini-review. Vision Research, 2009. https://doi.org/10.1016/j.visres.2009.02.010
4. Li RW, et al. Extended perceptual learning results in substantial recovery of positional acuity and visual acuity in juvenile amblyopia. IOVS, 2007. https://doi.org/10.1167/iovs.07-0324
5. Levi DM, Klein SA. Vernier acuity, crowding and amblyopia. Vision Research, 1985. https://doi.org/10.1016/0042-6989(85)90208-1
6. Chen D, et al. Impact of amblyopia on visual attention and visual search in children. IOVS, 2021. https://doi.org/10.1167/iovs.62.4.15
7. Li J, et al. Mechanisms of recovery of visual function in adult amblyopia through a tailored action video game. Scientific Reports, 2015. https://doi.org/10.1038/srep08482
8. Holmes JM, et al. Effect of a binocular iPad game vs part-time patching in children aged 5 to 12 years with amblyopia. JAMA Ophthalmology, 2016. https://doi.org/10.1001/jamaophthalmol.2016.4262
9. Kelly KR, et al. A binocular iPad treatment for amblyopic children. Eye, 2016. https://doi.org/10.1038/eye.2015.165
10. Birch EE, et al. Novel binocular iPad game treatment for amblyopia. Journal of Pediatrics, 2017. https://doi.org/10.1016/j.jpeds.2017.02.052
11. Chandna A, et al. Contour integration deficits in anisometropic amblyopia. IOVS, 2001. PMID: 11222553
12. Chandna A, et al. Recovery of contour integration in relation to LogMAR visual acuity during treatment of amblyopia in children. IOVS, 2004. https://doi.org/10.1167/iovs.03-0795
13. Jeffrey BG, et al. Altered global shape discrimination in deprivation amblyopia. Vision Research, 2004. https://doi.org/10.1016/j.visres.2003.09.009
14. Jiang SQ, et al. Contour integration deficits at high spatial frequencies in children treated for anisometropic amblyopia. Frontiers in Neuroscience, 2023. https://doi.org/10.3389/fnins.2023.1160853
15. Niechwiej-Szwedo E, et al. Effects of strabismic amblyopia and strabismus without amblyopia on temporal eye-hand coordination during reaching. IOVS, 2014. https://doi.org/10.1167/iovs.14-15507
16. Hou SW, et al. Evaluating visuomotor coordination in children with amblyopia. Developmental Psychobiology, 2022. https://doi.org/10.1002/dev.22270
17. Giaschi DE, et al. Motion-defined form perception in deprivation amblyopia. IOVS, 2024. https://doi.org/10.1167/iovs.65.4.13

随机对照研究对家庭双眼游戏的结果并不一致，依从性也是明显问题。因此本模块把“更容易坚持”和“训练过程可记录”作为产品目标，不把游戏包装成已经得到保证的治疗方案。

## 原创与资源

十二个游戏的名称、界面、关卡参数和绘制代码均为本项目原创实现。图形使用 Canvas 生成，不复制多宝视或其他产品的美术、关卡、声音和文案。现有答题音效由项目本地使用 FFmpeg 合成，不含第三方音频素材。

## 验证与仍需真机检查

### 2026-10-14 难度与答案线索检查

本轮逐项检查十二个游戏；调整同步到手机网页、小红书离线工具、微信小程序。保留原等级和历史记录，不将游戏等级解释为视力值。规则变更前后的同一等级不代表完全相同的任务难度。

| 游戏 | 检查及处理 |
| --- | --- |
| 星光捕手 | 高等级已接近普通屏幕的灰阶分辨限制，且目标逐级缩小；保留参数，避免把颜色差压到零。 |
| 方向森林 | 方向差从 60° 到 0.35°，已有连续梯度；保留参数。 |
| 缺口侦探 | 在现有尺寸、缺口和间距梯度上增加对比度下降；中心与周围圆环使用相同颜色、对比度和缺口宽度，圆环轮廓之间仍有间隔。 |
| 对齐积木 | 错位量从 24 到 0.23 逻辑像素，后段已受屏幕像素限制；保留参数。 |
| 红蓝合环 | 错位量从 30 到 0.45 逻辑像素；保留参数，需配合镜片校准。 |
| 红蓝寻宝 | 同时增加搜索数量并减小错位，已有较细后段梯度；保留参数。 |
| 风向雷达 | 静态箭头改为真正运动的随机点，全部点同色同尺寸；点寿命有限，重生时重新决定是否跟随共同方向，消除颜色提示和持续盯住某个信号点的捷径。 |
| 曲线寻踪 | 四个框的线段数量、长度、颜色、粗细相同；目标曲线随机旋转、改变相位和振幅；高级增加噪声与方向扰动。 |
| 拼图工坊 | 干扰项随机向两个方向改变，不再固定按选项序号放大差异。 |
| 记忆翻牌 | 使用带小幅抖动的格点布局，避免变化的圆被其他圆完全挡住；减小干扰项位移，保持所有选项可区分。 |
| 萤火追击 | 提示结束后必须继续跟踪 4500–9500 毫秒，随等级增加；出现“现在点中它”才接受点击。计时基于有效动画时间，暂停不计时，旧题回调不能覆盖新题。 |
| 红蓝深度球 | 近远球的视差绝对值相等，避免凭彩边宽度判断；黑底使用颜色相加，避免青色覆盖红色。仍是简化轮廓任务，不能称为排除了所有单眼线索的临床立体视测量。 |

补充验证：`scripts/child-animation-test.mjs` 在三端控制器上验证提前点击、暂停计时和旧帧失效；`scripts/child-render-test.mjs` 在 Chrome 中绘制网页及小红书全部游戏的 1、16、30 级。完整网页流程跑过十二局共 288 题。小红书完整测试包含儿童缺口侦探和成人模式，不等同于十二种游戏的真机实测。

自动测试可以验证参数、绘制与流程，不能证明某个等级对每个人都足够困难或可辨认。手机物理尺寸、亮度、距离和个人视觉能力都会影响实际难度；本轮没有新增临床有效性结论。小红书 Chrome 61 CSS 兼容性未实测，微信、小红书真机仍需复核。

- `npm test`：公共规则、题目可序列化、等级边界和三份规则文件一致性。
- `npm run test:child-web`：手机尺寸 Chrome 中完整运行十二局 288 题，验证暂停、红青设置、刷新恢复、数据曲线和与掌上数据隔离。
- `npm --prefix mini test`：微信存储命名空间、清除隔离、页面暂停和十二种绘制路径。
- `node xhs/tools/test.mjs --full`：严格 CSP、无外部请求、成人与弱视小游戏、刷新、明细和清空；`python xhs/tools/package.py` 生成上传 ZIP 并检查禁用语法和 10 MB 包体上限。

自动化不能验证红青镜片的实际滤色效果、不同手机的屏幕色差、微信和小红书真机 Canvas 触摸坐标、系统静音策略或长时间训练后的性能。上传前仍需在平台模拟器以及 iPhone、Android 真机各完成至少一局普通游戏和一局红青游戏。

