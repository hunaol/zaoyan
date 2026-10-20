# 灶眼 AI · 生产部署记录

部署时间：2026-10-16
部署方式：Docker Compose（源码从本机传输，非 git clone）

## 访问地址

| 项目 | 值 |
| --- | --- |
| 站点 | https://zaoyan.hunao.xin |
| 服务器 | 122.51.48.109（OpenCloudOS 9.6 / 腾讯云） |
| 应用目录 | `/www/wwwroot/zaoyan.hunao.xin` |
| nginx 配置 | `/www/server/panel/vhost/nginx/zaoyan.hunao.xin.conf` |
| 证书 | `/www/server/panel/vhost/cert/zaoyan.hunao.xin/`（Let's Encrypt，acme.sh 自动续期） |

登录账号见部署时输出的 `deploy/.env`（该文件权限 600，不在版本库中）。

## 容器

| 容器 | 镜像 | 内存上限 | 端口 |
| --- | --- | --- | --- |
| `deploy-mysql-1` | mysql:8.4 | 400M | `127.0.0.1:3307 → 3306` |
| `deploy-backend-1` | 本地构建（JDK21 + Python3 + OpenCV + ffmpeg） | 768M | 内部 8080 |
| `deploy-frontend-1` | 本地构建（nginx + 静态产物） | 64M | `127.0.0.1:18088 → 80` |

> **为什么用 18088 而不是默认 8088**：该服务器 8088 已被另一个 uvicorn 服务占用。

## 常用运维命令

在 `/www/wwwroot/zaoyan.hunao.xin` 下执行：

~~~bash
DC="docker compose --env-file deploy/.env -f deploy/docker-compose.yml -f deploy/docker-compose.override.yml"

$DC ps                      # 查看状态
$DC logs -f backend         # 跟踪后端日志
$DC restart backend         # 重启后端
$DC up -d --build           # 改代码后重新构建并启动
$DC down                    # 停止（保留数据卷）
~~~

**不要用 `down -v`**，那会删除 MySQL 与上传文件的数据卷。

## 本机与仓库的差异（部署时按服务器实际情况调整）

1. `deploy/.env` —— 部署时生成，含随机强密码与 `WEB_PORT=18088`。
2. `deploy/docker-compose.override.yml` —— 服务器专属，给三个容器加内存上限并收紧
   MySQL buffer pool。放在 override 里而不是改仓库的 compose 文件，是为了让
   "服务器资源约束" 与 "应用定义" 分离。
3. `backend/Dockerfile` —— 增加了 `fonts-wqy-microhei`。**这是必要的**：容器基础镜像
   只有 DejaVu 字体，不含中文字形，缺字体时标注视频里的中文会退化成 ASCII。

## 服务器资源背景（重要）

这台机器同时承载了 **13 个其他容器**（校园助手、博客、打卡、多个 AI 应用），
总内存仅 3.6GB。部署前可用内存只有 305MB，因此本次做了两件事：

1. **新增 2GB swap**（`/www/swap2`，已写入 `/etc/fstab`），总量达 3GB。
2. **把 `vm.swappiness` 从 0 调整到 10**。原值为 0 意味着内核几乎不使用 swap，
   而本机 13 个容器中有 12 个未设置内存上限，一旦某个容器失控就会直接 OOM。

部署后实测：可用内存 724MB（部署前 305MB），swap 使用约 1GB，系统负载正常。

## 需要注意的风险

- **磁盘剩余约 6.9GB（83%）**。构建镜像会额外占用空间，后续重新构建前建议先
  `docker image prune`。这是当前最紧张的资源。
- **所有密码在 `deploy/.env` 中**。首次正式使用前请确认已修改，且不要提交到版本库。
- **本部署未开启 HTTPS 之外的额外防护**：登录无失败次数限制、无验证码。
  面向公网长期运行建议加限流，或改为仅校内网/白名单访问。
- **视频上传上限 200MB**，nginx 已放开到 210m；如需更大需同时改
  compose 环境、后端 `application.yml` 与两层 nginx。
- 该服务器上 `zaoyan.hunao.xin` 与其他站点共用 nginx；修改
  `/www/server/panel/vhost/nginx/` 下其他文件会影响别人的服务。

## 端到端验证结果（部署后实测）

| 检查项 | 结果 |
| --- | --- |
| HTTPS 证书链 | Let's Encrypt 有效至 2027-01-14，HTTP 301 跳转 HTTPS |
| 健康检查 | `/api/health` 返回 `{"status":"ok"}` |
| 登录 | `demo` 管理员登录成功 |
| 运行环境探测 | OpenCV 4.14 可用、ffmpeg 可用、中文字体可用、跟踪器 kalman+hungarian |
| 视频分析 | 198 帧处理完成，识别 **3 次正向越线**，与预期一致 |
| 事件入库 | 3 条事件，风险标记正确（内容物待核实 / 目标贴边） |
| 标注视频 | 可下载，中文标注渲染正常（"有效越线 N 次"） |
