# GitHub → Lark Webhook

Zeabur 上的 GitHub Webhook 服务，监听 GitHub 仓库事件，通过 Lark API 发送卡片消息到飞书群。

## 部署到 Zeabur

1. 把项目推送到 GitHub 仓库
2. 在 Zeabur 导入该仓库
3. Zeabur 会自动识别 `package.json` 并部署
4. 部署后在 Zeabur 设置以下环境变量（会自动读取，无需手动设置）：
   - `LARK_APP_ID`
   - `LARK_APP_SECRET`
   - `LARK_CHAT_ID`
   - `GITHUB_SECRET`（可选，设置后 GitHub Webhook 会验证签名）

## 在 GitHub 仓库配置

1. 进入 GitHub 仓库 Settings → Webhooks → Add webhook
2. **Payload URL**: `https://your-zeabur-app.zeabur.app/webhook`
3. **Content type**: `application/json`
4. **Secret**: 填写你设置的 `GITHUB_SECRET`（可选）
5. 选择你想监听的事件（push、pull request、issues、workflow_run 等）
6. 点击 Add webhook
