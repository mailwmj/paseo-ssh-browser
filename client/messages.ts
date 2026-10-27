import { defineTranslations } from "@getpaseo/plugin/client";

export const messages = defineTranslations({
  resources: {
    en: {
      name: "SSH Browser",
      open: "Open SSH Browser",
      noPages: "No web pages found",
      noWorkspacePages: "No web server is running in this workspace",
      addHost: "SSH host, e.g. user@devbox",
      invalidHost: "Not a valid SSH destination",
      notSsh: "This workspace's host is not connected over SSH.",
      needLocal: "Also install SSH Browser on this computer's Paseo host to open pages.",
      unplug: "Stop forwarding {{port}}",
      rescan: "Rescan",
      address: "Port or localhost address",
      invalidAddress: "Enter a port or a localhost address",
    },
    "zh-CN": {
      name: "SSH 浏览器",
      open: "打开 SSH 浏览器",
      noPages: "没有发现网页",
      noWorkspacePages: "这个工作区还没有运行中的网页服务",
      addHost: "SSH 主机，例如 user@devbox",
      invalidHost: "不是有效的 SSH 地址",
      notSsh: "这个工作区所在的主机不是通过 SSH 连接的。",
      needLocal: "还需要在这台电脑的 Paseo 主机上安装 SSH 浏览器，才能打开网页。",
      unplug: "停止转发 {{port}}",
      rescan: "重新扫描",
      address: "端口或 localhost 地址",
      invalidAddress: "请输入端口号或 localhost 地址",
    },
  },
});
