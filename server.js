const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Lark config
const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_a9f678dd01b8de1b';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || '4NJnbgKT1cGjc8ddKhrjNcrEgsCT368K';
const LARK_CHAT_ID = process.env.LARK_CHAT_ID || 'oc_572c736a8f039483956536cb2726fe54';
const GITHUB_SECRET = process.env.GITHUB_SECRET || ''; // optional, set in Zeabur

// Parse JSON body, verify GitHub signature if secret set
app.use(express.json({
  verify: (req, res, buf) => {
    if (GITHUB_SECRET) {
      const sig = req.headers['x-hub-signature-256'];
      if (sig) {
        const hmac = crypto.createHmac('sha256', GITHUB_SECRET).update(buf).digest('hex');
        req._valid = `sha256=${hmac}` === sig;
      }
    }
  }
}));

// Get Lark tenant access token
async function getLarkToken() {
  const res = await fetch('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: LARK_APP_ID,
      app_secret: LARK_APP_SECRET
    })
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Lark auth failed: ${data.msg}`);
  return data.tenant_access_token;
}

// Send message to Lark group
async function sendLarkMessage(token, content) {
  const res = await fetch('https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      receive_id: LARK_CHAT_ID,
      msg_type: 'interactive',
      content: JSON.stringify(content)
    })
  });
  return res.json();
}

// Build card message for different events
function buildCard(event, payload) {
  const repo = payload.repository?.full_name || 'unknown';
  const repoUrl = payload.repository?.html_url || '#';
  const sender = payload.sender?.login || 'unknown';
  const senderUrl = payload.sender?.html_url || '#';
  const action = payload.action || '';

  const header = {
    title: { tag: 'plain_text', content: '' },
    template: 'blue'
  };

  const elements = [];

  // Common elements: repo + sender
  const common = [
    { tag: 'markdown', content: `📦 **Repo:** [${repo}](${repoUrl})` },
    { tag: 'markdown', content: `👤 **Sender:** [${sender}](${senderUrl})` }
  ];

  switch (event) {
    case 'push': {
      const ref = payload.ref || '';
      const branch = ref.replace('refs/heads/', '');
      const commits = payload.commits || [];
      header.title.content = `🔨 Push to ${branch}`;
      header.template = 'indigo';
      elements.push(
        { tag: 'markdown', content: `🌿 **Branch:** \`${branch}\`` },
        { tag: 'markdown', content: `📝 **Commits:** ${commits.length}` },
        ...common
      );
      // Show last 3 commits
      commits.slice(0, 3).forEach(c => {
        const shortSha = c.id?.substring(0, 7) || '';
        const msg = (c.message || '').split('\n')[0];
        elements.push({
          tag: 'markdown',
          content: `[\`${shortSha}\`](${c.url}) ${msg}`
        });
      });
      if (commits.length > 3) {
        elements.push({ tag: 'markdown', content: `... and ${commits.length - 3} more commits` });
      }
      break;
    }

    case 'pull_request': {
      const pr = payload.pull_request || {};
      const title = pr.title || '';
      const prUrl = pr.html_url || '';
      const merged = pr.merged === true;
      let emoji = '📥';
      let color = 'indigo';
      if (action === 'closed' && merged) { emoji = '✅'; color = 'green'; }
      else if (action === 'closed') { emoji = '❌'; color = 'red'; }
      else if (action === 'opened') { emoji = '🆕'; color = 'blue'; }
      header.title.content = `${emoji} PR ${action}: ${title}`;
      header.template = color;
      elements.push(
        { tag: 'markdown', content: `**PR:** [#${pr.number}](${prUrl}) ${title}` },
        ...common,
        { tag: 'markdown', content: `📄 **Status:** ${pr.state || ''}${merged ? ' (merged)' : ''}` }
      );
      break;
    }

    case 'issues': {
      const issue = payload.issue || {};
      const title = issue.title || '';
      const issueUrl = issue.html_url || '';
      header.title.content = `🐛 Issue ${action}: ${title}`;
      header.template = 'yellow';
      elements.push(
        { tag: 'markdown', content: `**Issue:** [#${issue.number}](${issueUrl}) ${title}` },
        ...common
      );
      break;
    }

    case 'workflow_run': {
      const workflow = payload.workflow || {};
      const run = payload.workflow_run || {};
      const name = workflow.name || '';
      const status = run.conclusion || run.status || '';
      const runUrl = run.html_url || '';
      const emoji = status === 'success' ? '✅' : status === 'failure' ? '❌' : '⏳';
      const color = status === 'success' ? 'green' : status === 'failure' ? 'red' : 'blue';
      header.title.content = `${emoji} Workflow: ${name} — ${status}`;
      header.template = color;
      elements.push(
        { tag: 'markdown', content: `**Workflow:** [${name}](${runUrl})` },
        { tag: 'markdown', content: `📊 **Status:** \`${status}\`` },
        ...common
      );
      break;
    }

    default: {
      header.title.content = `📡 GitHub Event: ${event}`;
      elements.push(...common);
      break;
    }
  }

  return {
    config: { wide_screen_mode: true },
    header,
    elements
  };
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  const event = req.headers['x-github-event'] || 'unknown';

  // Verify signature if configured
  if (GITHUB_SECRET && req._valid === false) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // Respond immediately to avoid timeout
  res.json({ ok: true });

  try {
    const card = buildCard(event, req.body);
    const token = await getLarkToken();
    const result = await sendLarkMessage(token, card);
    if (result.code !== 0) {
      console.error('Lark send error:', result);
    } else {
      console.log(`Sent ${event} notification to Lark`);
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
});

// Health check
app.get('/webhook', (req, res) => {
  res.json({ ok: true, message: 'GitHub → Lark webhook is running' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
