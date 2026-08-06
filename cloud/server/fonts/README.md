# XCharter 字体

来自 CTAN 的 `xcharter` 宏包(Michael Sharpe 维护),是 Bitstream Charter 的 OpenType 扩展,
沿用 Bitstream 的自由字体许可(允许再分发)。macOS 本地版用系统自带 Charter;
云端 Linux 没有 Charter,用 XCharter 达到一致观感。

构建镜像时这 4 个 .otf 会被拷进系统字体目录,LaTeX 模板里 `\setmainfont{XCharter}` 引用。
