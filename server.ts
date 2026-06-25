import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

async function startServer() {
  const app = express();
  app.use(express.json());

  const PORT = 3000;

  function getLlmConfig(req?: express.Request) {
    const provider = (req?.headers["x-llm-provider"] as string || "").trim() || "gemini";
    const key = (req?.headers["x-llm-api-key"] as string || "").trim();
    const baseUrl = (req?.headers["x-llm-base-url"] as string || "").trim();
    const model = (req?.headers["x-llm-model"] as string || "").trim();
    return { provider, key, baseUrl, model };
  }

  // Unified Multi-Provider LLM Caller
  async function callLLM(prompt: string, expectJson = false, req?: express.Request): Promise<string> {
    const config = getLlmConfig(req);
    let provider = config.provider;
    let key = config.key;
    let baseUrl = config.baseUrl;
    let model = config.model;

    // Resolve Key (User Custom -> Backend Env variables -> default fallback)
    if (!key) {
      if (process.env.REQUIRE_CLIENT_API_KEY !== "false") {
        throw new Error("为了保障您的服务额度与密钥安全，当前已默认开启「密钥安全保护」模式（已停用公用后台开发密钥）。请点击右上角 “设置多模型 API” 按钮并输入您本人的 API 密钥后再试。");
      }

      if (provider === "minimax") {
        key = process.env.MINIMAX_API_KEY || "";
      } else if (provider === "openai") {
        key = process.env.OPENAI_API_KEY || "";
      } else if (provider === "deepseek") {
        key = process.env.DEEPSEEK_API_KEY || "";
      } else if (provider === "gemini") {
        key = process.env.GEMINI_API_KEY || "";
      } else if (provider === "anthropic") {
        key = process.env.ANTHROPIC_API_KEY || "";
      }
    }

    // Resolve Base URL defaults
    if (!baseUrl) {
      if (provider === "minimax") {
        baseUrl = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";
      }
    }

    // Zero-config robust transition: throw clean error if no minimax credentials exist
    if (provider === "minimax" && !key) {
      throw new Error(`当前模式 [MiniMax] 的 API Key 缺失。请在主页右上角“设置”中配置您的 MiniMax API Key 密钥以开启解答。`);
    }

    if (!key && provider !== "gemini") {
      throw new Error(`当前模式 [${provider}] 的 API Key 缺失。请在主页右上角“设置”中配置或在环境变量中设置对应的 API Key。`);
    }

    // Resolve Model Name
    if (!model) {
      if (provider === "minimax") model = process.env.MINIMAX_MODEL || "MiniMax-M3";
      else if (provider === "openai") model = "gpt-4o-mini";
      else if (provider === "deepseek") model = "deepseek-chat";
      else if (provider === "gemini") model = "gemini-3.5-flash";
      else if (provider === "anthropic") model = "claude-3-5-haiku-20241022";
      else if (provider === "custom") model = "gpt-4o-mini";
    }

    // System instruction definition
    const systemPrompt = expectJson 
      ? "你是一个返回JSON数据的智能大纲思维规划助手。请严格按照请求格式输出合法的 JSON 字符串，不要包含任何 Markdown 包裹语法（如 ```json）或其它解释文字。" 
      : "你是一个逻辑专家。请使用结构化 Markdown 对问题进行详实得体、条理清晰且富含逻辑深度的精美解答 and 排版。";

    // Use official @google/genai SDK when provider is gemini and there is no custom baseUrl
    if (provider === "gemini" && !baseUrl) {
      const client = new GoogleGenAI({
        apiKey: key || process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });
      const response = await client.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: expectJson ? "application/json" : undefined,
          temperature: 0.3,
        }
      });
      const text = response.text;
      if (!text) {
        throw new Error("Gemini API 返回了空内容。");
      }
      return text;
    }

    // Call Anthropic native API if chosen
    if (provider === "anthropic") {
      const url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/v1/messages` : "https://api.anthropic.com/v1/messages";
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [
            { role: "user", content: prompt }
          ],
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic Claude API HTTP ${response.status}: ${errText}`);
      }
      const data = await response.json() as any;
      const content = data?.content?.[0]?.text;
      if (!content) {
        throw new Error("Anthropic API returned empty content.");
      }
      return content;
    }

    // Handle standard/OpenAI-compatible endpoints
    let url = "";
    if (provider === "minimax") {
      const primaryUrl = "https://api.minimaxi.com/v1/chat/completions";
      if (baseUrl) {
        url = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/chat/completions`;
      } else {
        url = primaryUrl;
      }
    } else if (provider === "openai") {
      url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/chat/completions` : "https://api.openai.com/v1/chat/completions";
    } else if (provider === "deepseek") {
      url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/chat/completions` : "https://api.deepseek.com/chat/completions";
    } else if (provider === "gemini") {
      url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/chat/completions` : "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    } else if (provider === "custom") {
      if (!baseUrl) {
        throw new Error("自定义供应商必须填写 API 代理基址 (Base URL)。");
      }
      url = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/chat/completions`;
    }

    const payload: any = {
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      stream: false
    };

    if (provider === "minimax") {
      payload.tokens_to_generate = 4096;
      payload.max_tokens = 4096;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${provider} API HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.error(`${provider} API empty choices:`, data);
      throw new Error(`${provider} Response is empty`);
    }
    return content;
  }

  // --- API Routes ---

  // Check if LLM provider is configured and actually authenticates
  app.get("/api/ai-status", async (req, res) => {
    try {
      let { provider, key } = getLlmConfig(req);
      
      // Protection check: if client key is strictly required but not provided, fail early
      if (process.env.REQUIRE_CLIENT_API_KEY !== "false" && !key) {
        return res.json({ available: false, error: "密钥安全保护已启动，公用后台开发密钥已屏蔽。请在设置中输入您的自定义 API Key 密钥。" });
      }

      // Dynamic fallback setup
      if (provider === "minimax" && !key) {
        // If MiniMax has no key, report not configured
        return res.json({ available: false });
      }

      let finalKey = key;
      if (!finalKey) {
        if (provider === "minimax") {
          finalKey = "";
        } else if (provider === "openai") {
          finalKey = process.env.OPENAI_API_KEY || "";
        } else if (provider === "deepseek") {
          finalKey = process.env.DEEPSEEK_API_KEY || "";
        } else if (provider === "gemini") {
          finalKey = process.env.GEMINI_API_KEY || "";
        } else if (provider === "anthropic") {
          finalKey = process.env.ANTHROPIC_API_KEY || "";
        }
      }

      if (!finalKey && provider !== "gemini") {
        return res.json({ available: false, error: "API Key 缺失" });
      }

      // Perform a lightweight text generation request to verify the key and endpoints are fully functional
      try {
        await callLLM("ok", false, req);
        res.json({ available: true });
      } catch (validationError: any) {
        console.warn("AI configurations verification failed:", validationError.message || validationError);
        res.json({ available: false, error: validationError.message || "密钥或服务地址不可用" });
      }
    } catch (err: any) {
      res.json({ available: false, error: err.message || "核验遇到未知错误" });
    }
  });

  // API Route: Generate standard answer using selected LLM API
  const handleAnswer = async (req: express.Request, res: express.Response) => {
    try {
      const { text, context, lang = "zh" } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Required fields are missing: text" });
      }

      const pathContext = context && context.length > 0 
        ? (lang === "zh" ? `主题上下文层级：${context.join(" > ")}` : `Topic Context Path: ${context.join(" > ")}`)
        : (lang === "zh" ? "独立主题" : "Independent Topic");

      let prompt = "";
      if (lang === "en") {
        prompt = `You are an elite logic expert and field query analysis mentor.
The current question is located within a hierarchical question-tree with the following context:
[${pathContext}]

The current question selected for analysis and answering: "${text}"

Please provide a highly structured, logical, academically/professionally rigorous, and elegant explanation for the above question.
Please follow these guidelines strictly:
1. You MUST use structured Markdown formatting.
2. Structure your answer with clear, engaging paragraphs, utilizing descriptive headings, list bullets, bold emphasis, and code/quote blocks where appropriate.
3. Keep the explanations extremely concise, targeted, and direct (around 200 words) to ensure rapid response times and avoid redundant sentences.
4. Keep illustrative elements minimal: At most 1 relevant Unsplash image using \`![Description](https://images.unsplash.com/photo-1507842217343-583bb7270b66?q=80&w=600&auto=format&fit=crop)\` (or similar simple Unsplash URLs matching the theme), and at most 1 standard Markdown link.
5. CRITICAL STRUCTURE REQUIREMENT (BILINGUAL PARSING WRAPPER):
   You MUST output the response wrapped strictly in these XML tags to support interface language toggling:
   - Provide the English detailed answer inside <en_answer>.
   - Provide a high-quality Chinese translation/equivalent of the answer inside <zh_answer> (around 200-300 characters, clear and informative).
   
   Format your output EXACTLY like this:
   <zh_answer>
   [Your complete detailed Markdown Chinese answer here]
   </zh_answer>
   <en_answer>
   [Your complete detailed Markdown English answer here]
   </en_answer>`;
      } else {
        // lang === "zh" (default)
        prompt = `您是一个顶级的逻辑专家和领域疑问解析导师。
当前问题处于一个多层级提问树中，其上下文定义如下：
[${pathContext}]

当前选中并需要解答的问题："${text}"

请对上述问题进行条理清晰、细致入微、极具逻辑深度的学术级或专业级的精美解答。
请遵循以下撰写规范：
1. 必须使用结构化 Markdown 格式。
2. 包含吸引人、条理分明的段落，善用小标题、列表符号、重点加粗和引用/代码块。
3. 篇幅力求精炼（中文大约 200-300 字），坚决避免任何开场白、套话及冗长重复，以便极速生成。
4. 极简多媒体与引用：最多插入 1 张与主题密切契合的 Unsplash 高清配图，例如使用标准的 Markdown 格式如 \`![说明](https://images.unsplash.com/photo-1507842217343-583bb7270b66?q=80&w=600&auto=format&fit=crop)\`，以及最多 1 个高质量参考链接，从而最大限度压缩生成延迟。
5. 非常重要：为了与前端的双语解析和语言切换机制无缝兼容，您必须输出以下包含 XML 标签 of 响应结构：
   - 在 <zh_answer> 标签内放入您的高质量中文解答 Markdown 内容。
   - 在 <en_answer> 标签内放入该解答的地道英文翻译或英文对应版本（200词以内，直接切入核心）。
   
   严格格式如下:
   <zh_answer>
   这里放入中文解答的 Markdown 内容
   </zh_answer>
   <en_answer>
   这里放入英文解答的 Markdown 内容
   </en_answer>`;
      }

      const { provider } = getLlmConfig(req);
      const resultText = await callLLM(prompt, false, req);
      res.json({ text: resultText });
    } catch (error: any) {
      console.error("LLM Answer Error:", error);
      res.status(500).json({ error: error.message || "AI 自动回答失败" });
    }
  };

  // API Route: AI-suggested follow-up child questions
  const handleSuggestions = async (req: express.Request, res: express.Response) => {
    try {
      const { text, context, lang = "zh" } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Required fields are missing: text" });
      }

      const pathContext = context && context.length > 0 
        ? (lang === "zh" ? `当前路径上下文: ${context.join(" > ")}` : `Current Context Path: ${context.join(" > ")}`)
        : (lang === "zh" ? "无上层路径" : "No parent path");

      const prompt = `您是一个思维启发和逻辑追问大师。
当前我们在一个“问题 tree-view 剖析面板”中。
【当前问题上下文】：${pathContext}
【当前选择剖析的问题】："${text}"

为了帮助用户将该问题往深层递进拆解（支持无限级子提问），请帮其构思 3 到 5 个高度相关的、极有追问价值的“衍生子提问”。
注意：这些子疑问应当比当前提问更微观、更具体、具有层层剖析之感。

为了最大限度地提高生成速度，请遵循以下语言优化规则：
- 如果当前语言环境是中文 (zh)，请着重生成 "text" 与 "reason" 字段（使用生动具体的中文），而 "en_text" 和 "en_reason" 字段只需放入简短的单语翻译或留空。
- 如果当前语言环境是英文 (en)，请着重生成 "en_text" 与 "en_reason" 字段（使用地道学术的英文），而 "text" 和 "reason" 字段只需放入简短的中文翻译或留空。

请必须以合法的 JSON 格式返回，绝对不要包含 Markdown 标记、外部前导说明或者是包裹反引号。
你返回的内容结构必须严格等同于以下样例格式：
{
  "suggestions": [
    {
      "text": "微观衍生子提问中文描述，简练具体，不超过20字",
      "reason": "启发追问原因中文描述，不超过50字",
      "en_text": "English translated micro-question, precise and short",
      "en_reason": "English translated reason for the question"
    }
  ]
}

当前语言环境: ${lang === "en" ? "英文 (en)" : "中文 (zh)"}

输出的 JSON:`;

      const { provider } = getLlmConfig(req);
      const resultText = await callLLM(prompt, true, req);
      
      // Clean up markdown json wrap block if model generated any
      let jsonText = resultText.trim();
      if (jsonText.startsWith("```json")) {
        jsonText = jsonText.substring(7);
      } else if (jsonText.startsWith("```")) {
        jsonText = jsonText.substring(3);
      }
      if (jsonText.endsWith("```")) {
        jsonText = jsonText.substring(0, jsonText.length - 3);
      }
      jsonText = jsonText.trim();
      
      try {
        const parsed = JSON.parse(jsonText);
        res.json(parsed);
      } catch (err) {
        console.warn(`${provider} suggested json parsing direct retry with regex extractor:`, jsonText);
        // Safe regex extractor fallback
        const match = jsonText.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            res.json(JSON.parse(match[0]));
            return;
          } catch (_) {}
        }
        
        // Fail-safe suggestion
        res.json({
          suggestions: [
            { text: "衍生微观机制追问", reason: "探究该主题背后的核心机理与变量结构。" }
          ]
        });
      }
    } catch (error: any) {
      console.error("LLM Suggestion Error:", error);
      res.status(500).json({ error: error.message || "AI 启发子层级失败" });
    }
  };

  // API Route: Polishing local drafts
  const handlePolish = async (req: express.Request, res: express.Response) => {
    try {
      const { draft, lang = "zh" } = req.body;
      if (!draft) {
        return res.status(400).json({ error: "Required fields are missing: draft" });
      }

      const prompt = lang === "en"
        ? `You are an elite text polisher and editor. Please refine, structure, and polish the following draft, converting it into an elegant, professional, and easy-to-read Markdown document:
- If beneficial to the meaning, you can add high-quality references (using standard Markdown links like \`[Website Name](URL)\`).
- If applicable, design and insert 1 relevant high-definition illustration (using standard Markdown image syntax with dynamic high-quality links from professional image databases, e.g., Unsplash, in the format \`![Alt Text](URL)\`).
- To ensure maximum speed, keep the response concise, beautiful, and professional.

${draft}`
        : `你是一个优秀的文字润色助理。请对以下草稿进行语言精练、逻辑梳理和排版润色，让其转化为优美、专业且易于阅读的 Markdown 文档：
- 如果对文意有帮助，可以适当补充真实的参考引用链接（使用标准的 Markdown 格式如 \`[媒体/网站名称](URL)\`）。
- 如果适用，可以设计并添加 1 张高清插画/插图（使用 Markdown 图片格式并选用来自多种专业高质量图库（如 Unsplash、Pexels、Pixabay 或 Wikimedia Commons）的图片，如 \`![图片说明](URL)\`）。
- 为了保证最快速度，内容请言简意赅、拒绝空话套话。

${draft}`;

      const { provider } = getLlmConfig(req);
      const resultText = await callLLM(prompt, false, req);
      res.json({ text: resultText });
    } catch (error: any) {
      console.error("LLM Polish Error:", error);
      res.status(500).json({ error: error.message || "AI 润色文本失败" });
    }
  };

  app.post("/api/gemini/answer", handleAnswer);
  app.post("/api/minimax/answer", handleAnswer);
  app.post("/api/gemini/suggest-children", handleSuggestions);
  app.post("/api/minimax/suggest-children", handleSuggestions);
  app.post("/api/gemini/polish", handlePolish);
  app.post("/api/minimax/polish", handlePolish);

  // --- Vite & Client Build Serving Middleware ---

  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode (Vite middleware enabled)...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode (Static files enabled)...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server fully booted on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Critical: Express server failed to start:", err);
  process.exit(1);
});
