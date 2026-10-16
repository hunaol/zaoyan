# 灶眼 AI V1.2 — 本轮开发验证记录

日期：2026-10-16。基于用户运行快照与 V1.1 源码；不是用户 Windows/真实食堂环境的验收报告。

## 已真实执行通过

| 检查 | 结果 | 证据及范围 |
|---|---|---|
| Python 自动化测试 | **57 passed** | 原22项＋规则27项＋事件评估8项；包括真实 OpenCV 自建模拟视频/帧处理。`v1.2-python-tests.log` |
| 前端 API 封装单元测试 | **33 passed** | 执行实际 api.ts 转译模块，网络响应受控模拟，不是浏览器端到端。`v1.2-api-tests.log` |
| Java 计数规则契约 | **16 passed** | 真正使用 Java21 与 Jackson 对 CountingRules.java 编译和运行；不启动 Spring/数据库。`v1.2-java-rules.log`；可复查 `scripts/CountingRulesCheck.java`。 |
| Java 源码语法 | **55 个文件，0 语法错误** | JDK JavacTask.parse，包含新增 H2 测试文件；不是完整依赖编译。`v1.2-java-syntax.log` |
| TypeScript/TSX 语法转译 | **18 个文件，0 转译语法错误** | TypeScript transpileModule；不是完整 React 类型检查或 Vite 构建。`v1.2-typescript-syntax.log` |
| Python 源码语法 | 见日志，0 错误 | 逐文件 compile，不执行业务副作用。`v1.2-python-syntax.log` |

本环境还做过使用临时缺失库类型声明的内部接口绑定排错，但那些占位声明不是真实依赖，也没有打包，不能据此声称 Maven/React 正式构建通过。

## 新增验证覆盖

识别区域、任务快照、稳定帧、往返去重、遮挡间隔、低置信、嵌套容器、明确空类别、疑似重复保留预警；视频定位请求的幂等参数；完整历史页参数；统计版本切换；结算的倍率、完整覆盖确认、零量与覆盖旧量的独立确认；台账 revision；事件一对一评估与空数据不报满分。

新增 `BusinessClosureTests.java` 共13项 H2/服务集成测试，覆盖素材去重、多版本单统计、待复核阻断、完整覆盖/份数确认、零量、幂等、保护计划/实际备餐、旧量覆盖确认、源数据变化冲突及重新分析/切换时的台账状态。这些测试文件在此环境仅完成语法检查，**没有在完整 Spring 环境执行通过**。

## 本环境未完成的验证

完整 Maven verify、Spring Boot/JPA/H2 的集成执行、React 完整类型检查与 Vite 生产构建、Docker/Compose、Windows PowerShell 执行、浏览器操作和真实摄像头测试。当前容器没有 Maven/Docker/PowerShell 及完整前端依赖，依赖下载 DNS 不可用，不能将受限检查冒充已通过。

保留现有 Dockerfile 的 Maven verify、前端 API 测试＋TypeScript＋Vite 构建关卡。更新脚本仅在构建成功后运行临时 H2、临时目录、自建模拟素材的 `scripts/verify-business.py`；该脚本增加校准快照、重复上传、唯一统计版本、视频补录幂等、结算确认/失效/零量及完整历史接口检查，仍需在目标 Docker 上真正运行。

隔离联调用独立 `docker run --network none` 启动新镜像，不挂载现有数据库或应用数据卷；临时进程无权连接生产数据库。只有这一步通过后才切换原服务容器。脚本当前未在本环境真实执行，不能保证未知目标环境没有新问题。

## 模型与数据资产边界

未提供或训练适配真实餐盘/餐盒的权重，未进行真实食堂识别准确率或节约效果实测。本包新增本地模型类别检查和事件评价工具，但这不等于“模型已经训练好”。没有真实素材时不虚构已获许可的采集、真实识别率或正式部署成功。

## 修改及完整性

功能代码与说明初步统计：相对 V1.1 修改或新增 71 个文件，其中新增 30 个（最后随包测试日志/本报告及清单文件另计）；精确交付条目见增量包 `update-manifest.json`。

已逐字节核对原始用户快照中的两个 Dockerfile、Compose、Maven POM/镜像设置、原启动/修复脚本等，保持一致。全量包不含私有 `.env`、数据库备份、用户录像、模型权重、依赖目录或本地诊断占位库。内置 `demo-trays.mp4` 是原自建模拟素材。

旧 `docs/verification` 中 V1.0/V1.1 文件为历史记录，不能当作本轮成功证明。
