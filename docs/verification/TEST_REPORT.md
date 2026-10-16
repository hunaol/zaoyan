# 灶眼 AI — 本轮验收记录

## 2026-10-15 Windows Docker 实机部署

- 已启动 Docker Desktop；通过国内镜像源重新构建前后端。原后端镜像中的 JAR、Python 和缓存 Java 运行库存在损坏；新镜像使用与构建阶段相同的 Java 运行环境，并在构建时检查 Java、FFmpeg、Python/OpenCV、JAR 和嵌套依赖完整性。
- `mvn verify`：现有接口集成测试通过。原权限测试向档口修改接口提交空 JSON，会先触发表单校验返回 400；已改为有效表单，正确验证操作员返回 403。
- 最终容器环境中直接执行现有 5 个 Python 测试函数（不额外安装 pytest），全部通过，覆盖视频、越线去重、方向、实时 JSON Lines 和预测。
- MySQL、backend、frontend 三个容器均健康。MySQL 与上传文件继续使用原有数据卷。调整前已备份数据库和配置，位于外层 `backups/docker-setup-20261015-184201/`。
- 从外层目录调用 `start-docker.cmd -NoBrowser` 成功，Windows PowerShell 5.1 实际执行；宿主机首页、JS 文件和 `/api/health` 校验通过。
- 使用 `deploy/.env` 配置的管理员和操作员密码实际登录成功。修复了操作员密码未映射到 Spring 配置的问题。未认证访问业务接口返回 401。
- 经 Nginx 上传内置模拟视频，Java 调用 Python 完成 198 帧分析，产生 3 次越线事件，结果 MP4 为 96,211 字节且可读取。
- 实时接口启动会话、上传一帧 JPEG、返回处理结果并停止会话通过；没有测试浏览器摄像头授权和真实硬件采集。
- 空历史数据的预测任务正常返回 `INSUFFICIENT`。
- 验证新增了一条明确为 SIMULATION 的视频任务及 3 个对应事件，以及一条样本不足的模拟预测记录。
- 接口验证 JSON 见 `docker-runtime-20261015.json`。真实 YOLO 模型和真实食堂识别准确率未测试。

以下为最初生成环境中的历史验收记录；其中构建和 Docker 未执行的限制已由上述实机部署补验。

## 已在生成环境执行

- Python `pytest -q tests`：**5 个用例通过**，包括计数方向、重复跟踪事件、数据不足预测、完整模拟视频分析、常驻子进程 stdin/stdout 的实时帧交互。
- `python -m zaoyan_ai.video_job` 独立运行：处理 **198 帧**，得到 **3 次有效越线**（track IDs 为 2、3、4）；JSON 输出详见 `result.json`。
- 标注视频 `annotated-sample.mp4`：已使用 FFmpeg 转码，可检查 H.264 编码、900×520、18fps。
- TypeScript/TSX 语法解析：无解析错误，**不等于 npm 构建成功**。
- Docker Compose YAML：能够被 YAML 解析器读取。

## 暂未能实际执行

- npm install / React 生产构建：生成环境无法访问 npm registry，且没有该项目的 node_modules。
- Spring Boot Maven 编译、JUnit 接口联调及 Docker 容器启动：生成环境没有 Maven、Docker，且无法从 Maven Central 下载依赖。
- 实时浏览器摄像头端到端：需要浏览器摄像头权限及成功运行的 Spring Boot；已单独验证 Python 常驻进程协议。
- 真实餐盒/餐盘 YOLO 检测：目前没有已确认许可、完整标注的训练数据及训练权重，不能承诺准确率。

## 交付后建议验收顺序

1. 在可联网且有 Docker Desktop 的电脑上执行 `scripts/start-docker.ps1`，等待容器健康。
2. 登录并上传自带 `demo-trays.mp4`；确认结果为约 3 次正向越线，反向目标不会计数。
3. 执行复核与手工补录；确认驾驶舱统计即时变化，真实数据域不受模拟记录影响。
4. 填充明确标记的 8 天演示备餐样本，确认预测有解释；移除数据后应提示样本不足。
5. 授权摄像头，验证实时画面、目标框、越线事件、停止会话和清理子进程。
6. 导出 CSV，查看 Excel 显示及中文编码是否正确。
