# Job Copilot API 镜像:Node + pandoc + xelatex + XCharter 字体
# XCharter(Bitstream Charter 的 OpenType 扩展)直接内置在 fonts/ 里,构建不依赖外部下载。
FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive

# pandoc + xelatex 及模板用到的宏包:
#   titlesec/enumitem 在 texlive-latex-extra;lmodern 是 pandoc 默认模板必需(--no-install-recommends 会漏掉它)
RUN apt-get update && apt-get install -y --no-install-recommends \
      pandoc \
      texlive-xetex \
      texlive-latex-recommended \
      texlive-latex-extra \
      texlive-fonts-recommended \
      lmodern \
      fontconfig \
  && rm -rf /var/lib/apt/lists/*

# 安装 XCharter 字体(简历/求职信主字体,与 macOS 本地版的 Charter 观感一致)
COPY fonts/*.otf /usr/local/share/fonts/xcharter/
RUN fc-cache -f && fc-list | grep -i xcharter

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
CMD ["node", "src/index.js"]
