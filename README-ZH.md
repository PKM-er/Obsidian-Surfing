## Another Web Browser

> 这个分支由 Boninall 维护，仅作个人使用。如果你想用该插件，使用 `quorafind/obsidian-web-browser` 分支而不是以前的；
> 原始分支来自[这里](https://github.com/Trikzon/obsidian-web-browser)

[English Doc](README.md)

## 简介

这是一款 Obsidian 插件，允许你在 Obsidian v1.0 的标签页中浏览任意网址。

这个插件的核心功能——渲染一个 webview ，离不开 [Ellpeck's Obsidian Custom Frames](https://github.com/Ellpeck/ObsidianCustomFrames) 插件。

![](assets/obsidian-web-browser.png)

## 功能介绍

- 核心功能
  - 浏览任意网页：该插件会劫持Obsidian的 file、http、https 协议，使得链接能直接在Obsidian里打开，而不是外部浏览器。对，本地HTML等资源也支持。
  - 编辑器网页搜索：你可以在编辑器选中关键字后，右键在 web-browser 中打开，使用默认的搜索引擎搜索。
  - 网页内网页搜索：同样的，你可以在网页内右键使用默认的搜索引擎搜索。
  - 复制指向高亮的链接：同浏览器一样，你可以选中文字，复制指向该处的链接。
  - 复制视频时间戳(实验性功能：目前仅支持bilibili)：右键文字弹出复制时间戳的菜单，目前有些bug，已知有时弹不出菜单。
- 辅助功能
  - 用外部浏览器打开当前URL：右键菜单
  - 默认搜索引擎：设置项
  - 默认复制高亮的模板：设置项（目前仅支持非常简单的模板），请避免使用一些特殊字符
  - 支持浏览历史记录：前后跳转网页
  - 清除浏览历史记录：命令面板
  - 所有链接都在右侧同一个面板中打开：设置项
  - 切换是否在右侧同一面板中打开：命令面板
  
## 安装

- 目前尚未准备好上架市场
- 可以通过 [Brat](https://github.com/TfTHacker/obsidian42-brat) 插件安装
- 手动安装

1. 在该github页面找到release页面并点击
2. 下载最新的一次release压缩包
3. 解压，复制解压后的文件夹到obsidian插件文件夹下，确保该文件夹里有main.js和manifest.json文件
4. 重启obsidian（不重启也行，得刷新），在设置界面启用该插件
5. 欧了

## Support

You can support original author `Trikzon` :

[<img src="https://user-images.githubusercontent.com/14358394/115450238-f39e8100-a21b-11eb-89d0-fa4b82cdbce8.png" width="200">](https://ko-fi.com/trikzon)