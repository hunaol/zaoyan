# V1.1 本轮测试记录

日期：2026-10-15。此报告只描述本轮修改，不能将旧版 TEST_REPORT.md 或 docker-runtime-20261015.json 的历史结果当作本轮通过记录。

## 在本次开发环境实际执行

| 检查 | 结果 | 能证明什么 |
| --- | --- | --- |
| Python pytest | **22 项通过** | 模拟视频/逐帧视觉、实时 JSON 协议、越线/去重、轨迹过期、预测日期截断、空值/零值、同星期分支、输入边界等 |
| 前端 API 单元测试 | **19 项通过** | 实际 api.ts 模块经 TypeScript 转译后运行；认证、401/403、上传字段、分页查询、批量复核、计划采用、日期转换等；网络为模拟，不是端到端 |
| Java 语法解析 | **38 个源文件通过** | JDK21 javac 解析阶段没有语法错误；未完成依赖解析和完整编译 |
| TypeScript/TSX 解析与转译 | **13 个文件，0 个语法/转译错误** | 不等于完整 React 类型检查，不等于 Vite 构建 |
| Python 编译检查 | 通过 | Python 源码与 scripts/verify-business.py 可解析 |
| 部署关键文件比对 | 与上传基线一致 | backend/frontend Dockerfile、Compose、Maven 配置及原启动脚本未改；.env 没有纳入交付包 |

原始输出：`v1.1-python-tests.log`、`v1.1-frontend-api-tests.log`、`v1.1-java-syntax.log`、`v1.1-typescript-syntax.log`。

Python 22 项中包括原有 5 项及新增 17 项（含参数化展开）。前端测试通过 `npm run test:api` 执行；本环境使用已安装的全局 TypeScript，通过 NODE_PATH 解析，未联网下载依赖。

## 已写入但本环境未执行的验证

**本环境没有 Docker/Maven，也没有项目所需的完整 React/Vite 依赖。以下项目没有被标记为通过：**

| 验证 | 已提供的落点 | 执行位置 |
| --- | --- | --- |
| Spring Boot 构建 + H2 集成测试 | `BusinessIntegrationTests.java` 新增 9 个 @Test；加原有 1 个，共 10 个测试方法 | 原 backend/Dockerfile 的 `mvn verify` |
| 完整 React 类型检查与 Vite 生产构建 | `npm run build`：先 API 单元测试，再 `tsc -b && vite build` | 原 frontend/Dockerfile |
| HTTP→Java→Python→数据库实际联调 | `scripts/verify-business.py`，总计 10 组检查 | 更新脚本构建完成后、替换原服务前，在一次性容器执行 |
| PowerShell 应用/回滚和 Docker 升级流程 | Apply/Restore 脚本 | 用户 Windows + Docker Desktop；本环境未做 Windows 执行验证 |
| 摄像头硬件与真实 YOLO | 页面入口与环境探测已接入 | 用户设备、授权采集场景与适配的模型权重 |

隔离联调会检查登录、Python 能力、模拟上传的 3 个事件、拍摄时间、标注视频、分页与复核审计、数据域、手动补录与 CSV、失败重试/取消、预测历史/样本不足/安全应用计划、实时 JPEG 越线/所有者权限/任务保存、注销。它始终自行启动临时 H2，不使用生产 MySQL；所有测试图像来自自行绘制的模拟数据。

## 修复过的回归问题

本轮 Python 测试识别出 `ceil(100 * 1.1 / 5)` 因二进制浮点误差把应为 110 的建议量抬成 115。现改为 Decimal 计算缓冲率和向上取整，并通过回归测试。

本轮语法检查识别出事件筛选 JSX fragment 闭合遗漏，已修正后重新检查。前端异步取数加入当前工作区 key 与请求序号双重校验，旧工作区的表单回调不能触发当前工作区的错误刷新。

## 未声明的结果

没有声称真实食堂已部署、实际餐盒识别精度达标、真实浪费减少、预测优于真实业务基线，或 Windows 浏览器摄像头已实测。自建模拟样本只用于验证软件链路。
