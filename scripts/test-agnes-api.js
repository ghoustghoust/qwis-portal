// Agnes AI API 连通性测试脚本
// 用法：node scripts/test-agnes-api.js
const path = require('path');

// 加载 .env
const envFile = path.join(__dirname, '..', '.env');
const fs = require('fs');
if (fs.existsSync(envFile)) {
  for (const lineRaw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0 && !process.env[line.slice(0, eq)]) {
      process.env[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
}

async function main() {
  console.log('=== Agnes AI API 连通性测试 ===\n');

  const apiKey = process.env.AGNES_API_KEY;
  const apiBase = process.env.AGNES_API_BASE || 'https://apihub.agnes-ai.com/v1';
  const model = process.env.AGNES_MODEL || 'agnes-2.5-flash';

  console.log(`API Base: ${apiBase}`);
  console.log(`Model:    ${model}`);
  console.log(`API Key:  ${apiKey ? apiKey.slice(0, 10) + '...' : '(未配置)'}`);
  console.log('');

  if (!apiKey) {
    console.error('❌ 未配置 AGNES_API_KEY，请先在 .env 中设置');
    process.exit(1);
  }

  // 测试 1：基础连通
  console.log('[1/3] 基础连通测试...');
  try {
    const url = `${apiBase.replace(/\/+$/, '')}/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '请回复"连通成功"四个字。' }],
        max_tokens: 20,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`❌ HTTP ${resp.status}: ${text.slice(0, 300)}`);
      process.exit(1);
    }

    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content || '(空回复)';
    console.log(`✅ 连通成功！模型回复: ${reply}`);
    console.log(`   模型: ${data?.model || '(未知)'}`);
    console.log(`   Token 用量: prompt=${data?.usage?.prompt_tokens}, completion=${data?.usage?.completion_tokens}`);
  } catch (err) {
    console.error(`❌ 请求失败: ${err.message}`);
    process.exit(1);
  }

  // 测试 2：翻译能力
  console.log('\n[2/3] 翻译能力测试...');
  try {
    const url = `${apiBase.replace(/\/+$/, '')}/chat/completions`;
    const testText = 'OpenAI has released GPT-5, featuring significant improvements in reasoning and code generation capabilities. The model demonstrates state-of-the-art performance on multiple benchmarks.';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是中英翻译专家，请将以下英文翻译为简洁准确的中文。' },
          { role: 'user', content: testText },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`❌ HTTP ${resp.status}: ${text.slice(0, 300)}`);
    } else {
      const data = await resp.json();
      const translation = data?.choices?.[0]?.message?.content || '(空回复)';
      console.log(`✅ 翻译成功！`);
      console.log(`   原文: ${testText.slice(0, 80)}...`);
      console.log(`   译文: ${translation.slice(0, 120)}`);
    }
  } catch (err) {
    console.error(`❌ 翻译测试失败: ${err.message}`);
  }

  // 测试 3：摘要能力
  console.log('\n[3/3] 摘要能力测试...');
  try {
    const url = `${apiBase.replace(/\/+$/, '')}/chat/completions`;
    const testText = `Anthropic 于今日发布了 Claude 4.8 模型，这是其最新一代大语言模型。
该模型在编程、数学推理和多语言理解方面取得了重大突破。
Claude 4.8 的上下文窗口扩展到了 500K tokens，支持处理超长文档。
在 HumanEval 编程基准测试中，Claude 4.8 达到了 95.2% 的通过率，创下新纪录。
Anthropic CEO Dario Amodei 表示，这一版本在安全性和准确性之间取得了更好的平衡。
新模型将于下周起向所有 API 用户开放，定价为每百万输入 token 15 美元。`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '请用 2-3 句话概括以下文章的核心要点。' },
          { role: 'user', content: testText },
        ],
        temperature: 0.4,
        max_tokens: 200,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`❌ HTTP ${resp.status}: ${text.slice(0, 300)}`);
    } else {
      const data = await resp.json();
      const summary = data?.choices?.[0]?.message?.content || '(空回复)';
      console.log(`✅ 摘要成功！`);
      console.log(`   摘要: ${summary.slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`❌ 摘要测试失败: ${err.message}`);
  }

  console.log('\n=== 测试完成 ===');
}

main().catch(err => {
  console.error('测试脚本异常:', err);
  process.exit(1);
});
