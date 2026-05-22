# Bili Clipper — 项目协作契约

## 项目名称
Bili Clipper

## 一句话目标
Chrome 扩展：在 B 站视频页注入 Clip bar，提取 CC 字幕，写入 Obsidian vault。

## 技术栈
- 框架：Chrome Manifest V3
- 语言：vanilla JS
- 集成：Obsidian URI scheme（`obsidian://new`）+ 系统剪贴板

## 文件结构

```
bili-clipper/
├── extension/
│   ├── manifest.json
│   ├── content.js        # Clip bar UI + Bilibili API helpers + 字幕处理
│   ├── background.js     # onInstalled → welcome.html；OPEN_WELCOME 消息处理
│   ├── popup.html/js     # 设置面板 + Clip 历史记录
│   ├── welcome.html/js   # 首次安装引导页
│   ├── icons/            # 16/48/128px PNG
│   └── assets/           # welcome 页截图资源
├── privacy-policy.html
├── README.md
└── CLAUDE.md
```

## 当前状态
扩展功能完整，准备上架 Chrome Web Store。

**已完成：**
- Clip bar 注入、CC 字幕提取、写入 Obsidian vault
- SPA 导航感知（pushState/replaceState 拦截）
- 首次安装 Onboarding（welcome.html）
- Popup 设置保存反馈、Clip 历史记录
- 扩展图标（紫底白回形针）
- 隐私政策页面

**待完成（发布前）：**
- Chrome Web Store 商店截图（1280×800）
- 商店描述文案（中英文）

## 协作原则

1. **先调研再提案** — 不确定时先搜索，再提方案，显式说明置信度。

2. **读源再提案** — 对现有文件提改动前，先读原文，不凭印象改。

3. **改动要小** — 大改拆成小步，每步可验证、可回滚。

4. **验证假设** — 实现后必须验证效果真的符合预期，不能只说"应该好了"。

5. **卡住时问"为什么"** — 遇到障碍，先停下来问清楚根本原因。

## 沟通约定
- 编辑现有文件前：先说明改什么、为什么，等确认再动手
- 删除任何内容前：明确告知，等确认

## 本项目专属 DoD
- 类型检查：无（vanilla JS，不用 tsc）
- 测试方式：chrome://extensions 重载扩展 → B 站视频页目视验证
- 验收方式：浏览器操作验证 + Obsidian 实际写入确认
