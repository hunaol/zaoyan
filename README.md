# 灶眼 AI · V1.2

面向高校食堂的出餐事件计数、人工复核与备餐辅助原型。前端使用 React / TypeScript，业务后端使用 Spring Boot，Python 负责视频视觉处理和备餐预测。

**可以任选一种方式运行：Docker 一键启动，或者自行安装依赖后原生启动。原生运行不需要 Docker，也不必另外安装 MySQL。**

## 先找到仓库根目录

本文所有“从仓库根目录执行”的命令，均指包含以下内容的目录：

~~~text
README.md
start-docker.cmd
frontend/
backend/
ai-engine/
deploy/
scripts/
~~~

通过 GitHub 下载 ZIP 后先解压，或使用 Git 克隆：

~~~text
git clone https://github.com/kong2758045884/Zaoyan-AI.git
cd Zaoyan-AI
~~~

若外面还有一层包装目录，请进入包含上述文件的内层目录；不需要使用作者电脑上的固定盘符或路径。

## 两种运行方式怎么选

| 方式 | 电脑上需要准备什么 | 数据库 | 网页地址 |
| --- | --- | --- | --- |
| Docker 一键运行 | Docker Desktop，或 Docker Engine + Compose 插件 | 容器中的 MySQL | http://localhost:8088 |
| 自行安装依赖，原生运行 | JDK 21、Maven、Node.js、Python、FFmpeg | 内置 H2 文件数据库 | http://localhost:5173 |

Docker 会在镜像中准备 Java、Python、Node.js 等环境，宿主机不需要再逐个安装。原生方式可以独立运行，但需要自行安装下文列出的依赖。

两种方式的数据分别保存在 Docker 数据卷和本地文件夹中，**不会自动同步或互相迁移**。

## 方式一：Docker 一键运行

### 1. 安装并准备 Docker

Windows / macOS 可以安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)。Windows 使用 Linux containers 模式，并完成 Docker Desktop 提示的 WSL 2 初始化。Linux 可以使用 Docker Engine 与 Compose 插件。

安装后确认以下命令可用：

~~~text
docker version
docker compose version
~~~

首次启动需要联网下载镜像及 Maven、npm、Python 依赖，构建过程可能需要几分钟。

### 2. Windows 一键启动

在仓库根目录双击 **start-docker.cmd**，或在 PowerShell 执行：

~~~powershell
.\start-docker.cmd
~~~

也可以直接调用脚本：

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-docker.ps1
~~~

脚本会：

1. 检查 Docker，未运行时尝试启动 Docker Desktop。
2. 首次运行生成随机数据库密码和登录密码，保存在 `deploy/.env`；后续沿用原文件。
3. 首次构建并启动 MySQL、后端、前端三个容器；后续启动复用镜像。
4. 等待容器健康，并检查网页、JavaScript 文件及后端接口。
5. 输出访问地址和登录账号密码，随后打开浏览器。

访问 **[http://localhost:8088](http://localhost:8088)**。默认管理员用户名为 `demo`，**Docker 安装的密码以脚本输出或 deploy/.env 中的 DEMO_PASSWORD 为准**，不使用下文原生演示密码。

修改代码后重新构建：

~~~powershell
.\start-docker.cmd -Rebuild
~~~

只启动、不自动打开浏览器：

~~~powershell
.\start-docker.cmd -NoBrowser
~~~

脚本对 Windows Docker Desktop 遗留通信文件的启动故障加入了处理：仅当安装配置明确指定了现有外置 WSL 数据盘时，为启动进程使用短路径的新运行缓存；原有数据盘、密码和数据卷继续保留。

### 3. Linux / macOS 使用 Compose

以下命令在仓库根目录执行。已有 `deploy/.env` 时保留原文件；首次运行时复制模板并编辑：

~~~bash
mkdir -p deploy/models
test -f deploy/.env || cp deploy/.env.example deploy/.env
~~~

打开 `deploy/.env`，将所有 `replace-with-...` 密码替换为自己的不同强密码，保留管理员用户名和所需端口。随后运行：

~~~bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build --wait --wait-timeout 240
~~~

同样访问 `http://localhost:8088`，使用自己在 `deploy/.env` 中配置的账号密码。

### 4. 日常管理

以下命令同样从仓库根目录执行，Windows、Linux、macOS 均可使用：

~~~text
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f backend
docker compose --env-file deploy/.env -f deploy/docker-compose.yml down
~~~

`down` 停止并移除容器，但保留业务数据卷。**不要用 down -v 来日常停止项目，它会删除数据库及上传文件数据卷。**

默认网页只发布到本机 `127.0.0.1:8088`。如端口冲突，在 `deploy/.env` 中设置 `WEB_PORT=其他空闲端口` 后重新启动。MySQL 和后端不直接发布宿主机端口。

镜像默认从 `docker.m.daocloud.io/library/` 获取，构建时使用已配置的依赖镜像源。如能直连 Docker Hub，可在 `deploy/.env` 设置 `IMAGE_PREFIX=docker.io/library/`。已有 MySQL 数据卷初始化后的数据库密码不要只改 `.env`，否则会造成数据库连接失败。

## 方式二：自己安装依赖，原生运行（不用 Docker）

以下流程直接启动 Java 后端、Python 算法和 Vite 前端。**本地默认使用 H2 文件数据库，不需要先安装 MySQL。**

### 1. 安装基础软件

| 依赖 | 本项目使用要求 | 官方下载 |
| --- | --- | --- |
| Java | **JDK 21**，需要 JDK，不能只安装 JRE | [Temurin JDK](https://adoptium.net/temurin/releases/?version=21) |
| Maven | 3.9 或以上，且使用上述 JDK 21 | [Apache Maven](https://maven.apache.org/download.cgi) |
| Node.js | 22 或以上，包含 npm | [Node.js](https://nodejs.org/en/download) |
| Python | 3.11 或以上，包含 pip 和 venv | [Python](https://www.python.org/downloads/) |
| FFmpeg | 安装后 `ffmpeg` 命令可用，用于视频处理与转码 | [FFmpeg](https://ffmpeg.org/download.html) |

将这些工具加入 PATH；安装后重新打开终端。检查：

~~~text
java -version
mvn -version
node --version
npm --version
python --version
ffmpeg -version
~~~

Linux / macOS 的 Python 命令通常是 `python3`，请用 `python3 --version` 检查。

**同时检查 java -version 和 mvn -version 中的 Java 版本都为 21。** 如果装了多个 JDK，需将 JAVA_HOME 和 PATH 指向 JDK 21；Java 17 不能编译本项目。

### 2. Windows：创建 Python 环境

从仓库根目录执行：

~~~powershell
python -m venv .\ai-engine\.venv
.\ai-engine\.venv\Scripts\python.exe -m pip install -i https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple -r .\ai-engine\requirements.txt
~~~

不必激活虚拟环境，后续使用它的 Python 完整路径即可。不要把虚拟环境上传到 GitHub。

### 3. Windows：启动后端

打开一个 PowerShell 终端，**从仓库根目录执行**：

~~~powershell
$repoRoot = (Get-Location).Path
$env:PYTHON_BIN = Join-Path $repoRoot 'ai-engine\.venv\Scripts\python.exe'
$env:AI_ROOT = Join-Path $repoRoot 'ai-engine'
$env:STORAGE_ROOT = Join-Path $repoRoot 'backend\data\storage'
$env:DB_URL = 'jdbc:h2:file:./data/zaoyan;MODE=MySQL;DATABASE_TO_LOWER=TRUE'
$env:DB_USER = 'sa'
$env:DB_PASSWORD = ''
$env:PORT = '8080'
$env:DEMO_USERNAME = 'demo'
$env:DEMO_PASSWORD = 'Demo@2026'
$env:OPERATOR_PASSWORD = 'Operator@2026'

Set-Location .\backend
mvn -s .\maven-settings.xml spring-boot:run
~~~

保持这个终端运行。首次执行 Maven 会下载 Java 依赖。看到 Spring Boot 启动成功后，可访问 `http://localhost:8080/api/health`，应返回 `"status":"ok"`。

Python 不需要再启动一个 HTTP 服务；Java 会按需调用配置的 Python 程序。

### 4. Windows：启动前端

另开一个 PowerShell 终端，**重新进入仓库根目录**，执行：

~~~powershell
Set-Location .\frontend
npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
~~~

保持前后端两个终端运行。浏览器访问 **[http://localhost:5173](http://localhost:5173)**。

| 本地演示身份 | 用户名 | 上述启动命令设置的密码 |
| --- | --- | --- |
| 管理员 | demo | Demo@2026 |
| 操作员 | operator | Operator@2026 |

这是原生演示环境的登录配置。可修改后端启动终端中的 `DEMO_PASSWORD` 和 `OPERATOR_PASSWORD` 后重启后端。已有 Docker 安装仍使用它自己 `deploy/.env` 中的密码。

停止时分别在前后端终端按 **Ctrl+C**。下次启动复用已有 Python 环境和 npm 依赖，重新执行第 3、4 步即可。

### 5. Linux / macOS 原生命令

先在仓库根目录安装 Python 依赖：

~~~bash
python3 -m venv ai-engine/.venv
ai-engine/.venv/bin/python -m pip install -i https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple -r ai-engine/requirements.txt
~~~

终端 A，从仓库根目录启动后端：

~~~bash
export PYTHON_BIN="$(pwd)/ai-engine/.venv/bin/python"
export AI_ROOT="$(pwd)/ai-engine"
export STORAGE_ROOT="$(pwd)/backend/data/storage"
export DB_URL='jdbc:h2:file:./data/zaoyan;MODE=MySQL;DATABASE_TO_LOWER=TRUE'
export DB_USER='sa'
export DB_PASSWORD=''
export PORT='8080'
export DEMO_USERNAME='demo'
export DEMO_PASSWORD='Demo@2026'
export OPERATOR_PASSWORD='Operator@2026'
cd backend
mvn -s maven-settings.xml spring-boot:run
~~~

终端 B，从仓库根目录启动前端：

~~~bash
cd frontend
npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
~~~

访问 `http://localhost:5173`；账号与上面的原生演示配置一致。

### 6. 数据保存位置和可选 MySQL

原生模式的 H2 数据库保存在 `backend/data/`，上传录像和算法结果保存在 `backend/data/storage/`。Docker 模式保存在命名数据卷 `deploy_mysql_data` 和 `deploy_app_data`。不要把业务数据库文件和录像当成源码分享。

如希望原生模式也使用自己安装的 MySQL，请先自行创建数据库和用户，再在后端启动终端配置：

~~~text
DB_URL=jdbc:mysql://127.0.0.1:3306/zaoyan?useUnicode=true&characterEncoding=utf8&useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai
DB_USER=你创建的数据库用户
DB_PASSWORD=对应密码
~~~

以上为配置项示例；PowerShell 使用 `$env:变量名 = '值'`，Bash 使用 `export 变量名='值'`。采用 H2 默认方式时不需要这一步。切换数据库不会自动迁移旧数据。

## 第一次体验

1. 登录后选择“模拟实验”数据域。
2. 打开 AI 出餐监测，使用内置模拟视频和 `demo-color` 模式。
3. 完成分析后查看结果视频、越线事件，并进行人工确认或剔除。
4. 可在设置中标定识别区域和计数线；任务会保存本次规则快照。
5. 可回看整段视频并定位补录；同一素材支持多个分析版本，但只有一个有效统计版本。
6. 餐次结算需明确确认覆盖范围、换算份数及待复核清零，再写入备餐台账。

**内置视频为自行生成的模拟素材，demo-color 是 OpenCV 色块检测，不是训练好的真实食堂模型。** 真实餐盘/餐盒识别需要安装可选 YOLO 依赖、提供适配的合法权重，并另行做场景验证。浏览器摄像头需要 localhost 或 HTTPS，以及浏览器授权。

业务细节见 [V1.2 说明](docs/BUSINESS_V1_2.md)、[架构](docs/ARCHITECTURE.md) 和 [数据说明](docs/DATASETS.md)。

## 测试与验证

Windows 下从仓库根目录运行现有测试：

~~~powershell
.\ai-engine\.venv\Scripts\python.exe -m pip install -r .\ai-engine\requirements-dev.txt
Push-Location .\ai-engine
.\.venv\Scripts\python.exe -m pytest -q tests
Pop-Location

mvn -s .\backend\maven-settings.xml -f .\backend\pom.xml verify

Push-Location .\frontend
npm run build
Pop-Location
~~~

2026-10-16 实机升级验证：Java 集成测试 **23** 项、Python 测试 **57** 项、前端 API 测试 **33** 项通过；TypeScript 和 Vite 构建通过；禁用网络、使用临时 H2 与临时存储的 **12 组**业务闭环检查通过。Docker 下已验证原 MySQL 数据与结果录像保留、原账号密码登录、新版接口及一键冷启动。

上述完整服务验收在 Docker 环境执行。本文原生命令按项目配置提供，本次没有把 Windows 宿主机上完整原生运行标为已验收；真实摄像头硬件和真实食堂模型准确率也未验收。详见 [本机升级记录](docs/verification/WINDOWS_V1_2_DEPLOYMENT.md)。

## 上传 GitHub、分享给别人

可以直接分享源码仓库，接收者按 README 任选一种方式运行，**不强制使用 Docker**。

建议将包含本 README、frontend、backend、ai-engine、deploy、scripts 的目录作为仓库根目录上传。Dockerfile、Compose、`deploy/.env.example` 和启动脚本应保留，方便需要 Docker 的使用者。

不要上传本机 `deploy/.env`、外层 `backups/`、数据库文件、上传录像、模型权重、虚拟环境、node_modules 和构建缓存；仓库提供了相应的 .gitignore。其他人首次运行时自行生成或配置密码，不需要作者电脑上的账号和路径。

GitHub 仓库用于保存和分发源码；GitHub Pages 不能直接运行本项目的 Java / Python / 数据库。希望别人无需安装开发环境就使用系统时，需要把前后端和数据库部署到可访问的服务上，再把网址分享给对方。

## 常见问题

- **Java 报 invalid target release: 21**：检查 JAVA_HOME 和 `mvn -version`，使用 JDK 21。
- **后端启动成功但算法不可用**：检查 PYTHON_BIN 是否指向虚拟环境，是否已安装 Python 依赖，并确认 `ffmpeg -version` 可运行。
- **前端能打开但接口报错**：确认后端在 8080 端口启动；如果自行改端口，也要同步修改 `frontend/vite.config.ts` 的代理目标。
- **端口被占用**：先停止已有实例，再重启；原生前端使用 strictPort，不会悄悄换到别的端口。
- **Docker 登录密码和原生演示密码不同**：Docker 使用 deploy/.env；原生方式使用后端启动终端中设置的环境变量。
- **依赖下载超时**：检查网络或代理；Python/npm 命令已给出镜像源，Maven 使用仓库中的 maven-settings.xml。

