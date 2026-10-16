# 灶眼 AI — 公开数据集与版权指引

## 现在已提供的素材

- `frontend/public/samples/demo-trays.mp4` 完全由 `ai-engine/scripts/generate_sample.py` 绘制的 **自建模拟视频**（3 次自上而下、1 次反向通过）；可放心用于开发、测试和比赛原型演示。
- `demo-color` 使用 **OpenCV 的颜色阈值分割 + 最近邻中心跟踪 + 越线方向判定** 对上述视频进行真实计算。它**不是餐盒深度学习模型，也不代表真实食堂识别精度**。

## 网络公开标注数据（需自行审核后引入）

| 来源 | 内容 | 页面披露的许可 | 备注 |
| --- | --- | --- | --- |
| [Roboflow Lunchbox](https://universe.roboflow.com/education-oqzdo/lunchbox) | 500 张 lunchbox 标注图 | CC BY 4.0 | 优先候选：检查场景与类别，进行数据质量审核 |
| [Roboflow Tray Detection](https://universe.roboflow.com/roboflow-infocomm-project/tray-detection-for-hawker-centres) | 130 张托盘、碗、餐盘等 | CC BY 4.0 | 规模有限、场景可能偏餐后回收，需要检查适配性 |
| [Roboflow Food Tray Detection](https://universe.roboflow.com/georges-workspace/food-tray-detection) | 214 张餐盘和食物标注图 | CC BY 4.0 | 需要过滤与出餐目标无关的食物类别 |
| [Pexels License](https://www.pexels.com/legal-pages/license/) | 视频和图片素材 | Pexels License | 可用于合法演示素材，但**未经标注不等于可直接训练**，检查人物肖像与商标 |

> 未经用户提供账号、确认最终训练许可并下载标注数据，本仓库**不会**自动爬取、打包或声称已经训练这些网络数据。CC BY 4.0 需要保留来源、署名、许可链接、修改说明。不同数据集的拍摄角度、定义类别及标注质量必须人工审核。

## 实际训练需要做什么

1. 优先以 **餐盒 / 餐盘 / 托盘** 中某一个明确的出餐单位为主要类别，避免同一份餐被两个不同容器重复计数。
2. 建立 `datasets/food-serving/{images,labels}/{train,val,test}` 并生成 `data.yaml`；每类具有足够的覆盖面，包括遮挡、不同光照、堆叠与返向运动。
3. 明确摄像头安装位置和越线方向；将图像按**视频或拍摄场景分组**划分训练/验证/测试，防止相邻帧泄漏导致虚高成绩。
4. 自行下载具备适当授权的 YOLO 权重，并核实 Ultralytics 许可。使用 `python scripts/train_yolo.py --data ... --weights ...` 训练。
5. 用**独立测试视频**逐帧人工标记有效越线事件；记录计数精确率/召回率、误计与漏计，不只看 mAP。
6. 在 `YOLO_WEIGHTS` 中配置模型权重绝对路径后再选择 UI 中的 YOLO 模式；系统不会默默切回虚构的“AI 检测结果”。

## 许可证提醒

Ultralytics 官方说明 YOLO 模型与代码默认受 **AGPL-3.0** 许可约束；如果计划私有部署、封闭源码、对外 SaaS 商业化，应评估 AGPL 义务或申请 Enterprise License。参见 https://www.ultralytics.com/license 。

此外，本项目当前仅提供源代码，不包含未经确认版权的第三方训练集、预训练权重与真实食堂视频。
