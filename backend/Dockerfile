ARG IMAGE_PREFIX=docker.m.daocloud.io/library/
FROM ${IMAGE_PREFIX}maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /build
# Maven 构建阶段：在下载 Spring Boot 父 POM 之前启用镜像仓库。
COPY backend/maven-settings.xml /root/.m2/settings.xml
COPY backend/pom.xml pom.xml
RUN mvn -B -ntp -U dependency:go-offline
COPY backend/src src
RUN mvn -B -ntp verify && jar tf target/zaoyan-backend-1.0.0.jar > /dev/null

FROM ${IMAGE_PREFIX}eclipse-temurin:21-jre-jammy
ARG APT_MIRROR=https://mirrors.aliyun.com/ubuntu
ARG PIP_INDEX_URL=https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple
# Ubuntu 22.04 Jammy 系统依赖走 HTTPS 镜像；保留 apt 签名校验。
RUN set -eux; \
    for source in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do \
      if [ -f "$source" ]; then \
        sed -i \
          -e "s|http://archive.ubuntu.com/ubuntu|${APT_MIRROR}|g" \
          -e "s|http://security.ubuntu.com/ubuntu|${APT_MIRROR}|g" \
          "$source"; \
      fi; \
    done; \
    apt-get -o Acquire::Retries=4 update; \
    DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=4 install -y --no-install-recommends \
      curl python3 python3-pip python3-venv ffmpeg libglib2.0-0 libgl1; \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY ai-engine /app/ai-engine
RUN python3 -m venv /opt/zaoyan-venv && \
    /opt/zaoyan-venv/bin/pip install --no-cache-dir --timeout 60 --retries 5 \
      -i "${PIP_INDEX_URL}" -r /app/ai-engine/requirements.txt
COPY --from=build /build/target/zaoyan-backend-1.0.0.jar /app/server.jar
COPY backend/verify-artifact.py /app/verify-artifact.py
# Use the same verified Java distribution for compilation and runtime. Replace
# the entire directory so a damaged cached JRE cannot survive the rebuild.
RUN rm -rf /opt/java/openjdk
COPY --from=build /opt/java/openjdk /opt/java/openjdk
RUN java -version && ffmpeg -version > /dev/null && \
    /opt/zaoyan-venv/bin/python /app/verify-artifact.py && \
    /opt/zaoyan-venv/bin/python -c "import cv2, numpy; print('Python/OpenCV runtime OK')"
RUN mkdir -p /app/data && useradd -r -u 10001 zaoyan && chown -R zaoyan:zaoyan /app/data /app/ai-engine
ENV PYTHON_BIN=/opt/zaoyan-venv/bin/python AI_ROOT=/app/ai-engine STORAGE_ROOT=/app/data/storage
USER zaoyan
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/server.jar"]
