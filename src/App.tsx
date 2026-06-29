import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  HelpCircle,
  Plus, 
  Search, 
  Layers, 
  Heart, 
  RefreshCw, 
  CheckCircle2, 
  BarChart2, 
  TrendingUp,
  FolderPlus,
  BookOpen,
  Info,
  Settings,
  Key,
  Download,
  Upload,
  Trash2,
  Loader2,
  Check,
  X,
  Wand2,
  Sparkles,
  ArrowLeft
} from "lucide-react";
import { QuestionNode, AISuggestion } from "./types";
import { 
  generateId, 
  addNodeToTree, 
  updateNodeInTree, 
  deleteNodeFromTree, 
  deleteNodeAndPromoteInTree,
  findNodePath,
  getTreeStats,
  createSampleQuestions,
  findNodeById,
  replaceTextWithMarkdownLink,
  findNodeAndGetSubtreeIds,
  cleanMarkdownLinksForDeletedIds,
  expandAncestorsInTree,
  findSiblings,
  parseThinkAndContent
} from "./components/TreeHelper";
import { TreeNodeComponent } from "./components/TreeNodeComponent";
import { AnswerPane } from "./components/AnswerPane";
import { NetworkView } from "./components/NetworkView";
import { LayoutDivider } from "./components/LayoutDivider";

// --- START OF FILE IMPORT & DEDUPLICATION PARSING UTILITIES ---

function normalizeTextForMatch(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .trim()
    // Strip emojis
    .replace(/[\u1F600-\u1F64F\u1F300-\u1F5FF\u1F680-\u1F6FF\u2600-\u26FF\u2700-\u27BF\u3297\u3299\u1F000-\u1F9FF\u1F1E0-\u1F1FF]/g, "")
    // Strip leading list/heading bullet formats like "1.", "1.1.", "一、", "①", "A.", etc.
    .replace(/^[\s\-\*+\d\.\/\d、a-zA-Z、]+/, "")
    // Strip all punctuation and whitespaces
    .replace(/[\s\p{P}]/gu, "");
}

function sanitizeParsedNode(item: any): QuestionNode {
  const node: QuestionNode = {
    id: item.id || "q_import_" + Math.random().toString(36).substring(2, 11),
    text: typeof item.text === "string" ? item.text.trim() : "未指定问题标题",
    answer: typeof item.answer === "string" ? item.answer.trim() : "",
    isExpanded: typeof item.isExpanded === "boolean" ? item.isExpanded : true,
    children: Array.isArray(item.children) ? sanitizeParsedNodesArray(item.children) : [],
    createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now()
  };
  if (typeof item.en_text === "string") {
    node.en_text = item.en_text.trim();
  }
  return node;
}

function sanitizeParsedNodesArray(arr: any[]): QuestionNode[] {
  return arr.map(sanitizeParsedNode);
}

function parseJSONToTree(jsonText: string): QuestionNode[] | null {
  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) {
      if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
        return [sanitizeParsedNode(parsed)];
      }
      return null;
    }
    return sanitizeParsedNodesArray(parsed);
  } catch (error) {
    return null;
  }
}

function parseListToTree(lines: string[]): QuestionNode[] {
  // Let's check if there is a specific TOC section
  let startIdx = 0;
  let endIdx = lines.length;
  
  let hasOutlineSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("## ") && (line.includes("问题层级大纲树") || line.includes("已导出的问题目录索引") || line.includes("目录") || line.includes("TOC") || line.includes("Hierarchy"))) {
      startIdx = i + 1;
      hasOutlineSection = true;
      break;
    }
  }
  
  if (hasOutlineSection) {
    // Stop parsing list items when we encounter another major heading or divider
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("## ") || line.startsWith("---")) {
        endIdx = i;
        break;
      }
    }
  }

  const listNodes: QuestionNode[] = [];
  const listStack: { node: QuestionNode; indent: number }[] = [];
  
  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i];
    const listMatch = line.match(/^(\s*)([-*+])\s+(?:\[[^\]]*\]\s*)?(.+)$/);
    if (listMatch) {
      const indent = listMatch[1].length;
      const text = listMatch[3].trim();
      
      const node: QuestionNode = {
        id: "q_import_" + Math.random().toString(36).substring(2, 11),
        text: text,
        answer: "",
        isExpanded: true,
        children: [],
        createdAt: Date.now()
      };
      
      while (listStack.length > 0 && listStack[listStack.length - 1].indent >= indent) {
        listStack.pop();
      }
      
      if (listStack.length === 0) {
        listNodes.push(node);
      } else {
        listStack[listStack.length - 1].node.children.push(node);
      }
      
      listStack.push({ node, indent });
    }
  }
  return listNodes;
}

function parseMarkdownToTree(mdText: string): QuestionNode[] {
  const lines = mdText.split(/\r?\n/);
  
  // Parse lists (TOC/bullets) to build hierarchical question tree first
  const treeNodes = parseListToTree(lines);
  
  // Check if file has metadata lines (exported format indicator)
  const hasMetadataLines = lines.some(line => {
    const l = line.toLowerCase();
    return l.includes("大纲深度") || l.includes("课题状态") || l.includes("depth") || l.includes("status");
  });

  // Create a fast lookup set of question texts from treeNodes
  const questionTextsSet = new Set<string>();
  if (treeNodes.length > 0) {
    function collectQuestionTexts(nodes: QuestionNode[]) {
      for (const n of nodes) {
        questionTextsSet.add(normalizeTextForMatch(n.text));
        if (n.en_text) {
          questionTextsSet.add(normalizeTextForMatch(n.en_text));
        }
        if (n.children.length > 0) {
          collectQuestionTexts(n.children);
        }
      }
    }
    collectQuestionTexts(treeNodes);
  }

  const headingLines: { text: string; level: number; answer: string }[] = [];
  let currentHeadingIdx = -1;
  
  function isSectionHeader(text: string): boolean {
    const t = text.trim().replace(/^[🌲📚📝✅❌\s\-\[\]]+/, "").toLowerCase();
    return (
      t.includes("问题大纲") ||
      t.includes("关联答卷") ||
      t.includes("目录索引") ||
      t.includes("问题层级") ||
      t.includes("outline") ||
      t.includes("index") ||
      t.includes("table of contents") ||
      t === "dream" ||
      t === "追秘"
    );
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      
      if (isSectionHeader(text)) {
        continue;
      }
      
      // Determine if this heading line is actually a question node or a sub-heading inside an answer
      let isQuestionHeading = false;
      const normalizedHeadingText = normalizeTextForMatch(text);
      
      if (hasMetadataLines) {
        // Look ahead for the next non-empty line (up to 3 lines) to check for metadata markers
        let hasMetadataLookahead = false;
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const l = lines[j].trim();
          if (l.startsWith("> **大纲深度**:") || l.startsWith("> **课题状态**:") || l.includes("大纲深度") || l.includes("课题状态") || l.includes("depth") || l.includes("status")) {
            hasMetadataLookahead = true;
            break;
          }
        }
        
        if (hasMetadataLookahead) {
          isQuestionHeading = true;
        } else if (questionTextsSet.has(normalizedHeadingText)) {
          isQuestionHeading = true;
        }
      } else {
        if (treeNodes.length > 0) {
          if (questionTextsSet.has(normalizedHeadingText)) {
            isQuestionHeading = true;
          }
        } else {
          // Standard plain markdown with no TOC and no metadata: treat all headings as questions
          isQuestionHeading = true;
        }
      }
      
      if (isQuestionHeading) {
        headingLines.push({
          text,
          level,
          answer: ""
        });
        currentHeadingIdx = headingLines.length - 1;
      } else {
        // It's a sub-heading inside an answer, append it as raw text
        if (currentHeadingIdx >= 0) {
          if (headingLines[currentHeadingIdx].answer || line) {
            headingLines[currentHeadingIdx].answer += line + "\n";
          }
        }
      }
    } else {
      const trimLine = line.trim();
      // Skip metadata block lines if we are writing the answer
      if (
        trimLine.startsWith("> **大纲深度**:") || 
        trimLine.startsWith("> **导出印记") || 
        trimLine.startsWith("> **数据统计") ||
        trimLine.startsWith("> **大纲统计") ||
        trimLine.startsWith("> **课题状态**:")
      ) {
        continue;
      }
      // Skip placeholders
      if (
        trimLine.includes("此课题暂无解答内容") || 
        trimLine.includes("尚未调用 AI 生成") || 
        trimLine.includes("no answer content") ||
        trimLine.includes("尚未调用")
      ) {
        continue;
      }
      
      if (currentHeadingIdx >= 0) {
        if (headingLines[currentHeadingIdx].answer || line) {
          headingLines[currentHeadingIdx].answer += line + "\n";
        }
      }
    }
  }
  
  // Trim all answers in headingLines
  headingLines.forEach(h => {
    h.answer = h.answer.trim();
  });
  
  if (treeNodes.length > 0) {
    // Populate answers from headings into treeNodes, matching by Chinese/English/normalized text.
    const answerMap = new Map<string, string>();
    for (const h of headingLines) {
      if (h.answer) {
        answerMap.set(normalizeTextForMatch(h.text), h.answer);
      }
    }
    
    function populateAnswers(nodesList: QuestionNode[]) {
      for (const node of nodesList) {
        const normText = normalizeTextForMatch(node.text);
        const normEnText = node.en_text ? normalizeTextForMatch(node.en_text) : "";
        
        let matchedAnswer = "";
        if (answerMap.has(normText)) {
          matchedAnswer = answerMap.get(normText) || "";
        } else if (normEnText && answerMap.has(normEnText)) {
          matchedAnswer = answerMap.get(normEnText) || "";
        }
        
        if (matchedAnswer) {
          node.answer = matchedAnswer;
        }
        
        if (node.children.length > 0) {
          populateAnswers(node.children);
        }
      }
    }
    
    populateAnswers(treeNodes);
    return treeNodes;
  } else if (headingLines.length > 0) {
    // If no list section was found, build tree directly from heading levels
    const roots: QuestionNode[] = [];
    const stack: { node: QuestionNode; level: number }[] = [];
    
    for (const h of headingLines) {
      const node: QuestionNode = {
        id: "q_import_" + Math.random().toString(36).substring(2, 11),
        text: h.text,
        answer: h.answer,
        isExpanded: true,
        children: [],
        createdAt: Date.now()
      };
      
      while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
        stack.pop();
      }
      
      if (stack.length === 0) {
        roots.push(node);
      } else {
        stack[stack.length - 1].node.children.push(node);
      }
      
      stack.push({ node, level: h.level });
    }
    
    return roots;
  }
  
  return [];
}


function mergeTrees(
  existing: QuestionNode[],
  imported: QuestionNode[],
  strategy: "merge_skip" | "merge_overwrite" | "append_all"
): QuestionNode[] {
  if (strategy === "append_all") {
    return [...existing, ...imported];
  }
  
  const result = [...existing];
  
  for (const imp of imported) {
    const impTextNorm = normalizeTextForMatch(imp.text);
    
    // Find matching sibling in the current level of the tree
    const matchIdx = result.findIndex(n => normalizeTextForMatch(n.text) === impTextNorm);
    
    if (matchIdx !== -1) {
      const matchedNode = result[matchIdx];
      // Perform deduplication merging
      const mergedAnswer = strategy === "merge_overwrite" && imp.answer && imp.answer.trim()
        ? imp.answer
        : (matchedNode.answer || imp.answer);
      
      // Recursively merge sub-trees (children)
      const mergedChildren = mergeTrees(matchedNode.children, imp.children, strategy);
      
      result[matchIdx] = {
        ...matchedNode,
        answer: mergedAnswer,
        children: mergedChildren,
        isExpanded: true
      };
    } else {
      // If no sibling match in current level, append to this level
      result.push(imp);
    }
  }
  
  return result;
}

// --- END OF FILE IMPORT & DEDUPLICATION PARSING UTILITIES ---

// Migrate legacy minimax stale keys to beautiful native gemini models
const migrateLegacyKeys = () => {
  if (typeof window === "undefined") return;
  const currentProvider = localStorage.getItem("llm_provider");
  const currentKey = localStorage.getItem("llm_api_key") || localStorage.getItem("minimax_api_key") || "";
  const isStaleKey = currentKey.startsWith("sk-cp-UmTJEx");
  const hasNoKey = !currentKey || currentKey.trim() === "";
  
  if (isStaleKey || (currentProvider === "minimax" && hasNoKey)) {
    // Reset to client-agnostic server-backed Gemini flash defaults
    localStorage.setItem("llm_provider", "gemini");
    localStorage.setItem("llm_model", "gemini-3.5-flash");
    localStorage.removeItem("llm_api_key");
    localStorage.removeItem("minimax_api_key");
    localStorage.removeItem("llm_base_url");
  }
};
migrateLegacyKeys();

const translations = {
  zh: {
    title: "追秘",
    subtitle: "多级思维树",
    importAsset: "导入",
    downloadAsset: "下载",
    settingsApi: "设置多模型 API",
    searchPlaceholder: "搜索问题名 过滤多级树层...",
    treeTab: "🌲 问题树",
    networkTab: "🧠 脑图",
    addRootInputPlaceholder: "提出一个核心问题（回车或点击右侧新增开始衍生）...",
    addRootBtn: "生成新问题树",
    totalNodes: "核心问题树",
    answeredNodes: "已撰写解答数",
    unansweredNodes: "待生成追问解答",
    noDataTitle: "当前暂时没有提问资产",
    noDataDesc: "请在上方输入框中键入一个研究问题，如「量子计算的未来趋势是什么？」，开启您的多级树状推导演绎！",
    sampleDataBtn: "加载系统内置精选学术问题案例包",
    visibleHeader: "提问层大纲 & 关联追问衍生路线",
    visibleSub: "鼠标悬停到节点上或点击可折叠。您可以在此处随时修改任意疑问文本或追问衍生",
    activeLlmStatus: "多模型 API 已验证成功 (可用中)",
    inactiveLlmStatus: "多模型 API 未配置妥当或待核验 (点击进入配置)",
    exportSettingTitle: "选择导出属性",
    exportBtnText: "制作并下载资产",
    importSettingTitle: "导入并融合问题树",
    importBtnText: "开始导入并融合资产",
    importUploadTitle: "点击或拖拽上传 .md / .json 相关问题树数据包",
    limitReachedTitle: "本地存储空间已满",
    limitReachedMessage: "由于您的疑问解答资产量庞大，浏览器存储容量已达上限。此更改目前仅安全保存在临时内存中，请点击上方「下载你的问题树」进行备份！",
    loadMore: "加载更多提问",
    language: "语言",
    theme: "主题",
    cartoon: "卡通童趣",
    geeker: "极客学术",
    zen: "量浅禅意",
    scientist: "科学实证",
    unifiedSettings: "系统控制台",
    dataOperations: "数据资产包操作",
    apiIndicator: "智能引擎 API",
  },
  en: {
    title: "DeepAsk",
    subtitle: "Multi-level Mind Tree",
    importAsset: "Import",
    downloadAsset: "Download",
    settingsApi: "Configure APIs",
    searchPlaceholder: "Search node title...",
    treeTab: "🌲 Question Tree",
    networkTab: "🧠 Mind Map",
    addRootInputPlaceholder: "Propose a core mother question to start deriving answers...",
    addRootBtn: "Generate",
    totalNodes: "Total Questions",
    answeredNodes: "Answered Nodes",
    unansweredNodes: "Pending Answers",
    noDataTitle: "No QA Assets Available",
    noDataDesc: "Enter a research question above (e.g., 'What are the future trends of quantum computing?') to start your multi-level deductive derivation!",
    sampleDataBtn: "Load Specimen Academic Cases",
    visibleHeader: "Multi-level Deduction & Derived Questions",
    visibleSub: "Hover or click to fold. You can edit any questions or spawn deeper routes anytime",
    activeLlmStatus: "LLM APIs Verified (Active)",
    inactiveLlmStatus: "LLM APIs unconfigured or require check",
    exportSettingTitle: "Export Settings",
    exportBtnText: "Build & Export",
    importSettingTitle: "Import & Merge Digital Assets",
    importBtnText: "Import & Deduplicate",
    importUploadTitle: "Click or drag to drop .md / .json digital assets bundle",
    limitReachedTitle: "Storage Capacity Reached",
    limitReachedMessage: "Because your QA library is extremely large, local storage has reached its capacity. Changes are kept in temporary memory safely. Click 'Export' to back up!",
    loadMore: "Load More Questions",
    language: "Language",
    theme: "Theme",
    cartoon: "Cartoon",
    geeker: "Geeker",
    zen: "Zen Master",
    scientist: "Scientist",
    unifiedSettings: "Control Center",
    dataOperations: "Data Operations",
    apiIndicator: "AI Engine",
  }
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return isMobile;
}

export default function App() {
  const [lang, setLang] = useState<"zh" | "en">(() => {
    return (localStorage.getItem("qa_lang") as "zh" | "en") || "en";
  });

  useEffect(() => {
    localStorage.setItem("qa_lang", lang);
    setAppTitle((prev) => {
      if (prev === translations.zh.title || prev === translations.en.title) {
        return translations[lang].title;
      }
      return prev;
    });
    setAppSubtitle((prev) => {
      if (prev === translations.zh.subtitle || prev === translations.en.subtitle || prev === "结构化思维树") {
        return translations[lang].subtitle;
      }
      return prev;
    });
  }, [lang]);
  const [theme, setTheme] = useState<"cartoon" | "geeker" | "zen" | "scientist">(() => {
    const saved = localStorage.getItem("qa_theme") as any;
    if (saved === "light" || saved === "cartoon") return "cartoon";
    if (saved === "night" || saved === "geeker") return "geeker";
    if (saved === "scientist") return "scientist";
    return "zen";
  });

  useEffect(() => {
    localStorage.setItem("qa_theme", theme);
  }, [theme]);

  const t = (key: keyof typeof translations.zh) => {
    return translations[lang][key] || translations.zh[key] || "";
  };

  const isMobile = useIsMobile();

  const [questions, setQuestions] = useState<QuestionNode[]>(() => {
    const currentLang = (localStorage.getItem("qa_lang") as "zh" | "en") || "en";
    const savedData = localStorage.getItem("qa_tree_data");
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const isChineseSample = parsed[0]?.id === "q_root_1" && parsed[0]?.text?.includes("人工智能");
          const isEnglishSample = parsed[0]?.id === "q_root_1" && parsed[0]?.text?.includes("Artificial Intelligence");
          if ((isChineseSample && currentLang === "en") || (isEnglishSample && currentLang === "zh")) {
            const freshSamples = createSampleQuestions(currentLang);
            try {
              localStorage.setItem("qa_tree_data", JSON.stringify(freshSamples));
            } catch (e) {
              console.warn("Storage quota warning:", e);
            }
            return freshSamples;
          }
          return parsed;
        }
      } catch (err) {
        console.error("Failed to parse saved tree data:", err);
      }
    }
    const freshSamples = createSampleQuestions(currentLang);
    try {
      localStorage.setItem("qa_tree_data", JSON.stringify(freshSamples));
    } catch (e) {
      console.warn("Storage quota warning:", e);
    }
    return freshSamples;
  });
  const [activeTab, setActiveTab] = useState<"tree" | "network">("tree");
  const [logoMode, setLogoMode] = useState<"default" | "cartoon" | "custom">("default");
  const [customLogoUrl, setCustomLogoUrl] = useState<string | null>(null);
  const [appTitle, setAppTitle] = useState(() => t("title"));
  const [appSubtitle, setAppSubtitle] = useState(() => t("subtitle"));
  const [isPaneSwapped, setIsPaneSwapped] = useState(false);
  const [isNetworkPaneSwapped, setIsNetworkPaneSwapped] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => {
    try {
      const savedId = localStorage.getItem("qa_selected_node_id");
      if (savedId) return savedId;

      // If no saved selection, default to the first node of the saved tree (or sample tree)
      const savedData = localStorage.getItem("qa_tree_data");
      if (savedData) {
        const parsed = JSON.parse(savedData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed[0].id;
        }
      }

      const samples = createSampleQuestions((localStorage.getItem("qa_lang") as "zh" | "en") || "en");
      if (samples.length > 0) {
        return samples[0].id;
      }
    } catch {
      // Ignore error
    }
    return null;
  });

  useEffect(() => {
    try {
      if (selectedNodeId) {
        localStorage.setItem("qa_selected_node_id", selectedNodeId);
      } else {
        localStorage.removeItem("qa_selected_node_id");
      }
    } catch (e) {
      // Ignore quota issues
    }
  }, [selectedNodeId]);

  // Expand all expanded ancestors of the newly selected node to guarantee perfect visibility in the sidebar
  useEffect(() => {
    if (selectedNodeId) {
      saveTree((prev) => {
        const { nodes, found } = expandAncestorsInTree(prev, selectedNodeId);
        return found ? nodes : prev;
      });
    }
  }, [selectedNodeId]);

  const [searchTerm, setSearchTerm] = useState("");
  const [isMobileSearchExpanded, setIsMobileSearchExpanded] = useState(false);
  const [visibleRootCount, setVisibleRootCount] = useState(5);

  // Reset pagination counters whenever search query changes
  useEffect(() => {
    setVisibleRootCount(5);
  }, [searchTerm]);

  // Sync unmodified sample questions language with the selected display language
  useEffect(() => {
    setQuestions((prev) => {
      if (prev && prev.length > 0 && prev[0].id === "q_root_1") {
        const isChineseSample = prev[0].text?.includes("人工智能");
        const isEnglishSample = prev[0].text?.includes("Artificial Intelligence");
        if ((isChineseSample && lang === "en") || (isEnglishSample && lang === "zh")) {
          const freshSamples = createSampleQuestions(lang);
          try {
            localStorage.setItem("qa_tree_data", JSON.stringify(freshSamples));
          } catch (e) {
            console.warn("Storage warning during language sync:", e);
          }
          return freshSamples;
        }
      }
      return prev;
    });
  }, [lang]);

  const [addingChildToId, setAddingChildToId] = useState<string | null>(null);
  const [isAddingRoot, setIsAddingRoot] = useState(false);
  const [newRootText, setNewRootText] = useState("");
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);

  // Parallel background AI status tasks
  const [backgroundTasks, setBackgroundTasks] = useState<Record<string, {
    nodeId: string;
    nodeText: string;
    percent: number;
    stage: number;
    elapsedSeconds: number;
    isFinished: boolean;
    status: "idle" | "running" | "completed" | "failed";
    error?: string;
  }>>({});

  // Sliding Toast alerts bottom right corner
  const [toasts, setToasts] = useState<Array<{
    id: string;
    nodeId: string;
    nodeText: string;
    status: "completed" | "failed";
    message: string;
    timestamp: number;
  }>>([]);
  
  // Multimodal LLM provider and credentials states
  const [llmProvider, setLlmProvider] = useState(() => localStorage.getItem("llm_provider") || "gemini");
  const [llmApiKey, setLlmApiKey] = useState(() => localStorage.getItem("llm_api_key") || localStorage.getItem("minimax_api_key") || "");
  const [llmBaseUrl, setLlmBaseUrl] = useState(() => localStorage.getItem("llm_base_url") || "");
  const [llmModel, setLlmModel] = useState(() => localStorage.getItem("llm_model") || "gemini-3.5-flash");

/* Removed answerLanguage states */

  // Settings Modal form temporaries
  const [tempProvider, setTempProvider] = useState("gemini");
  const [tempApiKey, setTempApiKey] = useState("");
  const [tempBaseUrl, setTempBaseUrl] = useState("");
  const [tempModel, setTempModel] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);

  // Download "Your Property" settings and states
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [downloadMode, setDownloadMode] = useState<"only_questions" | "questions_and_answers">("only_questions");
  const [downloadSelectionMode, setDownloadSelectionMode] = useState<"all" | "custom">("all");
  const [selectedNodeIdsForExport, setSelectedNodeIdsForExport] = useState<Record<string, boolean>>({});
  const [includeThink, setIncludeThink] = useState(true);

  // Import "Your Property" settings and states
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importStrategy, setImportStrategy] = useState<"merge_skip" | "merge_overwrite" | "append_all">("merge_skip");
  const [parsedNodes, setParsedNodes] = useState<QuestionNode[]>([]);
  const [importError, setImportError] = useState("");

  // Custom Confirmation Modals to replace standard window.confirm in iframes
  const [deleteConfirmInfo, setDeleteConfirmInfo] = useState<{
    isOpen: boolean;
    nodeId: string;
    nodeText: string;
    hasChildren: boolean;
  }>({
    isOpen: false,
    nodeId: "",
    nodeText: "",
    hasChildren: false,
  });
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);



  const parsedStats = useMemo(() => {
    let count = 0;
    function traverse(nodes: QuestionNode[]) {
      nodes.forEach(n => {
        count++;
        if (n.children.length > 0) traverse(n.children);
      });
    }
    traverse(parsedNodes);
    return count;
  }, [parsedNodes]);

  // Keep selection valid: only auto-select fallback if the CURRENTLY selected node is deleted/missing
  useEffect(() => {
    if (questions.length > 0 && selectedNodeId) {
      if (!findNodeById(questions, selectedNodeId)) {
        setSelectedNodeId(questions[0].id);
      }
    }
  }, [questions, selectedNodeId]);



  // Helper to select the first node by default for high visual engagement
  const setInitialSelection = (list: QuestionNode[]) => {
    const savedId = localStorage.getItem("qa_selected_node_id");
    if (savedId && findNodeById(list, savedId)) {
      setSelectedNodeId(savedId);
    } else if (list.length > 0) {
      setSelectedNodeId(list[0].id);
    }
  };

  // 2. Persist state changes in background (handles functional state updaters to prevent race conditions)
  const saveTree = (updater: QuestionNode[] | ((prev: QuestionNode[]) => QuestionNode[])) => {
    setQuestions((prev) => {
      const updatedTree = typeof updater === "function" ? updater(prev) : updater;
      try {
        localStorage.setItem("qa_tree_data", JSON.stringify(updatedTree));
      } catch (e: any) {
        console.warn("localStorage quota exceeded:", e);
        addToast(
          "quota_error",
          t("limitReachedTitle"),
          "failed",
          t("limitReachedMessage")
        );
      }
      return updatedTree;
    });
  };

  useEffect(() => {
    if (questions.length > 0) {
      const isChineseSample = questions[0]?.id === "q_root_1" && questions[0]?.text?.includes("人工智能");
      const isEnglishSample = questions[0]?.id === "q_root_1" && questions[0]?.text?.includes("Artificial Intelligence");
      if (isChineseSample && lang === "en") {
        saveTree(createSampleQuestions("en"));
      } else if (isEnglishSample && lang === "zh") {
        saveTree(createSampleQuestions("zh"));
      }
    }
  }, [lang]);

  // 3. Check AI Provider and Keys status on changes
  const checkAiStatus = (provider: string, apiKey: string, baseUrl: string, model: string, notify = false) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-llm-provider": provider,
      "x-llm-api-key": apiKey,
      "x-llm-base-url": baseUrl,
      "x-llm-model": model
    };
    fetch("/api/ai-status", { headers })
      .then((res) => res.json())
      .then((data) => {
        setAiAvailable(data.available);
        if (notify) {
          if (data.available) {
            addToast("settings_status", lang === "zh" ? `服务商: ${provider.toUpperCase()}` : `Provider: ${provider.toUpperCase()}`, "completed", lang === "zh" ? "多模型 API 配置验证成功！主界面设置图标已转为绿色。" : "Multi-model API configuration verified successfully! Setting icon turned green.");
          } else {
            addToast("settings_status", lang === "zh" ? `服务商: ${provider.toUpperCase()}` : `Provider: ${provider.toUpperCase()}`, "failed", lang === "zh" ? "服务配置检测失败。请检查 API Key 密钥是否正确，或检查代理地址与模型是否相符！" : "Service configuration check failed. Please check if your API Key is correct, or if the proxy address matches the model!");
          }
        }
      })
      .catch((err) => {
        console.warn("AI configurations unreachable:", err);
        setAiAvailable(false);
        if (notify) {
          addToast("settings_status", lang === "zh" ? `服务商: ${provider.toUpperCase()}` : `Provider: ${provider.toUpperCase()}`, "failed", lang === "zh" ? `网络或接口访问失败: ${err.message || "未知错误"}` : `Network or interface access failed: ${err.message || "Unknown error"}`);
        }
      });
  };

  useEffect(() => {
    checkAiStatus(llmProvider, llmApiKey, llmBaseUrl, llmModel);
  }, [llmProvider, llmApiKey, llmBaseUrl, llmModel]);

  const handleOpenSettings = () => {
    setTempProvider(llmProvider);
    setTempApiKey(llmApiKey);
    setTempBaseUrl(llmBaseUrl);
    setTempModel(llmModel);
    setIsSettingsOpen(true);
  };

  const handleSaveLlmSettings = () => {
    const nextProvider = tempProvider;
    const nextApiKey = tempApiKey.trim();
    const nextBaseUrl = tempBaseUrl.trim();
    const nextModel = tempModel.trim();

    localStorage.setItem("llm_provider", nextProvider);
    localStorage.setItem("llm_api_key", nextApiKey);
    localStorage.setItem("llm_base_url", nextBaseUrl);
    localStorage.setItem("llm_model", nextModel);
    
    // Also save as fallback to remain compatible
    localStorage.setItem("minimax_api_key", nextApiKey);

    setLlmProvider(nextProvider);
    setLlmApiKey(nextApiKey);
    setLlmBaseUrl(nextBaseUrl);
    setLlmModel(nextModel);
    
    setIsSettingsOpen(false);

    // Call check with notify = true for beautiful feedback
    checkAiStatus(nextProvider, nextApiKey, nextBaseUrl, nextModel, true);
  };

  // --- Tree Event Dispatchers ---

  // Add sub-question under parentId with optional selected text hyperlink support
  const handleAddChildNode = (parentId: string, text: string, selectedText?: string, enText?: string, autoSelect = true) => {
    const newId = generateId();
    const newNode: QuestionNode = {
      id: newId,
      text,
      en_text: enText || (lang === "en" ? text : undefined),
      answer: "",
      isExpanded: true,
      children: [],
      createdAt: Date.now(),
    };
    
    saveTree((prev) => {
      let updated = addNodeToTree(prev, parentId, newNode);

      // If there is selected text, create a hyperlink from the parent node's answer to this new child node
      if (selectedText && selectedText.trim().length > 0) {
        const markdownLink = `[${selectedText}](#node-${newId})`;
        const parentNode = findNodeById(updated, parentId);
        if (parentNode && parentNode.answer) {
          const newAnswer = replaceTextWithMarkdownLink(parentNode.answer, selectedText, markdownLink);
          updated = updateNodeInTree(updated, parentId, { answer: newAnswer });
        }
      }
      return updated;
    });
    
    // Auto-select the newly added child for prompt editing
    if (autoSelect) {
      setSelectedNodeId(newId);
    }
    
    // Auto-trigger AI answer
    triggerAIAnswer(newId, newNode);
  };

  // Add a first-level mother question
  const handleAddRootSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRootText.trim()) return;

    const newRoot: QuestionNode = {
      id: generateId(),
      text: newRootText.trim(),
      en_text: lang === "en" ? newRootText.trim() : undefined,
      answer: "",
      isExpanded: true,
      children: [],
      createdAt: Date.now(),
    };

    saveTree((prev) => [...prev, newRoot]);
    setSelectedNodeId(newRoot.id);
    setNewRootText("");
    setIsAddingRoot(false);
    triggerAIAnswer(newRoot.id, newRoot, []);
  };

  // Add direct root question from onboarding/launchpad
  const handleAddRootDirect = (text: string) => {
    const newRoot: QuestionNode = {
      id: generateId(),
      text: text.trim(),
      answer: "",
      isExpanded: true,
      children: [],
      createdAt: Date.now(),
    };
    saveTree((prev) => [...prev, newRoot]);
    setSelectedNodeId(newRoot.id);
    triggerAIAnswer(newRoot.id, newRoot, []);
  };

  // Toggle node expansion
  const handleToggleExpand = (id: string, isExpanded: boolean) => {
    saveTree((prev) => updateNodeInTree(prev, id, { isExpanded }));
  };

  // Edit node question title text
  const handleEditNodeTitle = (id: string, newText: string) => {
    saveTree((prev) => 
      updateNodeInTree(prev, id, lang === "en" ? { text: newText, en_text: newText } : { text: newText })
    );
  };

  // Delete node and trigger confirmation dialog
  const handleDeleteNode = (id: string) => {
    let targetNode: QuestionNode | null = null;
    function findNode(nodes: QuestionNode[]) {
      for (const n of nodes) {
        if (n.id === id) {
          targetNode = n;
          return;
        }
        if (n.children && n.children.length > 0) {
          findNode(n.children);
        }
      }
    }
    findNode(questions);

    if (targetNode) {
      const nodeObj = targetNode as QuestionNode;
      setDeleteConfirmInfo({
        isOpen: true,
        nodeId: id,
        nodeText: nodeObj.text,
        hasChildren: nodeObj.children && nodeObj.children.length > 0
      });
    }
  };

  // 1) Option: Delete current node entirely (including recursive children)
  const executeDeleteRecursive = () => {
    const id = deleteConfirmInfo.nodeId;
    saveTree((prev) => {
      const deletedIds = findNodeAndGetSubtreeIds(prev, id);
      const updated = deleteNodeFromTree(prev, id);
      const cleaned = cleanMarkdownLinksForDeletedIds(updated, deletedIds);
      if (selectedNodeId === id || deletedIds.includes(selectedNodeId)) {
        setTimeout(() => setInitialSelection(cleaned), 0);
      }
      return cleaned;
    });
    setDeleteConfirmInfo({ isOpen: false, nodeId: "", nodeText: "", hasChildren: false });
  };

  // 2) Option: Delete only the current node, promoting its children up 1 level
  const executeDeleteAndPromote = () => {
    const id = deleteConfirmInfo.nodeId;
    saveTree((prev) => {
      const deletedIds = [id];
      const updated = deleteNodeAndPromoteInTree(prev, id);
      const cleaned = cleanMarkdownLinksForDeletedIds(updated, deletedIds);
      if (selectedNodeId === id) {
        setTimeout(() => setInitialSelection(cleaned), 0);
      }
      return cleaned;
    });
    setDeleteConfirmInfo({ isOpen: false, nodeId: "", nodeText: "", hasChildren: false });
  };

  // Update answer text (called instantly on typing/auto-save from pane)
  const handleUpdateAnswer = (id: string, newAnswer: string) => {
    saveTree((prev) => updateNodeInTree(prev, id, { 
      answer: newAnswer
    }));
  };

  // Add slide-in toast alerts
  const addToast = (nodeId: string, nodeText: string, status: "completed" | "failed", message: string) => {
    const id = "toast_" + Math.random().toString(36).substring(2, 9);
    setToasts(prev => [
      ...prev,
      {
        id,
        nodeId,
        nodeText,
        status,
        message,
        timestamp: Date.now()
      }
    ]);

    // Fast-fade removal of toast after 6 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 6000);
  };

  // Trigger parallel background AI Answer generation
  const triggerAIAnswer = async (nodeId: string, overrideTargetNode?: QuestionNode, overridePath?: string[]) => {
    // If it's already generating, do not trigger again
    if (backgroundTasks[nodeId]?.status === "running") return;

    const targetNode = overrideTargetNode || findNodeById(questions, nodeId);
    if (!targetNode) return;

    const path = overridePath || findNodePath(questions, nodeId) || [];

    // Initialize/reset task progress
    setBackgroundTasks(prev => ({
      ...prev,
      [nodeId]: {
        nodeId,
        nodeText: targetNode.text,
        percent: 8,
        stage: 1,
        elapsedSeconds: 0,
        isFinished: false,
        status: "running"
      }
    }));

    const startTime = Date.now();

    // Spawn intervals for progress reporting
    const elapsedInterval = setInterval(() => {
      setBackgroundTasks(prev => {
        const task = prev[nodeId];
        if (!task || task.isFinished || task.status !== "running") {
          clearInterval(elapsedInterval);
          return prev;
        }
        const diff = (Date.now() - startTime) / 1000;
        return {
          ...prev,
          [nodeId]: {
            ...task,
            elapsedSeconds: Number(diff.toFixed(1))
          }
        };
      });
    }, 100);

    const progressInterval = setInterval(() => {
      setBackgroundTasks(prev => {
        const task = prev[nodeId];
        if (!task || task.isFinished || task.status !== "running") {
          clearInterval(progressInterval);
          return prev;
        }

        let nextPercent = task.percent;
        if (nextPercent < 92) {
          if (nextPercent < 30) {
            nextPercent += Math.floor(Math.random() * 5) + 3;
          } else if (nextPercent < 60) {
            nextPercent += Math.floor(Math.random() * 4) + 2;
          } else if (nextPercent < 80) {
            nextPercent += Math.floor(Math.random() * 2) + 1;
          } else {
            const remaining = 92 - nextPercent;
            const increment = remaining * 0.15;
            nextPercent += Math.max(0.05, increment);
          }
          if (nextPercent > 91.8) nextPercent = 91.8;
          nextPercent = Math.round(nextPercent * 10) / 10;
        }

        let currentStage = 1;
        if (nextPercent >= 92) {
          currentStage = 5;
        } else if (nextPercent >= 65) {
          currentStage = 4;
        } else if (nextPercent >= 40) {
          currentStage = 3;
        } else if (nextPercent >= 15) {
          currentStage = 2;
        }

        return {
          ...prev,
          [nodeId]: {
            ...task,
            percent: nextPercent,
            stage: currentStage
          }
        };
      });
    }, 300);

    try {
      const provider = localStorage.getItem("llm_provider") || "gemini";
      const apiKey = localStorage.getItem("llm_api_key") || localStorage.getItem("minimax_api_key") || "";
      const baseUrl = localStorage.getItem("llm_base_url") || "";
      const model = localStorage.getItem("llm_model") || "";

      const headers: Record<string, string> = { 
        "Content-Type": "application/json",
        "x-llm-provider": provider
      };
      if (apiKey.trim()) headers["x-llm-api-key"] = apiKey.trim();
      if (baseUrl.trim()) headers["x-llm-base-url"] = baseUrl.trim();
      if (model.trim()) headers["x-llm-model"] = model.trim();

      const response = await fetch("/api/gemini/answer", {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: targetNode.text,
          context: path,
          lang: lang,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text() || "AI 接口请求失败");
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      const modelAnswer = data.text || "";

      // Write results to main questions tree
      handleUpdateAnswer(nodeId, modelAnswer);

      // Fast-forward progress indicator to 100% and Stage 5
      setBackgroundTasks(prev => {
        const task = prev[nodeId];
        if (!task) return prev;
        return {
          ...prev,
          [nodeId]: {
            ...task,
            isFinished: true,
            percent: 100,
            stage: 5,
          }
        };
      });

      // Hold for 450ms for satisfying completion details rendering
      await new Promise(resolve => setTimeout(resolve, 450));

      // Stage 6 (marks complete with checkmark in progress view)
      setBackgroundTasks(prev => {
        const task = prev[nodeId];
        if (!task) return prev;
        return {
          ...prev,
          [nodeId]: {
            ...task,
            stage: 6
          }
        };
      });

      // Hold for another 450ms
      await new Promise(resolve => setTimeout(resolve, 450));

      // Finally, set status to completed
      setBackgroundTasks(prev => {
        const task = prev[nodeId];
        if (!task) return prev;
        return {
          ...prev,
          [nodeId]: {
            ...task,
            status: "completed"
          }
        };
      });

      // Show toast
      addToast(nodeId, targetNode.text, "completed", lang === "zh" ? "解答已生成并注入此节点！" : "Answer generated and injected into this node!");

    } catch (err: any) {
      console.error(err);
      const activeProvider = (localStorage.getItem("llm_provider") || "gemini").toUpperCase();
      const errMsg = err.message || (lang === "zh" ? `未能调用 AI 自动解答，请确保配置了符合规范的 ${activeProvider}_API_KEY。` : `Failed to call AI auto answer, please ensure valid ${activeProvider}_API_KEY is configured.`);

      setBackgroundTasks(prev => {
        const task = prev[nodeId];
        if (!task) return prev;
        return {
          ...prev,
          [nodeId]: {
            ...task,
            isFinished: true,
            status: "failed",
            error: errMsg
          }
        };
      });

      addToast(nodeId, targetNode.text, "failed", errMsg);
    }
  };

  // Reset/Clear Tree to samples (custom overlay-safe trigger)
  const handleResetToSamples = () => {
    setResetConfirmOpen(true);
  };

  const executeResetToSamples = () => {
    const samples = createSampleQuestions(lang);
    saveTree(samples);
    setInitialSelection(samples);
    setSearchTerm("");
    setResetConfirmOpen(false);
  };

  // Create highly compliant canvas wipe helper
  const handleClearAll = () => {
    setClearConfirmOpen(true);
  };

  const executeClearAll = () => {
    saveTree([]);
    setSelectedNodeId(null);
    setSearchTerm("");
    setClearConfirmOpen(false);
  };

  // Open Import Modal and reset state
  const handleOpenImportModal = () => {
    setImportText("");
    setImportStrategy("merge_skip");
    setParsedNodes([]);
    setImportError("");
    setIsImportOpen(true);
  };

  // Perform parsing on raw pasted/typed text
  const handleImportTextChange = (text: string) => {
    setImportText(text);
    if (!text.trim()) {
      setParsedNodes([]);
      setImportError("");
      return;
    }
    
    // Attempt parsing as JSON first, then fallback to Markdown
    let nodes = parseJSONToTree(text);
    if (nodes && nodes.length > 0) {
      setParsedNodes(nodes);
      setImportError("");
    } else {
      const mdNodes = parseMarkdownToTree(text);
      if (mdNodes && mdNodes.length > 0) {
        setParsedNodes(mdNodes);
        setImportError("");
      } else {
        setParsedNodes([]);
        setImportError("未能识别有效的问答 JSON 或 Markdown 层级结构 (需带有 - 列表或 ### 标题)。");
      }
    }
  };

  // Handle uploaded file content
  const handleImportFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content) return;

      setImportText(content);
      
      // Let's determine parsing from filename extension
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'json') {
        const nodes = parseJSONToTree(content);
        if (nodes && nodes.length > 0) {
          setParsedNodes(nodes);
          setImportError("");
        } else {
          setParsedNodes([]);
          setImportError("该 JSON 文件格式有误，或不匹配提问树格式。");
        }
      } else {
        // Default to Markdown parsing (includes .md or general files)
        const nodes = parseMarkdownToTree(content);
        if (nodes && nodes.length > 0) {
          setParsedNodes(nodes);
          setImportError("");
        } else {
          setParsedNodes([]);
          setImportError("在该 Markdown 文件中未能读取到有效结构化大纲节点。");
        }
      }
    };
    reader.onerror = () => {
      setImportError("读取文件失败！");
    };
    reader.readAsText(file);
  };

  // Execute actual importing and merge
  const handleExecuteImport = () => {
    if (parsedNodes.length === 0) {
      alert("请提供有效的文本内容或文件进行解析！");
      return;
    }

    saveTree((prev) => {
      const merged = mergeTrees(prev, parsedNodes, importStrategy);
      // Auto-select first node of the merged tree if nothing is selected or if we imported onto empty tree
      if (merged.length > 0) {
        setTimeout(() => setInitialSelection(merged), 0);
      }
      return merged;
    });
    
    setIsImportOpen(false);
    alert(lang === "zh" 
      ? `关联问题树包导入融合成功！共导入了 ${parsedStats} 个课题大纲节点并进行了智能去重。` 
      : `Digital assets imported & merged successfully! A total of ${parsedStats} nodes were integrated with smart deduplication.`);
  };

  // Download "Your Property" settings: open dialog and pre-select all nodes
  const handleOpenDownloadModal = () => {
    if (questions.length === 0) {
      alert("当前没有任何提问大纲可以导出，请先创建或填入大纲。");
      return;
    }
    
    // Initialize node ID map to true by default
    const preselected: Record<string, boolean> = {};
    function recurse(node: QuestionNode) {
      preselected[node.id] = true;
      node.children.forEach(recurse);
    }
    questions.forEach(recurse);
    
    setSelectedNodeIdsForExport(preselected);
    setIsDownloadOpen(true);
  };

  const handleToggleNodeAndDescendants = (node: QuestionNode, checked: boolean) => {
    setSelectedNodeIdsForExport(prev => {
      const copy = { ...prev };
      function recurse(n: QuestionNode) {
        copy[n.id] = checked;
        n.children.forEach(recurse);
      }
      recurse(node);
      return copy;
    });
  };

  const handleSelectAllForExport = (checked: boolean) => {
    setSelectedNodeIdsForExport(() => {
      const copy: Record<string, boolean> = {};
      function recurse(n: QuestionNode) {
        copy[n.id] = checked;
        n.children.forEach(recurse);
      }
      questions.forEach(recurse);
      return copy;
    });
  };

  const renderSelectionNode = (node: QuestionNode, depth = 0): React.ReactNode => {
    const isChecked = !!selectedNodeIdsForExport[node.id];
    const displayText = lang === "en" && node.en_text ? node.en_text : node.text;
    return (
      <div key={node.id} className="space-y-0.5">
        <label 
          className="flex items-center gap-2.5 hover:bg-slate-100 p-1.5 px-2 rounded cursor-pointer transition text-xs text-slate-700 select-none"
          style={{ paddingLeft: `${depth * 18 + 8}px` }}
        >
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => handleToggleNodeAndDescendants(node, e.target.checked)}
            className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 rounded border-slate-300 cursor-pointer"
          />
          <span className="font-semibold text-slate-800">
            {displayText}
          </span>
          {node.children.length > 0 && (
            <span className="text-[9px] text-indigo-500 font-bold bg-indigo-50/80 px-1 py-0.5 rounded font-mono">
              {node.children.length}衍生
            </span>
          )}
        </label>
        {node.children.length > 0 && node.children.map(child => renderSelectionNode(child, depth + 1))}
      </div>
    );
  };

  // Process download with chosen config
  const handleExecuteDownload = () => {
    const activeSelectedNodesCount = downloadSelectionMode === 'all' 
      ? stats.total 
      : Object.values(selectedNodeIdsForExport).filter(Boolean).length;

    if (downloadSelectionMode === 'custom' && activeSelectedNodesCount === 0) {
      alert("请至少勾选一个节点进行导出！");
      return;
    }

    let md = "";
    const stamp = new Date().toLocaleString("zh-CN", { hour12: false });
    
    if (downloadMode === "only_questions") {
      md += `# ${lang === "en" ? "Dream" : "追秘"} 问题大纲结构化层级索引\n\n`;
      md += `> **导出印记**: ${stamp}\n`;
      md += `> **大纲统计**: 提问课题总量 **${stats.total}**，当前导出 **${activeSelectedNodesCount}** 层级结构\n\n`;
      md += `## 🌲 问题层级大纲树\n\n`;
      
      function generateHierarchy(nodes: QuestionNode[], depth = 0): string {
        let outline = "";
        nodes.forEach(node => {
          const isSelected = downloadSelectionMode === 'all' || !!selectedNodeIdsForExport[node.id];
          const displayText = lang === "en" && node.en_text ? node.en_text : node.text;
          if (isSelected) {
            const indent = "  ".repeat(depth);
            outline += `${indent}- ${displayText}\n`;
            if (node.children && node.children.length > 0) {
              outline += generateHierarchy(node.children, depth + 1);
            }
          } else {
            if (node.children && node.children.length > 0) {
              outline += generateHierarchy(node.children, depth);
            }
          }
        });
        return outline;
      }
      md += generateHierarchy(questions, 0);
    } else {
      md += `# ${lang === "en" ? "Dream" : "追秘"} 结构化关联答卷导出\n\n`;
      md += `> **导出印记**: ${stamp}\n`;
      md += `> **数据统计**: 提问课题总量 **${stats.total}**，当前导出 **${activeSelectedNodesCount}** 个关联答卷课题\n\n`;
      md += `\n---\n\n`;
      md += `## 🌲 已导出的问题目录索引\n\n`;

      function generateTOC(nodes: QuestionNode[], depth = 0): string {
        let result = "";
        nodes.forEach(node => {
          const isSelected = downloadSelectionMode === 'all' || !!selectedNodeIdsForExport[node.id];
          const displayText = lang === "en" && node.en_text ? node.en_text : node.text;
          if (isSelected) {
            const indent = "  ".repeat(depth);
            const hasAns = node.answer && node.answer.trim() ? "✅" : "📝";
            result += `${indent}- [${hasAns}] ${displayText}\n`;
            if (node.children && node.children.length > 0) {
              result += generateTOC(node.children, depth + 1);
            }
          } else {
            if (node.children && node.children.length > 0) {
              result += generateTOC(node.children, depth);
            }
          }
        });
        return result;
      }
      md += generateTOC(questions, 0);
      md += "\n\n---\n\n";
      md += `## 📚 大纲详情与关联答卷\n\n`;

      function generateContent(nodes: QuestionNode[], depth = 0): string {
        let result = "";
        nodes.forEach(node => {
          const isSelected = downloadSelectionMode === 'all' || !!selectedNodeIdsForExport[node.id];
          const displayText = lang === "en" && node.en_text ? node.en_text : node.text;
          if (isSelected) {
            const hashes = "#".repeat(Math.min(depth + 3, 6));
            result += `${hashes} ${displayText}\n\n`;
            
            const statusLabel = node.answer && node.answer.trim() ? "🟢 已完成智能解答" : "⚪ 待补充解答";
            result += `> **大纲深度**: Level ${depth} | **课题状态**: ${statusLabel}\n\n`;
            
            if (node.answer && node.answer.trim()) {
              let finalAns = node.answer.trim();
              if (!includeThink) {
                const parsed = parseThinkAndContent(finalAns);
                finalAns = parsed.content.trim();
              }
              result += `${finalAns}\n\n`;
            } else {
              result += `*（此课题暂无解答内容或尚未调用 AI 生成）*\n\n`;
            }
            result += `\n`;
            
            if (node.children && node.children.length > 0) {
              result += generateContent(node.children, depth + 1);
            }
          } else {
            if (node.children && node.children.length > 0) {
              result += generateContent(node.children, depth);
            }
          }
        });
        return result;
      }
      md += generateContent(questions, 0);
    }

    try {
      const dateString = new Date().toISOString().slice(0, 10);
      const prefix = lang === "en" ? "Dream" : "追秘";
      const filename = downloadMode === "only_questions" 
        ? `${prefix}_问题大纲_${dateString}.md`
        : `${prefix}_关联答卷集_${dateString}.md`;

      const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setIsDownloadOpen(false);
    } catch (error) {
      console.error("Export failed:", error);
      alert(lang === "zh" 
        ? "制作并导出问题树失败，请重试。" 
        : "Failed to generate and export digital assets, please try again.");
    }
  };

  // --- Computed Selector Memoizations ---

  // 1. Recursive Search Filter
  const filteredQuestionsTree = useMemo(() => {
    if (!searchTerm.trim()) return [...questions].reverse();
    
    const lowerQuery = searchTerm.toLowerCase();
    
    function filterNodes(nodes: QuestionNode[]): QuestionNode[] {
      return nodes
        .map((node) => {
          const filteredChildren = filterNodes(node.children);
          const matchesSelf = 
            node.text.toLowerCase().includes(lowerQuery) || 
            (node.en_text && node.en_text.toLowerCase().includes(lowerQuery));
          
          if (matchesSelf || filteredChildren.length > 0) {
            return {
              ...node,
              isExpanded: true, // Always unfold matching search paths
              children: filteredChildren,
            };
          }
          return null;
        })
        .filter((node): node is QuestionNode => node !== null);
    }

    return filterNodes([...questions].reverse());
  }, [questions, searchTerm]);

  // 2. Identify selected node details from deep nested tree
  const selectedNodeObj = useMemo(() => {
    if (!selectedNodeId) return null;

    let found: QuestionNode | null = null;
    function traverse(nodes: QuestionNode[]) {
      for (const n of nodes) {
        if (n.id === selectedNodeId) {
          found = n;
          return;
        }
        if (n.children.length > 0) {
          traverse(n.children);
        }
      }
    }
    traverse(questions);
    return found;
  }, [questions, selectedNodeId]);

  // 3. Compute breadcrumbs route path from system roots to selected node
  const selectedNodePathContextList = useMemo(() => {
    if (!selectedNodeId) return null;
    return findNodePath(questions, selectedNodeId, [], lang);
  }, [questions, selectedNodeId, lang]);

  // 4. Compute Q&A Metrics
  const stats = useMemo(() => {
    return getTreeStats(questions);
  }, [questions]);

  const renderTreeSidebarBody = () => (
    <>
      <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200/50">
          <button
            onClick={() => setActiveTab("tree")}
            className={`px-2.5 py-1 rounded-md text-[10.5px] font-bold transition-all duration-200 flex items-center gap-1 cursor-pointer ${
              activeTab === "tree" 
                ? "bg-white text-indigo-600 shadow-xs" 
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <span>{t("treeTab")}</span>
          </button>
          <button
            onClick={() => setActiveTab("network")}
            className={`px-2.5 py-1 rounded-md text-[10.5px] font-bold transition-all duration-200 flex items-center gap-1 cursor-pointer ${
              activeTab === "network" 
                ? "bg-white text-indigo-600 shadow-xs" 
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <span>{t("networkTab")}</span>
          </button>
        </div>
        <button
          onClick={() => setIsAddingRoot(true)}
          className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-bold shadow-2xs transition-all hover:scale-102 flex items-center gap-1 cursor-pointer animate-pulse"
          title={lang === "zh" ? "开启核心课题 / 开启母提问" : "Start Core Question"}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{lang === "zh" ? "开启新问题" : "New Topic"}</span>
        </button>
      </div>

      {isAddingRoot && (
        <div className="px-4 py-3 bg-indigo-50/30 border-b border-indigo-100/60 shrink-0">
          <form onSubmit={handleAddRootSubmit} className="space-y-2">
            <input
              type="text"
              autoFocus
              placeholder={lang === "zh" ? "键入一个核心问题..." : "Enter a core question..."}
              value={newRootText}
              onChange={(e) => setNewRootText(e.target.value)}
              className="w-full text-xs px-3 py-2 bg-white rounded-md border border-slate-200 focus:outline-none focus:border-indigo-500 text-slate-900"
            />
            <div className="flex items-center justify-end gap-2 text-[11px]">
              <button
                type="submit"
                disabled={!newRootText.trim()}
                className="px-2.5 py-1.5 bg-indigo-600 disabled:opacity-50 text-white rounded-md font-bold"
              >
                {lang === "zh" ? "创建" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddingRoot(false);
                  setNewRootText("");
                }}
                className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-md hover:bg-slate-50 font-medium"
              >
                {lang === "zh" ? "取消" : "Cancel"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div 
        className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar bg-white"
        onScroll={(e) => {
          const target = e.target as HTMLDivElement;
          if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
            if (visibleRootCount < filteredQuestionsTree.length) {
              setVisibleRootCount(prev => prev + 5);
            }
          }
        }}
      >
        {questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/25 my-2 shadow-3xs">
            <Sparkles className="w-8 h-8 text-indigo-500 mb-3 animate-pulse" />
            <p className="text-xs font-bold text-slate-700 mb-1">
              {lang === "zh" ? "暂无衍生问题节点" : "No nodes created yet"}
            </p>
            <p className="text-[10px] text-slate-400 leading-relaxed mb-4 max-w-[200px]">
              {lang === "zh" ? "系统现在完全空白。点击顶部「开启新问题」或在右侧专属发射台中键入“母提问”来唤醒主星盘。" : "Workspace is empty. Click 'New Topic' above or use the active launchpad to the right to wake the system."}
            </p>
            <button
              onClick={() => setIsAddingRoot(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-98"
            >
              <Plus className="w-4 h-4" />
              <span>{lang === "zh" ? "立即创建新问题" : "Create Core Topic"}</span>
            </button>
          </div>
        ) : filteredQuestionsTree.length > 0 ? (
          <div className="space-y-3.5">
            {filteredQuestionsTree.slice(0, visibleRootCount).map((rootNode) => (
              <TreeNodeComponent
                key={rootNode.id}
                node={rootNode}
                level={0}
                selectedNodeId={selectedNodeId}
                onSelect={(node) => setSelectedNodeId(node.id)}
                onToggleExpand={handleToggleExpand}
                onAddChild={handleAddChildNode}
                onDelete={handleDeleteNode}
                onEditNodeTitle={handleEditNodeTitle}
                addingChildToId={addingChildToId}
                setAddingChildToId={setAddingChildToId}
                activeAIIds={backgroundTasks}
                onTriggerAIAnswer={triggerAIAnswer}
                displayLanguage={lang}
              />
            ))}
            {filteredQuestionsTree.length > visibleRootCount && (
              <div className="pt-3 pb-2 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                <button
                  type="button"
                  onClick={() => setVisibleRootCount((prev) => prev + 30)}
                  className="w-full py-2.5 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 hover:text-indigo-800 border border-indigo-100 rounded-lg text-xs font-bold transition-all active:scale-98 cursor-pointer flex items-center justify-center gap-1.5 shadow-3xs"
                >
                  {lang === "zh" ? `加载更多提问 (第 1 - ${visibleRootCount} 个，共 ${filteredQuestionsTree.length} 个)` : `Load more questions (1 - ${visibleRootCount} of ${filteredQuestionsTree.length})`}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center text-slate-400">
            <Search className="w-8 h-8 text-slate-200 mb-2" />
            <p className="text-xs">未匹配到问题节点</p>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="mt-2 text-xs text-indigo-600 hover:underline font-semibold"
              >
                清除当前检索
              </button>
            )}
          </div>
        )}
      </div>

    </>
  );

  const renderAnswerPaneBody = () => {
    let siblingPrev = null;
    let siblingNext = null;

    if (selectedNodeId && questions.length) {
      const sibRes = findSiblings(questions, selectedNodeId);
      if (sibRes && sibRes.index !== -1) {
        const { siblings, index } = sibRes;
        const prevNode = index > 0 ? siblings[index - 1] : null;
        const nextNode = index < siblings.length - 1 ? siblings[index + 1] : null;

        if (prevNode) {
          siblingPrev = {
            id: prevNode.id,
            name: lang === "en" && prevNode.en_text ? prevNode.en_text : prevNode.text
          };
        }
        if (nextNode) {
          siblingNext = {
            id: nextNode.id,
            name: lang === "en" && nextNode.en_text ? nextNode.en_text : nextNode.text
          };
        }
      }
    }

    return (
      <AnswerPane
        selectedNode={selectedNodeObj}
        nodePath={selectedNodePathContextList}
        onUpdateAnswer={handleUpdateAnswer}
        onAddChild={handleAddChildNode}
        globalBackgroundTasks={backgroundTasks}
        onTriggerAIDeepAnswer={triggerAIAnswer}
        onNavigateToNode={setSelectedNodeId}
        displayLanguage={lang}
        onAddRootNode={handleAddRootDirect}
        onClose={() => setSelectedNodeId(null)}
        siblingPrev={siblingPrev}
        siblingNext={siblingNext}
      />
    );
  };

  return (
    <div className={`h-screen max-h-screen min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans overflow-hidden theme-${theme}`}>
      
      {/* Dynamic Style Overrides for multiple themes (Light, Night, Muji styles) */}
      <style>{`
        /* Geeker Theme Overrides (Linux hacker terminal) */
        .theme-geeker {
          background-color: #000000 !important;
          color: #00ff66 !important;
          font-family: var(--font-mono), monospace !important;
        }
        .theme-geeker * {
          font-family: var(--font-mono), sfmono-regular, consolas, monospace !important;
        }
        .theme-geeker header,
        .theme-geeker main,
        .theme-geeker section,
        .theme-geeker footer,
        .theme-geeker aside,
        .theme-geeker nav,
        .theme-geeker div,
        .theme-geeker p,
        .theme-geeker span,
        .theme-geeker h1,
        .theme-geeker h2,
        .theme-geeker h3,
        .theme-geeker h4,
        .theme-geeker h5,
        .theme-geeker h6,
        .theme-geeker ul,
        .theme-geeker li,
        .theme-geeker label,
        .theme-geeker select,
        .theme-geeker input,
        .theme-geeker textarea,
        .theme-geeker button,
        .theme-geeker table,
        .theme-geeker tr,
        .theme-geeker td,
        .theme-geeker th,
        .theme-geeker kbd,
        .theme-geeker pre,
        .theme-geeker code,
        .theme-geeker blockquote,
        .theme-geeker a {
          background-color: #000000 !important;
          color: #00ff66 !important;
          border-color: #16a34a !important;
        }
        .theme-geeker header {
          box-shadow: 0 0 10px rgba(0, 255, 102, 0.1) !important;
        }
        .theme-geeker input, 
        .theme-geeker select, 
        .theme-geeker textarea {
          caret-color: #00ff66 !important;
        }
        /* Outstanding highlighted active selections (selected node card) */
        .theme-geeker .bg-indigo-50,
        .theme-geeker [class*="bg-indigo-50"],
        .theme-geeker .bg-indigo-50 *,
        .theme-geeker [class*="bg-indigo-50"] *,
        .theme-geeker .bg-indigo-50 span,
        .theme-geeker .bg-indigo-50 svg,
        .theme-geeker .bg-indigo-50 button,
        .theme-geeker .active-selection {
          background-color: #00ff66 !important;
          color: #000000 !important;
          border-color: #000000 !important;
          text-shadow: none !important;
        }
        .theme-geeker .bg-indigo-50 svg *,
        .theme-geeker [class*="bg-indigo-50"] svg * {
          stroke: #000000 !important;
        }
        .theme-geeker .bg-indigo-600,
        .theme-geeker .bg-rose-600,
        .theme-geeker button.bg-indigo-600,
        .theme-geeker button.bg-rose-600,
        .theme-geeker .bg-indigo-600 *,
        .theme-geeker .bg-rose-600 * {
          background-color: #00ff66 !important;
          color: #000000 !important;
          font-weight: 950 !important;
        }
        .theme-geeker .hover\:bg-indigo-75:hover,
        .theme-geeker .hover\:bg-indigo-700:hover,
        .theme-geeker .hover\:bg-rose-700:hover,
        .theme-geeker button.bg-indigo-600:hover,
        .theme-geeker button.bg-rose-600:hover {
          background-color: #10b981 !important;
          color: #000000 !important;
        }
        /* Standard details/summary Think block overrides for complete black bg consistency */
        .theme-geeker details.think-details {
          border: 1px dashed #16a34a !important;
          background-color: #000000 !important;
        }
        .theme-geeker details.think-details[open] {
          border-left: 2px solid #00ff66 !important;
          background-color: #000000 !important;
        }
        .theme-geeker details.think-details summary.think-summary {
          color: #00ff66 !important;
          background-color: #000000 !important;
          border-color: #16a34a !important;
        }
        .theme-geeker details.think-details .think-content {
          color: #16a34a !important;
          font-family: var(--font-mono), monospace !important;
          background-color: #000000 !important;
        }

        /* General Markdown Body elements overrides inside Geeker theme */
        .theme-geeker .markdown-body {
          background-color: #000000 !important;
          color: #00ff66 !important;
        }
        .theme-geeker .markdown-body h1,
        .theme-geeker .markdown-body h2,
        .theme-geeker .markdown-body h3,
        .theme-geeker .markdown-body h4,
        .theme-geeker .markdown-body h5,
        .theme-geeker .markdown-body h6,
        .theme-geeker .markdown-body p,
        .theme-geeker .markdown-body span,
        .theme-geeker .markdown-body li,
        .theme-geeker .markdown-body strong,
        .theme-geeker .markdown-body em,
        .theme-geeker .markdown-body kbd,
        .theme-geeker .markdown-body details,
        .theme-geeker .markdown-body summary {
          background-color: #000000 !important;
          color: #00ff66 !important;
        }

        /* General details/summary fold blocks in Markdown answer responses */
        .theme-geeker .markdown-body details {
          background-color: #000000 !important;
          border: 1px dashed #16a34a !important;
          box-shadow: none !important;
        }
        .theme-geeker .markdown-body details[open] {
          background-color: #000000 !important;
          border: 1px solid #16a34a !important;
          border-left: 3px solid #00ff66 !important;
        }
        .theme-geeker .markdown-body details.level-1[open],
        .theme-geeker .markdown-body details.level-2[open],
        .theme-geeker .markdown-body details.level-3[open],
        .theme-geeker .markdown-body details.level-4[open],
        .theme-geeker .markdown-body details.level-5[open],
        .theme-geeker .markdown-body details.level-6[open] {
          border-left-color: #00ff66 !important;
          border-color: #16a34a !important;
        }
        .theme-geeker .markdown-body summary {
          background-color: #000000 !important;
          color: #00ff66 !important;
        }
        .theme-geeker .markdown-body summary:hover {
          color: #10b981 !important;
        }
        .theme-geeker .markdown-body summary::before {
          color: #00ff66 !important;
        }
        .theme-geeker .markdown-body details[open] > summary::before {
          color: #00ff66 !important;
        }
        .theme-geeker .markdown-body details.level-1[open] > summary::before,
        .theme-geeker .markdown-body details.level-2[open] > summary::before,
        .theme-geeker .markdown-body details.level-3[open] > summary::before,
        .theme-geeker .markdown-body details.level-4[open] > summary::before,
        .theme-geeker .markdown-body details.level-5[open] > summary::before,
        .theme-geeker .markdown-body details.level-6[open] > summary::before {
          color: #00ff66 !important;
        }

        /* Blockquotes - fully black backdrop with custom bold green solid borders and clean text styling */
        .theme-geeker .markdown-body blockquote {
          background-color: #000000 !important;
          color: #1bc860 !important;
          border-left: 4px solid #00ff66 !important;
          border-top: none !important;
          border-right: none !important;
          border-bottom: none !important;
          border-radius: 0 !important;
          box-shadow: none !important;
        }

        /* Code/Pre overrides */
        .theme-geeker .markdown-body code {
          background-color: #000000 !important;
          color: #00ff66 !important;
          border: 1px dotted #16a34a !important;
        }
        .theme-geeker .markdown-body pre {
          background-color: #000000 !important;
          color: #00ff66 !important;
          border: 1px dashed #16a34a !important;
        }
        .theme-geeker .hover\:bg-slate-50:hover,
        .theme-geeker .hover\:bg-slate-100:hover {
          background-color: #051405 !important;
          color: #00ff66 !important;
        }
        .theme-geeker .node-element text {
          fill: #00ff66 !important;
        }
        .theme-geeker .link-path {
          stroke: #00ff66 !important;
          stroke-dasharray: 2 2;
        }
        .theme-geeker #arrow path {
          fill: #00ff66 !important;
        }
        .theme-geeker .gemini-action-btn {
          background-color: #000000 !important;
          color: #00ff66 !important;
          border: 1px solid #16a34a !important;
          border-radius: 0px !important;
          font-family: var(--font-mono), monospace !important;
        }
        .theme-geeker .gemini-action-btn:hover:not(:disabled) {
          background-color: #00ff66 !important;
          color: #000000 !important;
          border-color: #00ff66 !important;
        }
        .theme-geeker .gemini-action-btn:disabled {
          opacity: 0.4 !important;
          cursor: not-allowed !important;
          background-color: #000000 !important;
          color: #16a34a !important;
          border-color: #16a34a !important;
        }
        .theme-geeker .gemini-action-btn * {
          color: inherit !important;
        }
        .theme-geeker .gemini-action-btn:hover:not(:disabled) * {
          color: #000000 !important;
          stroke: #000000 !important;
        }

        /* Cartoon Theme Overrides (Warm cozy Labubu palette) */
        .theme-cartoon {
          background-color: #fbf8f3 !important;
          color: #5c4033 !important;
        }
        .theme-cartoon header {
          background-color: #ebdcb9 !important;
          border-color: #ded0b1 !important;
          color: #5c4033 !important;
        }
        .theme-cartoon main, 
        .theme-cartoon section, 
        .theme-cartoon .bg-white {
          background-color: #fdfbf7 !important;
          color: #5c4033 !important;
        }
        .theme-cartoon .border-slate-200, 
        .theme-cartoon .border-slate-100 {
          border-color: #ecdcb9 !important;
        }
        .theme-cartoon .bg-slate-50, 
        .theme-cartoon .bg-slate-100 {
          background-color: #f5ebe0 !important;
          color: #5c4033 !important;
        }
        .theme-cartoon .text-slate-900, 
        .theme-cartoon .text-slate-800,
        .theme-cartoon .text-slate-700,
        .theme-cartoon .text-indigo-950,
        .theme-cartoon h2,
        .theme-cartoon h3,
        .theme-cartoon h4 {
          color: #5c4033 !important;
        }
        .theme-cartoon .text-slate-600,
        .theme-cartoon .text-slate-550,
        .theme-cartoon .text-slate-550,
        .theme-cartoon .text-slate-500, 
        .theme-cartoon .text-slate-400 {
          color: #a78b71 !important;
        }
        .theme-cartoon input, 
        .theme-cartoon select, 
        .theme-cartoon textarea {
          background-color: #ffffff !important;
          color: #5c4033 !important;
          border-color: #dfceb7 !important;
        }
        .theme-cartoon .text-indigo-600, 
        .theme-cartoon .text-indigo-700,
        .theme-cartoon .text-rose-600 {
          color: #db2777 !important; /* Playful Labubu Pink cheeks/ears */
        }
        .theme-cartoon .bg-indigo-600,
        .theme-cartoon .bg-rose-600 {
          background-color: #db2777 !important; /* Charm Pink button */
          color: #ffffff !important;
        }
        .theme-cartoon .hover\:bg-indigo-700:hover,
        .theme-cartoon .hover\:bg-rose-700:hover {
          background-color: #be185d !important;
        }
        .theme-cartoon .border-indigo-200 {
          border-color: #fbcfe8 !important;
        }
        .theme-cartoon .bg-indigo-50 {
          background-color: #fdf2f8 !important;
          color: #db2777 !important;
        }
        .theme-cartoon .markdown-body {
          color: #4e3629 !important;
        }
        .theme-cartoon details.think-details {
          border: 2px solid #ebdcb9 !important;
          background-color: #fbf8f3 !important;
          border-radius: 12px !important;
        }
        .theme-cartoon details.think-details[open] {
          border-left: 4px solid #db2777 !important;
          background-color: #fdfbf7 !important;
        }
        .theme-cartoon details.think-details summary.think-summary {
          color: #5c4033 !important;
          background-color: #ebdcb9 !important;
          border-radius: 10px 10px 0 0 !important;
        }
        .theme-cartoon details.think-details .think-content {
          color: #7c5c43 !important;
          background-color: #fdfbf7 !important;
        }
        .theme-cartoon .hover\:bg-slate-50:hover,
        .theme-cartoon .hover\:bg-slate-100:hover,
        .theme-cartoon .hover\:bg-rose-50/50:hover {
          background-color: #fbf0f4 !important;
        }
        .theme-cartoon .node-element text {
          fill: #5c4033 !important;
        }
        .theme-cartoon .link-path {
          stroke: #db2777 !important;
          stroke-width: 2px !important;
        }
        .theme-cartoon #arrow path {
          fill: #db2777 !important;
        }
        .theme-cartoon .gemini-action-btn {
          background-color: #fdfbf7 !important;
          color: #db2777 !important;
          border: 2px solid #fbcfe8 !important;
          border-radius: 8px !important;
        }
        .theme-cartoon .gemini-action-btn:hover:not(:disabled) {
          background-color: #db2777 !important;
          color: #ffffff !important;
          border-color: #db2777 !important;
        }
        .theme-cartoon .gemini-action-btn:disabled {
          opacity: 0.4 !important;
          cursor: not-allowed !important;
          background-color: #fdfbf7 !important;
          color: #ebdcb9 !important;
          border-color: #ebdcb9 !important;
        }
        .theme-cartoon .gemini-action-btn * {
          color: inherit !important;
        }
        .theme-cartoon .gemini-action-btn:hover:not(:disabled) * {
          color: #ffffff !important;
          stroke: #ffffff !important;
        }

        /* ZEN MASTER Sterile Cold style Overrides (Extreme clinical normcore grays but clean) */
        .theme-zen {
          background-color: #f2f2f2 !important;
          color: #1a1a1a !important;
        }
        .theme-zen header {
          background-color: #ffffff !important;
          border-color: #e0e0e0 !important;
        }
        .theme-zen main {
          background-color: #f5f5f5 !important;
        }
        .theme-zen section, 
        .theme-zen .bg-white {
          background-color: #fafafa !important;
          color: #1a1a1a !important;
        }
        .theme-zen .border-slate-200, 
        .theme-zen .border-slate-100 {
          border-color: #e5e5e5 !important;
        }
        .theme-zen .bg-slate-50, 
        .theme-zen .bg-slate-100 {
          background-color: #ebebeb !important;
          color: #333333 !important;
        }
        .theme-zen .text-slate-900, 
        .theme-zen .text-slate-800 {
          color: #111111 !important;
        }
        .theme-zen .text-slate-700,
        .theme-zen .text-slate-600, 
        .theme-zen .text-slate-500, 
        .theme-zen .text-slate-400 {
          color: #888888 !important;
        }
        .theme-zen input, 
        .theme-zen select, 
        .theme-zen textarea {
          background-color: #ffffff !important;
          color: #111111 !important;
          border-color: #cccccc !important;
          border-radius: 2px !important;
        }
        .theme-zen .text-indigo-600, 
        .theme-zen .text-indigo-700,
        .theme-zen .text-rose-600 {
          color: #1a1a1a !important;
          text-decoration: underline !important;
        }
        .theme-zen .bg-indigo-600,
        .theme-zen .bg-rose-600 {
          background-color: #111111 !important;
          color: #ffffff !important;
          border-radius: 2px !important;
        }
        .theme-zen .bg-indigo-50 {
          background-color: #f0f0f0 !important;
          color: #222222 !important;
          border-radius: 2px !important;
        }
        .theme-zen .border-indigo-200 {
          border-color: #d6d6d6 !important;
        }
        .theme-zen .markdown-body {
          color: #1a1a1a !important;
        }
        .theme-zen details.think-details {
          border: 1px solid #dcdcdc !important;
          background-color: #fcfcfc !important;
          border-radius: 0 !important;
        }
        .theme-zen details.think-details[open] {
          border-left: 2px solid #111111 !important;
          background-color: #fafafa !important;
        }
        .theme-zen details.think-details summary.think-summary {
          color: #222222 !important;
          background-color: #eaeaea !important;
          border-radius: 0 !important;
        }
        .theme-zen details.think-details .think-content {
          color: #444444 !important;
          background-color: #fafafa !important;
          font-family: var(--font-mono), monospace !important;
        }
        .theme-zen .hover\:bg-slate-50:hover {
          background-color: #f0f0f0 !important;
        }
        .theme-zen .node-element text {
          fill: #111111 !important;
        }
        .theme-zen .link-path {
          stroke: #b3b3b3 !important;
          stroke-width: 1px !important;
        }
        .theme-zen #arrow path {
          fill: #b3b3b3 !important;
        }
        .theme-zen .gemini-action-btn {
          background-color: #fafafa !important;
          color: #111111 !important;
          border: 1px solid #cccccc !important;
          border-radius: 2px !important;
        }
        .theme-zen .gemini-action-btn:hover:not(:disabled) {
          background-color: #111111 !important;
          color: #ffffff !important;
          border-color: #111111 !important;
        }
        .theme-zen .gemini-action-btn:disabled {
          opacity: 0.4 !important;
          cursor: not-allowed !important;
          background-color: #fafafa !important;
          color: #cccccc !important;
          border-color: #e0e0e0 !important;
        }
        .theme-zen .gemini-action-btn * {
          color: inherit !important;
        }
        .theme-zen .gemini-action-btn:hover:not(:disabled) * {
          color: #ffffff !important;
          stroke: #ffffff !important;
        }

        /* SCIENTIST Empirical Blueprint style Overrides (Clinical academic blue-gray laboratory style) */
        .theme-scientist {
          background-color: #0d1527 !important;
          color: #cbd5e1 !important;
        }
        .theme-scientist header {
          background-color: #0f172a !important;
          border-color: #1e293b !important;
        }
        .theme-scientist main {
          background-color: #0b0f19 !important;
        }
        .theme-scientist section, 
        .theme-scientist .bg-white {
          background-color: #0f172a !important;
          color: #cbd5e1 !important;
        }
        .theme-scientist .border-slate-200, 
        .theme-scientist .border-slate-100 {
          border-color: #1e293b !important;
        }
        .theme-scientist .bg-slate-50, 
        .theme-scientist .bg-slate-100 {
          background-color: #1e293b !important;
          color: #94a3b8 !important;
        }
        .theme-scientist .text-slate-900, 
        .theme-scientist .text-slate-800 {
          color: #f8fafc !important;
        }
        .theme-scientist .text-slate-700,
        .theme-scientist .text-slate-600, 
        .theme-scientist .text-slate-500, 
        .theme-scientist .text-slate-400 {
          color: #94a3b8 !important;
        }
        .theme-scientist input, 
        .theme-scientist select, 
        .theme-scientist textarea {
          background-color: #0b0f19 !important;
          color: #f8fafc !important;
          border-color: #334155 !important;
          border-radius: 4px !important;
        }
        .theme-scientist .text-indigo-600, 
        .theme-scientist .text-indigo-700,
        .theme-scientist .text-rose-600 {
          color: #38bdf8 !important;
        }
        .theme-scientist .bg-indigo-600,
        .theme-scientist .bg-rose-600 {
          background-color: #2563eb !important;
          color: #ffffff !important;
          border-radius: 4px !important;
        }
        .theme-scientist .bg-indigo-50 {
          background-color: #1e3a8a !important;
          color: #93c5fd !important;
          border-radius: 4px !important;
        }
        .theme-scientist .border-indigo-200 {
          border-color: #2563eb !important;
        }
        .theme-scientist .markdown-body {
          color: #cbd5e1 !important;
        }
        .theme-scientist details.think-details {
          border: 1px solid #1e293b !important;
          background-color: #111827 !important;
          border-radius: 4px !important;
        }
        .theme-scientist details.think-details[open] {
          border-left: 3px solid #2563eb !important;
          background-color: #0f172a !important;
        }
        .theme-scientist details.think-details summary.think-summary {
          color: #38bdf8 !important;
          background-color: #1e293b !important;
          border-radius: 2px !important;
        }
        .theme-scientist details.think-details .think-content {
          color: #94a3b8 !important;
          background-color: #0b0f19 !important;
          font-family: var(--font-mono), monospace !important;
        }
        .theme-scientist .hover\:bg-indigo-75:hover,
        .theme-scientist .hover\:bg-indigo-700:hover,
        .theme-scientist .hover\:bg-rose-700:hover,
        .theme-scientist button.bg-indigo-600:hover,
        .theme-scientist button.bg-rose-600:hover,
        .theme-scientist .hover\:bg-slate-50:hover {
          background-color: #1e293b !important;
        }
        .theme-scientist .node-element text {
          fill: #38bdf8 !important;
        }
        .theme-scientist .link-path {
          stroke: #1e293b !important;
          stroke-width: 1.5px !important;
        }
        .theme-scientist #arrow path {
          fill: #2563eb !important;
        }
        .theme-scientist .gemini-action-btn {
          background-color: #0d1527 !important;
          color: #38bdf8 !important;
          border: 1px solid #1e3a8a !important;
          border-radius: 4px !important;
        }
        .theme-scientist .gemini-action-btn:hover:not(:disabled) {
          background-color: #2563eb !important;
          color: #ffffff !important;
          border-color: #2563eb !important;
        }
        .theme-scientist .gemini-action-btn:disabled {
          opacity: 0.4 !important;
          cursor: not-allowed !important;
          background-color: #0d1527 !important;
          color: #1e3a8a !important;
          border-color: #1e293b !important;
        }
        .theme-scientist .gemini-action-btn * {
          color: inherit !important;
        }
        .theme-scientist .gemini-action-btn:hover:not(:disabled) * {
          color: #ffffff !important;
          stroke: #ffffff !important;
        }
      `}</style>
      
      {/* Top Banner Navigation matching Geometric Balance styling */}
      <header className="h-14 border-b border-slate-200 bg-white flex items-center px-4 sm:px-6 justify-between shrink-0 sticky top-0 z-30 relative shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        {isMobileSearchExpanded ? (
          <div className="flex items-center gap-2 w-full animate-in fade-in duration-200">
            <button
              onClick={() => {
                setIsMobileSearchExpanded(false);
                setSearchTerm("");
              }}
              className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition shrink-0 cursor-pointer"
              title={lang === "zh" ? "返回" : "Back"}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="relative flex-1">
              <input
                type="text"
                autoFocus
                placeholder={t("searchPlaceholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-9 py-1.5 bg-slate-100 focus:bg-white border border-transparent focus:border-slate-200 rounded-full text-xs w-full focus:ring-2 focus:ring-indigo-500/15 outline-none placeholder-slate-400 text-slate-800 transition-all font-medium"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-3 top-2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center transition-all hover:scale-105 shadow-xs overflow-hidden">
                {logoMode === "custom" && customLogoUrl ? (
                  <img src={customLogoUrl} alt="Logo" className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    {/* Connector lines from Layer 1 to Layer 2 */}
                    <line x1="12" y1="5" x2="8" y2="12" />
                    <line x1="12" y1="5" x2="16" y2="12" />
                  
                    {/* Connector lines from Layer 2 to Layer 3 */}
                    <line x1="8" y1="12" x2="4" y2="19" />
                    <line x1="8" y1="12" x2="12" y2="19" />
                    <line x1="16" y1="12" x2="12" y2="19" />
                    <line x1="16" y1="12" x2="20" y2="19" />

                    {/* Dots representing the cascading tree nodes */}
                    <circle cx="12" cy="5" r="1.5" fill="currentColor" />
                    <circle cx="8" cy="12" r="1.5" fill="currentColor" />
                    <circle cx="16" cy="12" r="1.5" fill="currentColor" />
                    <circle cx="4" cy="19" r="1.5" fill="currentColor" />
                    <circle cx="12" cy="19" r="1.5" fill="currentColor" />
                    <circle cx="20" cy="19" r="1.5" fill="currentColor" />
                  </svg>
                )}
              </div>
              <div className="flex flex-col">
                <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-tight">{appTitle}</h1>
                <p className="text-[9px] text-slate-400 font-medium hidden sm:block">{appSubtitle}</p>
              </div>
            </div>
            
            {/* Active Background Tasks indicator badge */}
            {Object.values(backgroundTasks).some(t => t.status === "running") && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-indigo-50 border border-indigo-100 rounded-full animate-in fade-in duration-300 text-[10px] font-bold text-indigo-700 font-sans" title={lang === "zh" ? "正在后台解答的疑问数" : "Background tasks count"}>
                <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                <span>
                  {Object.values(backgroundTasks).filter(t => t.status === "running").length}
                </span>
              </div>
            )}

            {/* Quick Filter Box placed in the center of the header and lengthened */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden lg:block w-96 xl:w-[480px]">
              <div className="relative">
                <input
                  type="text"
                  placeholder={t("searchPlaceholder")}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-9 py-1.5 bg-slate-100 hover:bg-slate-200/50 focus:bg-white border border-transparent focus:border-slate-200 rounded-full text-xs w-full focus:ring-2 focus:ring-indigo-500/15 outline-none placeholder-slate-400 text-slate-800 transition-all font-medium"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    className="absolute right-3 top-2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Top bar search layout & metrics from Geometric Balance */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Search Toggle Button on Mobile */}
              <button
                onClick={() => setIsMobileSearchExpanded(true)}
                className="lg:hidden p-2.5 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition cursor-pointer z-20"
                title={lang === "zh" ? "搜索" : "Search"}
              >
                <Search className="w-5 h-5" />
              </button>

              {/* Unified System Control Panel replacing multiple messy buttons */}
              <div className="relative">
                <button
                  onClick={() => setIsSettingsMenuOpen(!isSettingsMenuOpen)}
                  className={`h-auto sm:h-8 px-2 sm:px-3.5 rounded-full border flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 transition text-[9px] sm:text-xs font-bold shadow-xs cursor-pointer ${
                    isSettingsMenuOpen 
                      ? "bg-slate-100 border-slate-300 text-slate-800" 
                      : aiAvailable 
                        ? "bg-emerald-50/50 hover:bg-emerald-50 border-emerald-200 text-slate-705 text-emerald-800" 
                        : "bg-amber-50/50 hover:bg-amber-50 border-amber-200 text-amber-800"
                  }`}
                  title={t("unifiedSettings")}
                >
                  <Settings className={`w-3.5 h-3.5 ${isSettingsMenuOpen ? "animate-spin" : aiAvailable ? "text-emerald-500 fill-emerald-50" : "text-amber-500 fill-amber-50 animate-pulse"}`} />
                  
                  {!aiAvailable && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping absolute top-0.5 right-0.5" />
                  )}
                </button>

            {isSettingsMenuOpen && (
              <>
                {/* Click outside backdrop */}
                <div 
                  className="fixed inset-0 z-30 cursor-default" 
                  onClick={() => setIsSettingsMenuOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-40 p-4 font-sans space-y-4 animate-in fade-in slide-in-from-top-2 duration-150">
                  
                  {/* Title Header */}
                  <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-indigo-600" />
                      <span className="font-bold text-xs text-slate-800">{t("unifiedSettings")}</span>
                    </div>
                    <button 
                      onClick={() => setIsSettingsMenuOpen(false)}
                      className="text-slate-400 hover:text-slate-600 transition text-xs font-bold"
                    >
                      ✕
                    </button>
                  </div>

                  {/* 1. Interface Language Selector */}
                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("language")}</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setLang("zh")}
                        className={`py-1.5 rounded-lg text-xs font-bold border transition ${
                          lang === "zh" 
                            ? "bg-indigo-50 border-indigo-200 text-indigo-700" 
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        🇨🇳 中文 (Zh)
                      </button>
                      <button
                        onClick={() => setLang("en")}
                        className={`py-1.5 rounded-lg text-xs font-bold border transition ${
                          lang === "en" 
                            ? "bg-indigo-50 border-indigo-200 text-indigo-700" 
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        🇺🇸 English (En)
                      </button>
                    </div>
                  </div>

                  {/* 2. Visual Interface Theme Selector */}
                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("theme")}</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => {
                          setTheme("cartoon");
                          localStorage.setItem("qa_theme", "cartoon");
                        }}
                        className={`py-1.5 rounded-lg text-xs font-bold border transition flex flex-col items-center gap-1 ${
                          theme === "cartoon" 
                            ? "bg-rose-50 border-rose-200 text-rose-600 shadow-xs" 
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        <span className="text-sm">🧸</span>
                        <span className="text-[10px]">{t("cartoon")}</span>
                      </button>
                      <button
                        onClick={() => {
                          setTheme("geeker");
                          localStorage.setItem("qa_theme", "geeker");
                        }}
                        className={`py-1.5 rounded-lg text-xs font-bold border transition flex flex-col items-center gap-1 ${
                          theme === "geeker" 
                            ? "bg-black border-[#00ff66] text-[#00ff66] shadow-[0_0_5px_rgba(34,197,94,0.3)] font-mono" 
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        <span className="text-sm">📟</span>
                        <span className="text-[10px]">{t("geeker")}</span>
                      </button>
                      <button
                        onClick={() => {
                          setTheme("zen");
                          localStorage.setItem("qa_theme", "zen");
                        }}
                        className={`py-1.5 rounded-lg text-xs font-bold border transition flex flex-col items-center gap-1 ${
                          theme === "zen" 
                            ? "bg-neutral-100 border-neutral-300 text-neutral-900 font-medium font-sans" 
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        <span className="text-sm">🧘</span>
                        <span className="text-[10px]">{t("zen")}</span>
                      </button>
                      <button
                        onClick={() => {
                          setTheme("scientist");
                          localStorage.setItem("qa_theme", "scientist");
                        }}
                        className={`py-1.5 rounded-lg text-xs font-bold border transition flex flex-col items-center gap-1 ${
                          theme === "scientist" 
                            ? "bg-sky-950 border-sky-450 text-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.3)] font-sans" 
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        <span className="text-sm">🔬</span>
                        <span className="text-[10px]">{t("scientist")}</span>
                      </button>
                    </div>
                  </div>

                  {/* 3. AI Intelligent Engine Custom Provider/Model credentials */}
                  <div className="space-y-1.5 pt-1">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("apiIndicator")}</span>
                    <div 
                      onClick={() => {
                        setIsSettingsMenuOpen(false);
                        handleOpenSettings();
                      }}
                      className={`p-2.5 rounded-xl border cursor-pointer text-left transition flex items-center justify-between ${
                        aiAvailable 
                          ? "bg-emerald-50/40 border-emerald-100 hover:bg-emerald-55 text-emerald-800" 
                          : "bg-amber-50/40 border-amber-100 hover:bg-amber-55 text-amber-850"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${aiAvailable ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`} />
                        <div>
                          <p className="text-[11px] font-bold leading-tight">{aiAvailable ? t("activeLlmStatus") : t("inactiveLlmStatus")}</p>
                          <p className="text-[9px] text-slate-400 mt-0.5 font-mono">Model: {llmModel}</p>
                        </div>
                      </div>
                      <span className="text-[9px] text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full font-bold">⚙️ {lang === "zh" ? "配置" : "Setup"}</span>
                    </div>
                  </div>
                  {/* Header & Logo Customization */}
                  <div className="space-y-1.5 pb-1 border-t border-slate-150 pt-3">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">HEADER</span>
                    <input 
                      type="text" 
                      value={appTitle} 
                      onChange={(e) => setAppTitle(e.target.value)}
                      className="w-full text-xs p-1 bg-slate-100 rounded border border-transparent focus:border-indigo-500 focus:bg-white outline-none transition-all"
                      placeholder="Title"
                    />
                    <input 
                      type="text" 
                      value={appSubtitle} 
                      onChange={(e) => setAppSubtitle(e.target.value)}
                      className="w-full text-xs p-1 bg-slate-100 rounded border border-transparent focus:border-indigo-500 focus:bg-white outline-none transition-all"
                      placeholder="Subtitle"
                    />
                    
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-2">LOGO</span>
                    <div className="flex gap-2">
                      <button onClick={() => setLogoMode("default")} className={`flex-1 py-1.5 rounded text-[10px] ${logoMode === "default" ? "bg-indigo-600 text-white" : "bg-slate-100"}`}>Default</button>
                    </div>
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const url = URL.createObjectURL(file);
                          setCustomLogoUrl(url);
                          setLogoMode("custom");
                        }
                      }}
                      className="w-full text-[10px]"
                    />
                  </div>

                  {/* 4. Import / Export digital asset files */}
                  <div className="space-y-1.5 pb-1 border-t border-slate-150 pt-3">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("dataOperations")}</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setIsSettingsMenuOpen(false);
                          handleOpenImportModal();
                        }}
                        className="py-2.5 rounded-lg border border-slate-200 flex flex-col items-center justify-center bg-white hover:bg-slate-50 text-slate-700 transition font-bold text-[11px] gap-1 cursor-pointer shadow-3xs"
                      >
                        <Upload className="w-4 h-4 text-slate-500" />
                        <span>{t("importAsset")}</span>
                      </button>
                      <button
                        onClick={() => {
                          setIsSettingsMenuOpen(false);
                          handleOpenDownloadModal();
                        }}
                        className="py-2.5 rounded-lg border border-indigo-100 flex flex-col items-center justify-center bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition font-bold text-[11px] gap-1 cursor-pointer shadow-3xs"
                      >
                        <Download className="w-4 h-4 text-indigo-600" />
                        <span>{t("downloadAsset")}</span>
                      </button>
                    </div>
                  </div>

                </div>
              </>
            )}
          </div>

        </div>
        </>
      )}
      </header>

      {/* Primary Workspace Panel - Full boundary SaaS split layout */}
      <main className="flex-1 flex overflow-hidden bg-slate-50 relative">
        
        {activeTab === "tree" ? (
          isMobile ? (
            /* Mobile Independent Layout - Option A */
            <>
              {!selectedNodeObj && (
                <section className="w-full bg-white flex flex-col shrink-0 overflow-y-auto h-full absolute inset-0 z-10 transition-all">
                  {renderTreeSidebarBody()}
                </section>
              )}
              {selectedNodeObj && (
                <section className="w-full h-full bg-slate-50 flex flex-col overflow-hidden absolute inset-0 z-20 animate-in slide-in-from-bottom duration-300 transition-all">
                  {renderAnswerPaneBody()}
                </section>
              )}
            </>
          ) : (
            /* Desktop Independent Layout - Option A */
            <>
              <motion.section 
                layout
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className={`${isPaneSwapped ? 'flex-[1_1_0%]' : 'w-[440px]'} bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-y-auto h-full`}
              >
                {renderTreeSidebarBody()}
              </motion.section>
              <LayoutDivider 
                isExpanded={isPaneSwapped} 
                onToggle={() => setIsPaneSwapped(!isPaneSwapped)} 
              />
              <motion.section 
                layout
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className={`${isPaneSwapped ? 'w-[440px]' : 'flex-1'} flex flex-col overflow-hidden h-full bg-slate-50 p-6 animate-in fade-in duration-300`}
              >
                {renderAnswerPaneBody()}
              </motion.section>
            </>
          )
        ) : (
          isMobile ? (
            /* Mobile Independent Layout - Network View */
            <>
              {!selectedNodeObj && (
                <section className="w-full bg-white flex flex-col shrink-0 overflow-hidden h-full absolute inset-0 z-10 transition-all">
                  <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
                    <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200/50">
                      <button
                        onClick={() => setActiveTab("tree")}
                        className="px-2.5 py-1 rounded-md text-[10.5px] font-bold transition-all duration-200 flex items-center gap-1 cursor-pointer text-slate-500 hover:text-slate-800"
                      >
                        <span>{t("treeTab")}</span>
                      </button>
                      <button
                        onClick={() => setActiveTab("network")}
                        className="px-2.5 py-1 rounded-md text-[10.5px] font-bold transition-all duration-200 flex items-center gap-1 cursor-pointer bg-white text-indigo-600 shadow-xs"
                      >
                        <span>{t("networkTab")}</span>
                      </button>
                    </div>
                    <span className="text-[10px] font-extrabold text-slate-400 select-none pr-1.5 whitespace-nowrap">
                      {lang === "zh" ? "网络关联" : "Universe"}
                    </span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <NetworkView
                      questions={questions}
                      selectedNodeId={selectedNodeId}
                      onSelectNode={(id) => setSelectedNodeId(id)}
                      onUpdateAnswer={handleUpdateAnswer}
                      onEditNodeTitle={handleEditNodeTitle}
                      onDeleteNode={handleDeleteNode}
                      onAddChildNode={handleAddChildNode}
                      onNavigateToTree={(id) => {
                        setSelectedNodeId(id);
                        setActiveTab("tree");
                      }}
                      minimaxApiKey={llmApiKey}
                      searchTerm={searchTerm}
                      onSearchTermChange={(term) => setSearchTerm(term)}
                      displayLanguage={lang}
                      theme={theme}
                      hideInspector={true}
                    />
                  </div>
                </section>
              )}
              {selectedNodeObj && (
                <section className="w-full h-full bg-slate-50 flex flex-col overflow-hidden absolute inset-0 z-20 animate-in slide-in-from-bottom duration-300 transition-all">
                  {renderAnswerPaneBody()}
                </section>
              )}
            </>
          ) : (
            /* Desktop Independent Layout - Network View */
            <>
              <motion.section 
                layout
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className={`${isPaneSwapped ? 'flex-[1_1_0%]' : 'w-[440px]'} bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden h-full`}
              >
                <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
                  <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200/50">
                    <button
                      onClick={() => setActiveTab("tree")}
                      className="px-2.5 py-1 rounded-md text-[10.5px] font-bold transition-all duration-200 flex items-center gap-1 cursor-pointer text-slate-500 hover:text-slate-800"
                    >
                      <span>{t("treeTab")}</span>
                    </button>
                    <button
                      onClick={() => setActiveTab("network")}
                      className="px-2.5 py-1 rounded-md text-[10.5px] font-bold transition-all duration-200 flex items-center gap-1 cursor-pointer bg-white text-indigo-600 shadow-xs"
                    >
                      <span>{t("networkTab")}</span>
                    </button>
                  </div>
                  <span className="text-[10px] font-extrabold text-slate-400 select-none pr-1.5 whitespace-nowrap">
                    {lang === "zh" ? "网络关联" : "Universe"}
                  </span>
                </div>
                <div className="flex-1 overflow-hidden">
                  <NetworkView
                    questions={questions}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={(id) => setSelectedNodeId(id)}
                    onUpdateAnswer={handleUpdateAnswer}
                    onEditNodeTitle={handleEditNodeTitle}
                    onDeleteNode={handleDeleteNode}
                    onAddChildNode={handleAddChildNode}
                    onNavigateToTree={(id) => {
                      setSelectedNodeId(id);
                      setActiveTab("tree");
                    }}
                    minimaxApiKey={llmApiKey}
                    searchTerm={searchTerm}
                    onSearchTermChange={(term) => setSearchTerm(term)}
                    displayLanguage={lang}
                    theme={theme}
                    hideInspector={true}
                  />
                </div>
              </motion.section>
              <LayoutDivider 
                isExpanded={isPaneSwapped} 
                onToggle={() => setIsPaneSwapped(!isPaneSwapped)} 
              />
              <motion.section 
                layout
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className={`${isPaneSwapped ? 'w-[440px]' : 'flex-1'} flex flex-col overflow-hidden h-full bg-slate-50 p-6 animate-in fade-in duration-300`}
              >
                {renderAnswerPaneBody()}
              </motion.section>
            </>
          )
        )}

      </main>

      {/* 5. Custom API Key settings overlay modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <div className={`p-1.5 px-2.5 rounded flex items-center justify-center ${
                aiAvailable 
                  ? "bg-emerald-50 text-emerald-700" 
                  : "bg-amber-50 text-amber-700"
              }`}>
                <Settings className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-bold text-slate-900">配置智能大纲多模型服务</h3>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                    aiAvailable 
                      ? "bg-emerald-100 text-emerald-800" 
                      : "bg-amber-100 text-amber-800"
                  }`}>
                    {aiAvailable ? "验证成功" : "待配置或核验"}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">支持主流所有 LLM 核心接口及 API 代理密钥配置</p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Provider Selector */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                  1. 模型服务商 (LLM Provider)
                </label>
                <select
                  value={tempProvider}
                  onChange={(e) => {
                    const prov = e.target.value;
                    setTempProvider(prov);
                    // Autofill default models and base urls as guide
                    if (prov === "minimax") {
                      setTempBaseUrl("https://api.minimaxi.com/v1");
                      setTempModel("MiniMax-M3");
                    } else if (prov === "openai") {
                      setTempBaseUrl("https://api.openai.com/v1");
                      setTempModel("gpt-4o-mini");
                    } else if (prov === "deepseek") {
                      setTempBaseUrl("https://api.deepseek.com");
                      setTempModel("deepseek-chat");
                    } else if (prov === "gemini") {
                      setTempBaseUrl("https://generativelanguage.googleapis.com/v1beta/openai");
                      setTempModel("gemini-3.5-flash");
                    } else if (prov === "anthropic") {
                      setTempBaseUrl("https://api.anthropic.com");
                      setTempModel("claude-3-5-haiku-20241022");
                    } else if (prov === "custom") {
                      setTempBaseUrl("");
                      setTempModel("");
                    }
                  }}
                  className="w-full text-xs px-3 py-2 bg-slate-50 focus:bg-white rounded border border-slate-200 focus:border-indigo-500 focus:outline-none text-slate-800 font-medium cursor-pointer"
                >
                  <option value="minimax">MiniMax (MiniMax-M3 / ABAB)</option>
                  <option value="openai">OpenAI (ChatGPT)</option>
                  <option value="deepseek">DeepSeek (深度求索)</option>
                  <option value="gemini">{lang === "zh" ? "Google Gemini (双子座)" : "Google Gemini"}</option>
                  <option value="anthropic">{lang === "zh" ? "Anthropic Claude (克劳德)" : "Anthropic Claude"}</option>
                  <option value="custom">{lang === "zh" ? "Custom (其它 OpenAI 兼容接口)" : "Custom (Other OpenAI Compatible)"}</option>
                </select>
              </div>

              {/* API Key Input */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                  {lang === "zh" ? "2. 接口 API Key" : "2. Interface API Key"}
                </label>
                <input
                  type="password"
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder={
                    tempProvider === "minimax"
                      ? (lang === "zh" ? "请输入 MiniMax API Key (即 sk-cp-... 开头的智能密钥)" : "Please enter MiniMax API Key (starts with sk-cp-...)")
                      : (lang === "zh" ? `请输入 ${tempProvider.toUpperCase()} 密钥` : `Please enter ${tempProvider.toUpperCase()} Key`)
                  }
                  className="w-full text-xs px-3 py-2 bg-slate-50 focus:bg-white rounded border border-slate-200 focus:border-indigo-500 focus:outline-none font-mono text-slate-800 animate-none"
                />
              </div>

              {/* API Base URL */}
              <div className="space-y-1 font-sans">
                <div className="flex justify-between items-center">
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                    {lang === "zh" ? "3. 自定义代理基址 (Base URL)" : "3. Custom Proxy Base URL"}
                  </label>
                  <span className="text-[9px] text-indigo-600 font-semibold uppercase">{lang === "zh" ? "选填" : "Optional"}</span>
                </div>
                <input
                  type="text"
                  value={tempBaseUrl}
                  onChange={(e) => setTempBaseUrl(e.target.value)}
                  placeholder={
                    tempProvider === "minimax" ? "https://api.minimaxi.com/v1" : 
                    tempProvider === "openai" ? "https://api.openai.com/v1" :
                    tempProvider === "deepseek" ? "https://api.deepseek.com" :
                    tempProvider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta/openai" :
                    tempProvider === "anthropic" ? "https://api.anthropic.com" : (lang === "zh" ? "例如: https://api.your-relay.com/v1" : "e.g., https://api.your-relay.com/v1")
                  }
                  className="w-full text-xs px-3 py-2 bg-slate-50 focus:bg-white rounded border border-slate-200 focus:border-indigo-500 focus:outline-none font-mono text-slate-800"
                />
              </div>

              {/* 指定模型名称 */}
              <div className="space-y-1 font-sans">
                <div className="flex justify-between items-center">
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                    {lang === "zh" ? "4. 指定模型名称 (Model)" : "4. Specify Model Name"}
                  </label>
                  <span className="text-[9px] text-indigo-600 font-semibold uppercase">{lang === "zh" ? "选填" : "Optional"}</span>
                </div>
                <input
                  type="text"
                  value={tempModel}
                  onChange={(e) => setTempModel(e.target.value)}
                  placeholder={
                    tempProvider === "minimax" ? "MiniMax-M3" : 
                    tempProvider === "openai" ? (lang === "zh" ? "gpt-4o-mini 或 gpt-4o" : "gpt-4o-mini or gpt-4o") :
                    tempProvider === "deepseek" ? "deepseek-chat" :
                    tempProvider === "gemini" ? "gemini-3.5-flash" :
                    tempProvider === "anthropic" ? "claude-3-5-haiku-20241022" : (lang === "zh" ? "填入自定义模型名称" : "Enter custom model name")
                  }
                  className="w-full text-xs px-3 py-2 bg-slate-50 focus:bg-white rounded border border-slate-200 focus:border-indigo-500 focus:outline-none font-mono text-slate-800"
                />
              </div>

              <div className="p-3 bg-slate-50 rounded border border-slate-200/50 text-[10px] text-slate-500 leading-relaxed font-sans">
                <p>{lang === "zh" ? "💡 密钥安全储存于您浏览器沙箱 LocalStorage 中，不会泄露。支持任何 OpenAI 兼容的反代和模型配置名称。" : "💡 Keys are securely stored in your browser's LocalStorage sandbox and will not leak. Supports any OpenAI compatible reverse proxy and model configuration name."}</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-600 hover:bg-slate-50 transition font-bold cursor-pointer"
              >
                {lang === "zh" ? "取消" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleSaveLlmSettings}
                className="px-3.5 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 transition font-bold cursor-pointer shadow-2xs"
              >
                {lang === "zh" ? "保存并验证" : "Save & Verify"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Customizable Download modal "下载你的财产" */}
      {isDownloadOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-lg w-full p-5 space-y-5 flex flex-col max-h-[90vh]">
            
            {/* Header section */}
            <div className="flex items-center gap-2 pb-2.5 border-b border-slate-100 shrink-0 font-sans">
              <div className="p-1 px-2 bg-indigo-50 rounded text-indigo-700">
                <Download className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{lang === "zh" ? "下载你的问题树" : "Download your Question Tree"}</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">{lang === "zh" ? "将您构建的结构化提问大纲和 AI 答卷资产保存至本地知识库" : "Save your structured question outline and AI answer sheet assets to local database"}</p>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
              
              {/* Option Class 1: Export Mode Select */}
              <div className="space-y-1.5 font-sans">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                  {lang === "zh" ? "1. 选择导出问题树属性" : "1. Select Question Tree Export Properties"}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDownloadMode("only_questions")}
                    className={`p-3.5 rounded-lg border text-left cursor-pointer transition flex flex-col justify-between h-24 ${
                      downloadMode === "only_questions"
                        ? "border-indigo-600 bg-indigo-50/40 shadow-xs ring-1 ring-indigo-600"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-bold text-slate-900">{lang === "zh" ? "仅导出问题大纲" : "Export question outline only"}</span>
                      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                        downloadMode === "only_questions" ? "border-indigo-600 bg-indigo-600" : "border-slate-300"
                      }`}>
                        {downloadMode === "only_questions" && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-400 leading-normal">
                      {lang === "zh" ? "仅提取结构化提问树大纲层级目录 (.md 格式)，便于研究框架二次复用。" : "Extract only the structured question tree outline hierarchy (.md format), facilitating the secondary reuse of the research framework."}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDownloadMode("questions_and_answers")}
                    className={`p-3.5 rounded-lg border text-left cursor-pointer transition flex flex-col justify-between h-24 ${
                      downloadMode === "questions_and_answers"
                        ? "border-indigo-600 bg-indigo-50/40 shadow-xs ring-1 ring-indigo-600"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-bold text-slate-900">{lang === "zh" ? "导出大纲与答卷" : "Export outline and answers"}</span>
                      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                        downloadMode === "questions_and_answers" ? "border-indigo-600 bg-indigo-600" : "border-slate-300"
                      }`}>
                        {downloadMode === "questions_and_answers" && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-400 leading-normal">
                      {lang === "zh" ? "包含树大纲，以及每个疑问下 AI 撰写的详细解答内容与深度追问逻辑。" : "Includes both the question tree outline and the detailed AI answers/derivations for each topic."}
                    </span>
                  </button>
                </div>
              </div>

              {/* Toggle to include think-reasoning blocks */}
              {downloadMode === "questions_and_answers" && (
                <div className="bg-slate-50 border border-slate-200/60 rounded-lg p-3 flex items-start gap-2.5 font-sans transition-all duration-200">
                  <input
                    id="include-think-toggle"
                    type="checkbox"
                    checked={includeThink}
                    onChange={(e) => setIncludeThink(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 rounded border-slate-300 cursor-pointer mt-0.5"
                  />
                  <div className="flex flex-col select-none">
                    <label htmlFor="include-think-toggle" className="text-xs font-bold text-slate-800 cursor-pointer">
                      {lang === "zh" ? "包含 <think> 深度思考推理过程" : "Include think-reasoning process blocks"}
                    </label>
                    <span className="text-[10px] text-slate-400 leading-normal mt-0.5">
                      {lang === "zh" 
                        ? "勾选以在导出的 Markdown 答卷中保留 AI 引擎生成的思考与推理步骤。若取消勾选，仅导出最终干净的解答。"
                        : "Check to retain the AI-generated deep thoughts/reasoning logic (<think>...</think>) in the exported Markdown file. If unchecked, only final answers will be saved."
                      }
                    </span>
                  </div>
                </div>
              )}

              {/* Option Class 2: Selection Scope */}
              <div className="space-y-1.5 font-sans">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                  {lang === "zh" ? "2. 确定导出节点范围" : "2. Determine export node scope"}
                </label>
                <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setDownloadSelectionMode("all")}
                    className={`flex-1 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition ${
                      downloadSelectionMode === "all"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {lang === "zh" ? `全部节点导出 (${stats.total}个课题)` : `Export all nodes (${stats.total} topics)`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDownloadSelectionMode("custom")}
                    className={`flex-1 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition ${
                      downloadSelectionMode === "custom"
                        ? "bg-white text-indigo-600 shadow-2xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {lang === "zh" ? "自定义勾选节点" : "Customize selected nodes"}
                  </button>
                </div>
              </div>

              {/* Option Class 3: Recursive selection list tree */}
              {downloadSelectionMode === "custom" && (
                <div className="space-y-2 font-sans">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-medium">
                      {lang === "zh" ? `已选择: ${Object.values(selectedNodeIdsForExport).filter(Boolean).length} / ${stats.total} 个大纲节点` : `Selected: ${Object.values(selectedNodeIdsForExport).filter(Boolean).length} / ${stats.total} outline nodes`}
                    </span>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => handleSelectAllForExport(true)}
                        className="text-indigo-600 hover:underline font-semibold cursor-pointer"
                      >
                        {lang === "zh" ? "选择全部" : "Select all"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectAllForExport(false)}
                        className="text-slate-500 hover:underline font-semibold cursor-pointer"
                      >
                        {lang === "zh" ? "全部清除" : "Clear all"}
                      </button>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-lg p-2.5 max-h-56 overflow-y-auto bg-slate-50/50 space-y-1 scrollbar-thin">
                    {questions.map(rootNode => renderSelectionNode(rootNode, 0))}
                  </div>
                  <p className="text-[10px] text-slate-400 italic">{lang === "zh" ? "💡 提示：勾选或取消勾选父节点时，系统会自动同步选中或取消选中其所有层级的子节点。" : "💡 Tip: Checking or unchecking a parent node will automatically sync the selection for all its descendent nodes."}</p>
                </div>
              )}

            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-3.5 border-t border-slate-100 shrink-0 font-sans">
              <button
                type="button"
                onClick={() => setIsDownloadOpen(false)}
                className="px-3.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-600 hover:bg-slate-50 transition font-bold cursor-pointer"
              >
                {lang === "zh" ? "取消" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleExecuteDownload}
                className="px-4 py-1.5 bg-indigo-600 text-white rounded-md text-xs hover:bg-indigo-700 transition font-bold cursor-pointer shadow-xs flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{lang === "zh" ? "制作并下载问题树" : "Build & Export Question Tree"}</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 7. Customizable Import modal "导入你的财产" */}
      {isImportOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-lg w-full p-5 space-y-5 flex flex-col max-h-[90vh]">
            
            {/* Header section */}
            <div className="flex items-center gap-2 pb-2.5 border-b border-slate-100 shrink-0 font-sans">
              <div className="p-1 px-2 bg-indigo-50 rounded text-indigo-700">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{lang === "zh" ? "导入并融合问题树" : "Import & Merge Question Tree"}</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">{lang === "zh" ? "导入外部大纲，支持 Markdown (.md) 与 JSON (.json) 并提供智能层级去重合并" : "Import external outline files (.md or .json) and provide smart structural deduplication and merge"}</p>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
              
              {/* Option Class 1: Drag or select file */}
              <div className="space-y-1.5 font-sans">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                  {lang === "zh" ? "1. 上传问题树文件 / 粘贴内容" : "1. Upload Question Tree Files / Paste Layout Text"}
                </label>
                
                <div className="grid grid-cols-1 gap-3">
                  <div className="border border-dashed border-slate-200 hover:border-indigo-400 rounded-lg p-4 text-center cursor-pointer transition bg-slate-50/50 hover:bg-indigo-50/10 relative">
                    <input
                      type="file"
                      accept=".md,.json,text/plain"
                      onChange={handleImportFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1.5" />
                    <p className="text-xs font-bold text-slate-700">{lang === "zh" ? "点击或拖拽上传 .md / .json 相关问题树数据包" : "Click or drag to upload .md / .json Question Tree Bundle"}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{lang === "zh" ? "支持自创的大纲目录或带有答案的完整导出文件" : "Supports custom outlines or full exports with answers"}</p>
                  </div>

                  <div className="space-y-1 text-left">
                    <span className="text-[10px] text-slate-400 font-bold block">{lang === "zh" ? "或直接粘贴 Markdown 大纲 (如 `- 问题` 列表或 `### 问题` 标题) 或 JSON：" : "Or paste Markdown outline (e.g. `- Question` list or `### Question` headers) or JSON directly:"}</span>
                    <textarea
                      placeholder={lang === "zh" ? "在此处输入或粘贴大纲内容..." : "Enter or paste outline content here..."}
                      value={importText}
                      onChange={(e) => handleImportTextChange(e.target.value)}
                      className="w-full text-xs px-3 py-2.5 bg-white rounded-md border border-slate-200 focus:outline-none focus:border-indigo-500 text-slate-900 h-28 font-mono scrollbar-thin resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* Parsing status reporting */}
              <div className="font-sans">
                {parsedNodes.length > 0 ? (
                  <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg flex items-start gap-2 text-emerald-800 text-xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">{lang === "zh" ? "数据解析成功！" : "Data parsed successfully!"}</span>
                      <p className="text-[10px] text-emerald-600 mt-0.5">
                        {lang === "zh" ? <>系统在当前内容中识别并构建了 <strong className="font-bold text-emerald-800">{parsedStats}</strong> 个层级问题节点，已经就绪。</> : <>The system has identified and built <strong className="font-bold text-emerald-800">{parsedStats}</strong> hierarchical question nodes from the current content, and is ready.</>}
                      </p>
                    </div>
                  </div>
                ) : importError ? (
                  <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-rose-800 text-xs font-medium">
                    ⚠️ {importError}
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 border border-slate-200/50 rounded-lg text-[10px] text-slate-400 text-center italic">
                    {lang === "zh" ? "💡 请提供文件或粘贴文本，系统将对问题层级和关联解答进行分析。" : "💡 Please provide a file or paste text, and the system will analyze the question hierarchy and associated answers."}
                  </div>
                )}
              </div>

              {/* Option Class 2: Deduplication Method selection */}
              <div className="space-y-1.5 font-sans">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                  {lang === "zh" ? "2. 重复项冲突处理 (智能去重)" : "2. Duplicate collision handling (Smart deduplication)"}
                </label>
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 p-2.5 rounded-lg border text-left cursor-pointer transition ${
                    importStrategy === "merge_skip" ? "border-indigo-600 bg-indigo-50/30" : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}>
                    <input
                      type="radio"
                      name="import_strategy"
                      checked={importStrategy === "merge_skip"}
                      onChange={() => setImportStrategy("merge_skip")}
                      className="mt-1 w-4 h-4 text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">{lang === "zh" ? "智能合并 - 遇到重复则跳过其解答" : "Smart merge - Skip answers on duplicate"}</span>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-normal">
                        {lang === "zh" ? <>按层级树状结构合并相同名字的分支。如果同名问题在当前已有解答，<strong>将予以妥善保留，不予覆盖</strong>。</> : <>Merge branches with the same name according to the hierarchical tree structure. If a question with the same name already has an answer, <strong>it will be properly retained and not overwritten</strong>.</>}
                      </p>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 p-2.5 rounded-lg border text-left cursor-pointer transition ${
                    importStrategy === "merge_overwrite" ? "border-indigo-600 bg-indigo-50/30" : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}>
                    <input
                      type="radio"
                      name="import_strategy"
                      checked={importStrategy === "merge_overwrite"}
                      onChange={() => setImportStrategy("merge_overwrite")}
                      className="mt-1 w-4 h-4 text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">{lang === "zh" ? "智能合并 - 遇到重复则覆盖解答" : "Smart merge - Overwrite answers on duplicate"}</span>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-normal">
                        {lang === "zh" ? <>按层级树状结构合并相同名字的分支。如果导入的数据有新的解答，<strong>将直接覆盖更新</strong>当前本地相同的节点。</> : <>Merge branches with the same name according to the hierarchical tree structure. If the imported data has new answers, they will <strong>directly overwrite and update</strong> the current identical local node.</>}
                      </p>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 p-2.5 rounded-lg border text-left cursor-pointer transition ${
                    importStrategy === "append_all" ? "border-indigo-600 bg-indigo-50/30" : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}>
                    <input
                      type="radio"
                      name="import_strategy"
                      checked={importStrategy === "append_all"}
                      onChange={() => setImportStrategy("append_all")}
                      className="mt-1 w-4 h-4 text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">{lang === "zh" ? "直接追加到末尾 (保留两者)" : "Append directly to the end (Keep both)"}</span>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-normal">
                        {lang === "zh" ? "不进行任何同名问题查重，无损地将导入的文件全量作为全新节点依次排列挂载到本地大纲末尾。" : "Skip duplicate checking and losslessly append the imported file entirely as brand-new nodes sequentially mounted at the end of the local outline."}
                      </p>
                    </div>
                  </label>
                </div>
              </div>

            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-3.5 border-t border-slate-100 shrink-0 font-sans">
              <button
                type="button"
                onClick={() => setIsImportOpen(false)}
                className="px-3.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-600 hover:bg-slate-50 transition font-bold cursor-pointer"
              >
                {lang === "zh" ? "取消" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={parsedNodes.length === 0}
                className="px-4 py-1.5 bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md text-xs hover:bg-indigo-700 transition font-bold cursor-pointer shadow-xs flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{lang === "zh" ? "开始导入并融合问题树" : "Start Importing & Merging Question Tree"}</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 2. Custom Delete Confirmation Modal */}
      {deleteConfirmInfo.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4 font-sans animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100">
              <div className="p-1 px-2 bg-rose-50 rounded text-rose-700">
                <Trash2 className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">{lang === "zh" ? "确认删除提问节点" : "Confirm Delete Question Node"}</h3>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                {lang === "zh" ? "当前准备删除的提问为：" : "The question currently prepared for deletion is:"}
              </p>
              <div className="p-3 bg-slate-50 rounded-lg text-xs font-bold text-slate-800 break-all leading-relaxed border border-slate-100">
                "{deleteConfirmInfo.nodeText}"
              </div>

              {deleteConfirmInfo.hasChildren ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-rose-600 bg-rose-50/50 p-2.5 rounded border border-rose-100 leading-normal">
                     {lang === "zh" ? <>⚠️ 该提问节点下方还关联了<strong>子级衍生提问</strong>。请选择您希望如何组织或处置这些子级问题：</> : <>⚠️ There are <strong>derivative sub-questions</strong> associated under this question node. Please choose how you want to organize or dispose of these sub-questions:</>}
                  </p>
                  
                  <div className="grid grid-cols-1 gap-2.5 pt-1">
                    {/* Option 1: Delete only current, raise kids */}
                    <button
                      onClick={executeDeleteAndPromote}
                      className="w-full text-left p-3 rounded-lg border border-indigo-150 border-indigo-200 bg-indigo-50/35 hover:bg-indigo-50/70 hover:border-indigo-300 transition cursor-pointer group"
                    >
                      <span className="text-xs font-bold text-indigo-900 block group-hover:text-indigo-800">
                        {lang === "zh" ? "🛡️ 仅删父级，保留并提升子级" : "🛡️ Delete parent only, keep and promote children"}
                      </span>
                      <p className="text-[10px] text-slate-500 mt-0.5 leading-normal">
                        {lang === "zh" ? <>仅移除该节点本身，其所有直接子级提问将<strong>自动往上提升一级</strong>，平铺承接到该问题原先所在的树层级中。</> : <>Only remove this node itself, and all its direct sub-questions will <strong>automatically be promoted one level up</strong>, tiling directly into the tree level where this question originally resided.</>}
                      </p>
                    </button>

                    {/* Option 2: Recursive Delete everything */}
                    <button
                      onClick={executeDeleteRecursive}
                      className="w-full text-left p-3 rounded-lg border border-rose-150 border-rose-200 bg-rose-50/20 hover:bg-rose-50/70 hover:border-rose-300 transition cursor-pointer group"
                    >
                      <span className="text-xs font-bold text-rose-950 block group-hover:text-rose-800">
                        {lang === "zh" ? "🚀 连同所有子提问一并彻底清空" : "🚀 Completely wipe out along with all sub-questions"}
                      </span>
                      <p className="text-[10px] text-slate-500 mt-0.5 leading-normal">
                        {lang === "zh" ? <><strong>不留备份</strong>，连带当前节点之下的所有衍生层级子节点一并彻底抹除，恢复干净大纲。</> : <><strong>No backups kept</strong>, thoroughly erasing all derivative child nodes under the current node, restoring a clean outline.</>}
                      </p>
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  {lang === "zh" ? "此提问为末端叶子节点，不含子级信息，确认后将直接予以移除。" : "This question is a terminal leaf node and contains no sub-level information. Upon confirmation, it will be removed directly."}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2.5 border-t border-slate-100 shrink-0">
              <button
                onClick={() => setDeleteConfirmInfo({ isOpen: false, nodeId: "", nodeText: "", hasChildren: false })}
                className="px-3.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-600 hover:bg-slate-50 transition font-bold cursor-pointer"
              >
                {lang === "zh" ? "取消" : "Cancel"}
              </button>
              {!deleteConfirmInfo.hasChildren && (
                <button
                  onClick={executeDeleteRecursive}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-xs transition font-bold cursor-pointer shadow-xs"
                >
                  {lang === "zh" ? "确认删除" : "Confirm Delete"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. Custom Reset Confirmation Modal */}
      {resetConfirmOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-sm w-full p-5 space-y-4 font-sans animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-sm font-bold text-slate-900">{lang === "zh" ? "确认还原默认大纲？" : "Confirm restore default outline?"}</h3>
            <p className="text-xs text-slate-400 leading-normal">
              {lang === "zh" ? "确定要还原至默认的AI与绿色能源示例提问树吗？您当前自创或修改的内容都将会被覆盖，不可找回。" : "Are you sure you want to restore to the default AI and green energy example question tree? Your currently created or modified content will be overwritten and cannot be recovered."}
            </p>
            <div className="flex items-center justify-end gap-2 pt-1 font-sans">
              <button
                onClick={() => setResetConfirmOpen(false)}
                className="px-3.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                {lang === "zh" ? "取消" : "Cancel"}
              </button>
              <button
                onClick={executeResetToSamples}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs transition font-bold cursor-pointer"
              >
                {lang === "zh" ? "确认还原" : "Confirm Restore"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Custom Clear Confirmation Modal */}
      {clearConfirmOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-sm w-full p-5 space-y-4 font-sans animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-sm font-bold text-slate-900">{lang === "zh" ? "确认清空提问大纲树？" : "Confirm clear question outline tree?"}</h3>
            <p className="text-xs text-slate-400 leading-normal">
              {lang === "zh" ? "确定要移除所有提问和关联的解答大纲吗？这将提供一个全新的、完全空白的书写环境。" : "Are you sure you want to remove all questions and associated answer outlines? This will provide a brand-new, completely blank writing environment."}
            </p>
            <div className="flex items-center justify-end gap-2 pt-1 font-sans">
              <button
                onClick={() => setClearConfirmOpen(false)}
                className="px-3.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                {lang === "zh" ? "取消" : "Cancel"}
              </button>
              <button
                onClick={executeClearAll}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-xs transition font-bold cursor-pointer"
              >
                {lang === "zh" ? "全部清空" : "Clear All"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Toast Notifications in the Bottom-Right Corner */}
      <div id="corner-toast-container" className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 30, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="pointer-events-auto bg-white border border-slate-200/80 shadow-[0_10px_25px_rgba(0,0,0,0.08)] rounded-xl p-4 flex flex-col gap-2.5"
            >
              <div className="flex items-start gap-2.5 justify-between">
                <div className="flex gap-2.5 items-start">
                  <div className={`mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
                    toast.status === "completed" 
                      ? "bg-emerald-100 text-emerald-600" 
                      : "bg-rose-100 text-rose-600"
                  }`}>
                    {toast.status === "completed" ? (
                      <Check className="w-3 h-3 stroke-[3]" />
                    ) : (
                      <X className="w-3 h-3 stroke-[2]" />
                    )}
                  </div>
                  <div>
                    <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">
                      {toast.status === "completed" ? (lang === "zh" ? "解答生成成功" : "Answer generated successfully") : (lang === "zh" ? "解答生成失败" : "Answer generation failed")}
                    </h5>
                    <p className="text-xs text-slate-800 font-bold line-clamp-2 mt-0.5">
                      {toast.nodeText}
                    </p>
                    <p className="text-[10px] text-slate-500 leading-tight mt-0.5">{toast.message}</p>
                  </div>
                </div>
                <button
                  onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                  className="text-slate-400 hover:text-slate-600 p-0.5 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              {toast.status === "completed" && (
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-2 shrink-0">
                  <button
                    onClick={() => {
                      // Select this node so they can view the result!
                      setSelectedNodeId(toast.nodeId);
                      // Force Active tab to Tree view on mobile
                      setActiveTab("tree");
                      // Remove toast
                      setToasts(prev => prev.filter(t => t.id !== toast.id));
                    }}
                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-semibold rounded-md transition-colors cursor-pointer"
                  >
                    {lang === "zh" ? "查看详情" : "View details"}
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        

      </div>

    </div>
  );
}
