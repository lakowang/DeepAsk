import { QuestionNode } from "../types";

// Generate a random ID
export function generateId(): string {
  return "q_" + Math.random().toString(36).substring(2, 11);
}

// Add a node to the tree
export function addNodeToTree(
  nodes: QuestionNode[],
  parentId: string | null,
  newNode: QuestionNode
): QuestionNode[] {
  if (parentId === null) {
    return [...nodes, newNode];
  }

  return nodes.map((node) => {
    if (node.id === parentId) {
      return {
        ...node,
        isExpanded: true, // Auto-expand when a child is added
        children: [...node.children, newNode],
      };
    }
    if (node.children.length > 0) {
      return {
        ...node,
        children: addNodeToTree(node.children, parentId, newNode),
      };
    }
    return node;
  });
}

// Update a node inside the tree (e.g. changing text or answer, toggling expansion)
export function updateNodeInTree(
  nodes: QuestionNode[],
  id: string,
  updates: Partial<QuestionNode>
): QuestionNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return { ...node, ...updates };
    }
    if (node.children.length > 0) {
      return {
        ...node,
        children: updateNodeInTree(node.children, id, updates),
      };
    }
    return node;
  });
}

// Find a node by ID in the tree recursively
export function findNodeById(nodes: QuestionNode[], id: string): QuestionNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children.length > 0) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Replace the first occurrence of raw text with a Markdown hyperlink, avoiding doubling or nested links
export function replaceTextWithMarkdownLink(content: string, target: string, replacement: string): string {
  if (!content || !target) return content;
  
  const idx = content.indexOf(target);
  if (idx === -1) return content;
  
  // Don't replace if it is already wrapped in markdown link like `[target](url)` or `[something](target)`
  // Or if it is preceded by `[` and followed by `]` or `(`
  const beforeChar = idx > 0 ? content[idx - 1] : "";
  const afterChar = idx + target.length < content.length ? content[idx + target.length] : "";
  if (beforeChar === "[" || afterChar === "]" || afterChar === "(") {
    return content;
  }
  
  return content.slice(0, idx) + replacement + content.slice(idx + target.length);
}

// Delete a node from the tree
export function deleteNodeFromTree(nodes: QuestionNode[], id: string): QuestionNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => {
      if (node.children.length > 0) {
        return {
          ...node,
          children: deleteNodeFromTree(node.children, id),
        };
      }
      return node;
    });
}

// Delete a node and promote its direct children to its parent's level in the hierarchy
export function deleteNodeAndPromoteInTree(nodes: QuestionNode[], id: string): QuestionNode[] {
  const index = nodes.findIndex((node) => node.id === id);
  if (index !== -1) {
    const targetNode = nodes[index];
    const newNodes = [...nodes];
    newNodes.splice(index, 1, ...targetNode.children);
    return newNodes;
  }

  return nodes.map((node) => {
    if (node.children.length > 0) {
      return {
        ...node,
        children: deleteNodeAndPromoteInTree(node.children, id),
      };
    }
    return node;
  });
}

// Get all IDs inside a node recursively
export function getAllIdsInNode(node: QuestionNode): string[] {
  let ids = [node.id];
  for (const child of node.children) {
    ids = ids.concat(getAllIdsInNode(child));
  }
  return ids;
}

// Find a node inside the tree and get all IDs under its subtree (inclusive)
export function findNodeAndGetSubtreeIds(nodes: QuestionNode[], id: string): string[] {
  const node = findNodeById(nodes, id);
  if (!node) return [];
  return getAllIdsInNode(node);
}

// Clean up markdown hyperlinks referencing any deleted node IDs across the entire tree
export function cleanMarkdownLinksForDeletedIds(nodes: QuestionNode[], deletedIds: string[]): QuestionNode[] {
  if (deletedIds.length === 0) return nodes;
  return nodes.map((node) => {
    let updatedAnswer = node.answer || "";
    for (const delId of deletedIds) {
      const escapedId = delId.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      const regex = new RegExp(`\\[([^\\]]+)\\]\\(#node-${escapedId}\\)`, "g");
      updatedAnswer = updatedAnswer.replace(regex, "$1");
    }

    const newNode: QuestionNode = {
      ...node,
      answer: updatedAnswer,
    };

    if (node.children.length > 0) {
      newNode.children = cleanMarkdownLinksForDeletedIds(node.children, deletedIds);
    }
    return newNode;
  });
}

// Find path from root to target node for context (returns string array of texts)
export function findNodePath(
  nodes: QuestionNode[],
  targetId: string,
  currentPath: { id: string; name: string }[] = [],
  lang: "zh" | "en" = "zh"
): { id: string; name: string }[] | null {
  for (const node of nodes) {
    const textToUse = lang === "en" && node.en_text ? node.en_text : node.text;
    const nextPath = [...currentPath, { id: node.id, name: textToUse }];
    if (node.id === targetId) {
      return nextPath;
    }
    if (node.children.length > 0) {
      const found = findNodePath(node.children, targetId, nextPath, lang);
      if (found) return found;
    }
  }
  return null;
}

// Helper to count total questions and answered questions inside tree
export function getTreeStats(nodes: QuestionNode[]): { total: number; answered: number } {
  let total = 0;
  let answered = 0;

  function traverse(nList: QuestionNode[]) {
    for (const n of nList) {
      total++;
      if (n.answer && n.answer.trim().length > 0) {
        answered++;
      }
      if (n.children.length > 0) {
        traverse(n.children);
      }
    }
  }

  traverse(nodes);
  return { total, answered };
}

// Helper to populate sample data if tree is empty
export function createSampleQuestions(lang: "zh" | "en" = "en"): QuestionNode[] {
  const rootId1 = "q_root_1";
  const childId1_1 = "q_child_1_1";
  const childId1_2 = "q_child_1_2";
  const subChildId1_1_1 = "q_subchild_1_1_1";

  const rootId2 = "q_root_2";

  if (lang === "en") {
    return [
      {
        id: rootId1,
        text: "What is the future evolutionary direction of Artificial Intelligence (AI)?",
        en_text: "What is the future evolutionary direction of Artificial Intelligence (AI)?",
        answer: "### 🌌 The Evolution of AI: From Perception to Autonomous Choice\n\nThe future evolution of AI is widely expected to go through several key logical stages:\n\n1. **Multi-modal Fusion Perception**: Future AI will not just process text, but will fuse auditory, visual, tactile, and various sensor signals for millisecond-level physical environment perception.\n2. **Embodied AI**: Encapsulating large models physically into physical entities (like collaborative robots, humanoid bionic devices) so they can execute high-precision, long-sequence tasks in real 3D spaces.\n3. **Autonomous Intent Inference and Decomposition**: From \"receiving an instruction and executing once\" to the ability to \"be given a macro goal, autonomously deduce and decompose the working path\".\n\nYou can expand the sub-question below on the left to explore the technical bottlenecks in merging Embodied AI with large models!",
        isExpanded: true,
        createdAt: Date.now() - 3600000 * 2,
        children: [
          {
            id: childId1_1,
            text: "What is \"Embodied AI\"? How is it fundamentally different from traditional robots?",
            en_text: "What is \"Embodied AI\"? How is it fundamentally different from traditional robots?",
            answer: "#### 🤖 The Watershed Between Embodied AI and Ordinary Robots\n\nTraditional robots often operate based on **preset rules/hard-coded motion trajectories**, making them extremely fragile in unstructured complex environments. Embodied AI has the following three major traits:\n\n- **Active Environmental Sensing & Interaction**: Can perceive damping, friction, and gravity in the physical world to make real-time action strategy corrections.\n- **Self-training Without Expensive Annotation**: Self-training billions of motion flows in cloud virtual worlds through GANs or multimodal simulation environments, then zero-shot transferring to physical bodies.\n- **High Generalization Decision Brain**: Introducing Vision-Language-Action (VLA) models, for example, directly understanding the precise reasoning requirement of \"put the newly washed cup on the dry towel\".",
            isExpanded: true,
            createdAt: Date.now() - 1800000,
            children: [
              {
                id: subChildId1_1_1,
                text: "What are the core technical bottlenecks of Embodied AI in gravity/damping perception algorithms?",
                en_text: "What are the core technical bottlenecks of Embodied AI in gravity/damping perception algorithms?",
                answer: "#### 🔬 Three Underlying Bottlenecks in Force Control Perception of Embodied AI\n\n1. **Latency in Force Feedback**\n   - Current high-end robotic hands use high-frequency pressure sensors, but data traveling from sensors through system buses to central computing chips and returning action corrections still has a 20-50ms lag. In gripping fragile objects, this delay easily causes the object to be crushed or slipped.\n\n2. **Sim-to-Real Gap and the Simpson's Paradox of the Physical World**\n   - Simulation software (like Isaac OS) can virtualize gravity and rigid body friction, but when facing fluids or viscoelastic materials (like dough, wet rags), it is extremely difficult to build a perfect digital twin, causing algorithms that run perfectly in simulations to fail instantly in the real physical world.\n\n3. **Tactile Sensor Material Fatigue and High Costs**\n   - Bionic flexible skin is not only extremely expensive (often tens of thousands of dollars), but under frequent high-intensity operations, its impedance characteristics easily drift with temperature and time, making maintenance costs too high.",
                isExpanded: true,
                createdAt: Date.now() - 900000,
                children: [],
              },
            ],
          },
          {
            id: childId1_2,
            text: "What role do Multimodal Large Language Models (MLLMs) play in perception fusion?",
            en_text: "What role do Multimodal Large Language Models (MLLMs) play in perception fusion?",
            answer: "#### 🔮 Core Role: The \"Super Compilation Hub\" Unifying Different Physical World Representations\n\nIn the past, image processing had a CNN, audio processing had an audio model, and text processing had NLP. Multimodal Large Language Models (MLLMs) achieve a **Shared Embedding Space**:\n\n1. **Zero-shot Modality Alignment**: Video, acoustic signals, and electromagnetic telemetry signals are translated into the same Token representation via multimodal projectors for unified modeling by attention networks.\n2. **Dynamic Scene Graphs**: Given a picture of a room, an MLLM can output a layered topological graph like 'TV is above the cabinet, cat is right of TV, rug is in front of cabinet', translating it into structural spatial understanding instructions as logical inputs for actuators.",
            isExpanded: false,
            createdAt: Date.now() - 1500000,
            children: [],
          },
        ],
      },
      {
        id: rootId2,
        text: "What difficulties do low-carbon green energy grids face in peak-shaving and frequency regulation?",
        en_text: "What difficulties do low-carbon green energy grids face in peak-shaving and frequency regulation?",
        answer: "### ⚡ Green Grid Dilemma: The Logical Conflict Between Stochastic Volatility and Traditional Load Balancing\n\nWhen a high proportion of renewable energy, mainly wind and solar, is integrated into the grid, the main technical challenges it brings to modern power dispatching are as follows:\n\n1. **Extreme Meteorological Randomness**: Extreme weather (no wind, cloudy days) can cause terawatt-level power plunges in minutes, requiring backup energy to achieve massive output filling in a very short time.\n2. **Outstanding Frequency Regulation Pressure**: Traditional thermal power units have immense physical metal rotational inertia to stabilize system frequency; whereas inverters connecting electrochemical or green power devices have \"zero rotational inertia\", causing severe grid frequency fluctuations even under slight disturbances.\n\nYou can click the right side of this question to add a child question, such as exploring \"breakthroughs of electrochemical or flywheel energy storage in transient frequency stabilization\"!",
        isExpanded: true,
        createdAt: Date.now() - 3600000,
        children: [],
      },
    ];
  }

  return [
    {
      id: rootId1,
      text: "人工智能（AI）在未来的进化方向是什么？",
      en_text: "What is the future evolutionary direction of Artificial Intelligence (AI)?",
      answer: "### 🌌 人工智能的演进：从感知到自主抉择\n\n人工智能的未来进化被广泛认为会经历几个关键的逻辑演变阶段：\n\n1. **多模态融合感知**：未来的 AI 不仅仅是处理文字，而是将听觉、视觉、触觉以及各类传感器信号进行毫秒级的物理环境融合感知。\n2. **具身智能（Embodied AI）**：将大模型物理地封装入物理实体（如协作机器人、人形仿生设备），使其能够在真实三维空间中执行高精度、长序列的任务。\n3. **自主意图推断与分解**：从“接收一条指令执行一次”转化为“赋予宏观目标，自主推导并拆解工作路径”的能力。\n\n你可以展开下面左侧的子问题，深度探究具身智能与大模型融合中的技术瓶颈！",
      isExpanded: true,
      createdAt: Date.now() - 3600000 * 2,
      children: [
        {
          id: childId1_1,
          text: "什么是“具身智能”？它与传统机器人有何本质区别？",
          en_text: "What is \"Embodied AI\"? How is it fundamentally different from traditional robots?",
          answer: "#### 🤖 具身智能 (Embodied AI) 与普通机器人的分水岭\n\n传统机器人往往基于**预设规则/硬编码动作轨迹**进行作业，在面对非结构化复杂环境时极为脆弱。而具身智能具备以下三大特质：\n\n- **主动的环境感应交互**：能够感知物理世界中的阻尼、摩檫力和重力，进行实时动作策略回修正。\n- **无需高成本标注的自我训练**：通过生成对抗网络或多模态仿真环境，在云端虚拟世界自行训练数十亿次动作流程后，零样本迁移至物理本体。\n- **高泛化决策大脑**：引入了视觉-语言-动作模型 (VLA)，例如能够直接理解“把刚洗干净的杯子放到干毛巾上”这一精细推理要求。",
          isExpanded: true,
          createdAt: Date.now() - 1800000,
          children: [
            {
              id: subChildId1_1_1,
              text: "具身智能在重力/阻尼感知算法上的核心技术瓶颈是什么？",
              en_text: "What are the core technical bottlenecks of Embodied AI in gravity/damping perception algorithms?",
              answer: "#### 🔬 具身智能在力控感知层面的三大底层瓶颈\n\n1. **触觉反馈的滞后性 (Latency in Force Feedback)**\n   - 当前的高端机械手采用高频压力传感器，但数据从传感器、通过系统总线到中央算力芯片进行运算并返回动作校正，仍存有 20-50ms 调延迟。在脆弱物体夹持中，极易因延迟导致物体捏碎或滑落。\n\n2. **物理大世界的辛普森悖论与仿真器差距 (Sim-to-Real Gap)**\n   - 仿真软件（如 Isaac OS）可以虚拟出重力与刚体摩擦，但在面对流体、粘弹性材料（如面团、沾水的抹布）时，极其难以完美建立数字孪生，导致在模拟环境中运行极佳的算法在真实物理世界瞬间失准。\n\n3. **触觉传感器材料疲劳与高成本**\n   - 仿生柔性皮肤不仅价格异常昂贵（动辄万元美金），且在频繁的高强度作业中，其阻抗特性很容易随温度和时间漂移，维护成本过高。",
              isExpanded: true,
              createdAt: Date.now() - 900000,
              children: [],
            },
          ],
        },
        {
          id: childId1_2,
          text: "多模态大语言模型（MLLM）在感知融合中扮演怎样的角色？",
          en_text: "What role do Multimodal Large Language Models (MLLMs) play in perception fusion?",
          answer: "#### 🔮 核心角色：统一物理世界不同表征的“超级编译枢纽”\n\n在过去，图像处理有一个 CNN，语音处理有一个音频模型，文字处理有一个 NLP。而多模态大语言模型（MLLM）实现了一套**共享的语义特征空间 (Shared Embedding Space)**：\n\n1. **零样本模态对齐**：视频、声波信号与电磁遥测信号，通过多模态投影（Projector）被翻译为同一套 Token 表示形式，供注意力网络进行统一建模。\n2. **场景图建构 (Dynamic Scene Graphs)**：给出一张房间的照片，MLLM 能无序输出一张‘电视在柜子上方，猫在电视右侧，地毯在柜子前’的层层关联拓扑图，将其翻译成结构化的空间理解指令，作为执行器的逻辑输入。",
          isExpanded: false,
          createdAt: Date.now() - 1500000,
          children: [],
        },
      ],
    },
    {
      id: rootId2,
      text: "低碳绿色能源电网在调峰调频中面临着什么难题？",
      en_text: "What difficulties do low-carbon green energy grids face in peak-shaving and frequency regulation?",
      answer: "### ⚡ 绿色电网难题：随机波动性与传统负荷平衡的逻辑冲突\n\n以风电、光伏为主的高比例可再生能源在并网时，给现代电力调度带来的主要技术挑战如下：\n\n1. **极强的气象随机性**：极端天气（无风、阴天）可能在几分钟内导致太瓦级电能的骤降，要求后备能源能够在极短时间内实现大出力填补。\n2. **超群的变频调峰压力**：以往的传统火电机组具备天然的巨大的物理金属旋转惯性，能稳定系统频率；而逆变器并网 of 电化学或绿电发电设备“零转动惯性”，稍微受到扰动就会引起电网频率的剧烈动荡。\n\n你可以点击此问题右侧，增加一个子问题，比如探讨“电化学储能或飞轮储能在瞬时频率稳定中的突破”！",
      isExpanded: true,
      createdAt: Date.now() - 3600000,
      children: [],
    },
  ];
}

/**
 * Post-processes standard Markdown string to wrap sections defined by headings (H1 - H6)
 * into standard HTML <details><summary>...</summary>...</details> collapsible containers,
 * so they are rendered as beautifully animated accordion chapters.
 */
export function makeMarkdownHeadingsCollapsible(
  markdown: string,
  allOpenState: "default_open" | "all_open" | "all_closed" = "default_open"
): string {
  if (!markdown) return "";
  const lines = markdown.split("\n");
  let result: string[] = [];
  let isInCodeBlock = false;
  
  // Track open detail tags to close them when encountering headings of same or higher level
  let openDetails: { level: number }[] = [];
  
  // Determine if the detail element should render with the 'open' state parameter
  const isOpenAttr = allOpenState === "all_closed" ? "" : "open";
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Track code block sections so we do not distort codes or markdown symbols inside codes
    if (trimmed.startsWith("```")) {
      isInCodeBlock = !isInCodeBlock;
      result.push(line);
      continue;
    }
    
    if (isInCodeBlock) {
      result.push(line);
      continue;
    }
    
    // Check for standard markdown heading syntax (e.g. # Title, ## Title, etc.)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const hashes = headingMatch[1];
      const headingText = headingMatch[2];
      const level = hashes.length; // Level 1 through 6
      
      // Close any open details that are at the SAME or HIGHER hierarchical level (lower number means higher level, e.g., level 1 is higher than level 2)
      // For instance, a new H2 should close any existing open H2, H3, H4, etc.
      while (openDetails.length > 0 && openDetails[openDetails.length - 1].level >= level) {
        result.push("</div></details>\n");
        openDetails.pop();
      }
      
      // Open a new collapsible container representing this heading section
      // We start it 'open' by default so that content is fully visible initially, 
      // but users can toggle or collapse them instantly in response to markdown rules.
      result.push(`<details ${isOpenAttr} class="markdown-collapsed-section level-${level} my-4">`);
      result.push(`<summary class="markdown-collapsed-summary py-1 cursor-pointer select-none transition-colors">`);
      // Keeping the standard HTML header tags so the custom CSS styles apply to the summary without showing raw # symbols
      result.push(`<h${level} style="display:inline; border:none; padding:0; margin:0; line-height:inherit;">${headingText}</h${level}>`);
      result.push(`</summary>`);
      result.push(`<div class="markdown-collapsed-content pl-4 py-2 space-y-2">`);
      
      openDetails.push({ level });
    } else {
      result.push(line);
    }
  }
  
  // Close any remaining details tags
  while (openDetails.length > 0) {
    result.push("</div></details>\n");
    openDetails.pop();
  }
  
  return result.join("\n");
}

export interface ParsedAnswer {
  think?: string;
  content: string;
}

export function parseAnswersByLanguage(content: string): { zh: string; en: string; default: string } {
  let zh = "";
  let en = "";
  
  const zhStartIdx = content.indexOf("<zh_answer>");
  const zhEndIdx = content.indexOf("</zh_answer>");
  if (zhStartIdx !== -1 && zhEndIdx !== -1 && zhEndIdx > zhStartIdx) {
    zh = content.substring(zhStartIdx + 11, zhEndIdx).trim();
  }

  const enStartIdx = content.indexOf("<en_answer>");
  const enEndIdx = content.indexOf("</en_answer>");
  if (enStartIdx !== -1 && enEndIdx !== -1 && enEndIdx > enStartIdx) {
    en = content.substring(enStartIdx + 11, enEndIdx).trim();
  }

  if (!zh && !en) {
    return { zh: content, en: content, default: content };
  }

  return { 
    zh: zh || content, 
    en: en || content, 
    default: content 
  };
}

/**
 * Parses and separates the AI's <think>...</think> reasoning process from the rest of the answer markdown content.
 * This ensures thought and answer contents are separated cleanly at the string level.
 */
export function parseThinkAndContent(markdown: string): ParsedAnswer {
  if (!markdown) {
    return { content: "" };
  }

  const thinkStartRegex = /<think(?:\s[^>]*)?>/i;
  const thinkEndRegex = /<\/think>/i;

  const startMatch = markdown.match(thinkStartRegex);
  const endMatch = markdown.match(thinkEndRegex);

  if (startMatch && endMatch && endMatch.index !== undefined && startMatch.index !== undefined && endMatch.index > startMatch.index) {
    const thinkStartIdx = startMatch.index;
    const thinkStartLength = startMatch[0].length;
    const thinkEndIdx = endMatch.index;
    const thinkEndLength = endMatch[0].length;

    const thinkText = markdown.substring(thinkStartIdx + thinkStartLength, thinkEndIdx).trim();
    const beforeThink = markdown.substring(0, thinkStartIdx);
    const afterThink = markdown.substring(thinkEndIdx + thinkEndLength);
    
    // Combine before & after
    const contentText = (beforeThink.trim() + "\n\n" + afterThink.trim()).trim();

    return {
      think: thinkText,
      content: contentText
    };
  }

  // Handle unclosed <think> tag at the start (graceful fallback)
  if (startMatch && startMatch.index !== undefined && (!endMatch || (endMatch.index !== undefined && endMatch.index < startMatch.index))) {
    const thinkStartIdx = startMatch.index;
    const thinkStartLength = startMatch[0].length;
    
    const thinkText = markdown.substring(thinkStartIdx + thinkStartLength).trim();
    const beforeThink = markdown.substring(0, thinkStartIdx).trim();

    return {
      think: thinkText,
      content: beforeThink
    };
  }

  return { content: markdown };
}

/**
 * Recursively ensures all ancestors of a targetId are set to isExpanded: true.
 * Returns the modified nodes tree and a boolean indicating if target was found.
 */
export function expandAncestorsInTree(nodes: QuestionNode[], targetId: string): { nodes: QuestionNode[]; found: boolean } {
  let anyFound = false;

  const updated = nodes.map((node) => {
    if (node.id === targetId) {
      anyFound = true;
      return node;
    }
    
    if (node.children && node.children.length > 0) {
      const res = expandAncestorsInTree(node.children, targetId);
      if (res.found) {
        anyFound = true;
        return {
          ...node,
          isExpanded: true,
          children: res.nodes,
        };
      }
    }
    
    return node;
  });

  return { nodes: updated, found: anyFound };
}

/**
 * Find direct sibling nodes and index for targetId
 */
export function findSiblings(
  nodes: QuestionNode[],
  targetId: string
): { siblings: QuestionNode[]; index: number } | null {
  const index = nodes.findIndex((n) => n.id === targetId);
  if (index !== -1) {
    return { siblings: nodes, index };
  }
  
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      const result = findSiblings(node.children, targetId);
      if (result) {
        return result;
      }
    }
  }
  return null;
}




