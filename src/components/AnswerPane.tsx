import React, { useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import "katex/dist/katex.min.css";
import { makeMarkdownHeadingsCollapsible, parseThinkAndContent, parseAnswersByLanguage } from "./TreeHelper";
import { 
  Sparkles, 
  BookOpen, 
  PenTool, 
  Wand2, 
  Plus, 
  Lightbulb, 
  Loader2, 
  Check, 
  FileEdit, 
  TrendingUp, 
  HelpCircle,
  Clock,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy
} from "lucide-react";
import { QuestionNode, AISuggestion } from "../types";

interface AnswerPaneProps {
  selectedNode: QuestionNode | null;
  nodePath: { id: string; name: string }[] | null;
  onUpdateAnswer: (id: string, newAnswer: string) => void;
  onAddChild: (parentId: string, text: string, selectedText?: string, enText?: string, autoSelect?: boolean) => void;
  globalBackgroundTasks?: Record<string, any>;
  onTriggerAIDeepAnswer?: (id: string) => void;
  onNavigateToNode?: (id: string) => void;
  displayLanguage?: string;
  onAddRootNode?: (text: string) => void;
  onClose?: () => void;
  siblingPrev?: { id: string; name: string } | null;
  siblingNext?: { id: string; name: string } | null;
}

export const AnswerPane: React.FC<AnswerPaneProps> = ({
  selectedNode,
  nodePath,
  onUpdateAnswer,
  onAddChild,
  globalBackgroundTasks,
  onTriggerAIDeepAnswer,
  onNavigateToNode,
  displayLanguage = "zh",
  onAddRootNode,
  onClose,
  siblingPrev = null,
  siblingNext = null,
}) => {
  const [foldHeadings, setFoldHeadings] = useState(() => {
    try {
      const saved = localStorage.getItem("qa_fold_headings");
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });
  const [allOpenState, setAllOpenState] = useState<"default_open" | "all_open" | "all_closed">(() => {
    try {
      const saved = localStorage.getItem("qa_all_open_state");
      return saved ? (saved as "default_open" | "all_open" | "all_closed") : "default_open";
    } catch {
      return "default_open";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("qa_fold_headings", JSON.stringify(foldHeadings));
    } catch (e) {}
  }, [foldHeadings]);

  useEffect(() => {
    try {
      localStorage.setItem("qa_all_open_state", allOpenState);
    } catch (e) {}
  }, [allOpenState]);
  
  // Tracking maps of generating states per node ID to support multi-node async processing
  const [generatingSuggestionsIds, setGeneratingSuggestionsIds] = useState<Record<string, boolean>>({});
  
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopyAnswer = async () => {
    const answer = selectedNode?.answer || "";
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.warn("Failed to copy answer text: ", err);
    }
  };

  // Text Selection / Sub-question answering states
  const [selectedText, setSelectedText] = useState("");
  const [subQuestionInput, setSubQuestionInput] = useState("");
  const [shouldAutoAnswerNextNode, setShouldAutoAnswerNextNode] = useState(false);
  const [launchpadText, setLaunchpadText] = useState("");

  // Automatically update input box text if displayLanguage changes while a word is highlighted
  useEffect(() => {
    if (!selectedText) return;

    const zhTemplates = [
      `什么是「${selectedText}」？`,
      `剖析「${selectedText}」的原理`,
      `「${selectedText}」的应用`
    ];
    const enTemplates = [
      `What is "${selectedText}"?`,
      `Analyze principles of "${selectedText}"`,
      `Applications of "${selectedText}"`
    ];

    if (displayLanguage === "en") {
      if (!subQuestionInput || subQuestionInput === zhTemplates[0]) {
        setSubQuestionInput(enTemplates[0]);
      } else if (subQuestionInput === zhTemplates[1]) {
        setSubQuestionInput(enTemplates[1]);
      } else if (subQuestionInput === zhTemplates[2]) {
        setSubQuestionInput(enTemplates[2]);
      }
    } else {
      if (!subQuestionInput || subQuestionInput === enTemplates[0]) {
        setSubQuestionInput(zhTemplates[0]);
      } else if (subQuestionInput === enTemplates[1]) {
        setSubQuestionInput(zhTemplates[1]);
      } else if (subQuestionInput === enTemplates[2]) {
        setSubQuestionInput(zhTemplates[2]);
      }
    }
  }, [displayLanguage, selectedText]);

  // Keep track of the currently selected node ID using a ref to prevent race conditions during updates from async calls
  const selectedNodeIdRef = useRef(selectedNode?.id);
  useEffect(() => {
    selectedNodeIdRef.current = selectedNode?.id;
  }, [selectedNode?.id]);

  // Reactive Mobile & Collapsible layout state for optimal space utilization on small viewports
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 768 : false);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(() => typeof window !== "undefined" ? window.innerWidth < 768 : true);
  const [isActionsCollapsed, setIsActionsCollapsed] = useState(() => typeof window !== "undefined" ? window.innerWidth < 768 : true);

  useEffect(() => {
    const handleResize = () => {
      const mobileStatus = window.innerWidth < 768;
      setIsMobile(mobileStatus);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Scroll Position Persistence Refs & Effects
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const markdownContainerRef = useRef<HTMLDivElement>(null);

  // Restore and persist fold toggle states
  useEffect(() => {
    if (!selectedNode || !markdownContainerRef.current) return;
    const container = markdownContainerRef.current;
    const nodeStateKey = "qa_fold_state_" + selectedNode.id;
    
    const getSavedStates = () => {
      try {
        const str = localStorage.getItem(nodeStateKey);
        return str ? JSON.parse(str) : {};
      } catch {
        return {};
      }
    };
    
    const setSavedStates = (states: any) => {
      try {
        localStorage.setItem(nodeStateKey, JSON.stringify(states));
      } catch {}
    };

    // Use timeout to ensure markdown DOM has been fully flushed/rendered
    const timer = setTimeout(() => {
      const detailsElements = container.querySelectorAll<HTMLDetailsElement>('details');
      const savedStates = getSavedStates();
      
      detailsElements.forEach((el, index) => {
        const elKey = `detail_idx_${index}`;
        
        // Restore State
        if (savedStates[elKey] !== undefined) {
          if (savedStates[elKey]) {
            el.setAttribute("open", "true");
          } else {
            el.removeAttribute("open");
          }
        }

        // Attach listeners to track toggling
        const handleToggle = () => {
          const currentStates = getSavedStates();
          currentStates[elKey] = el.hasAttribute("open");
          setSavedStates(currentStates);
        };
        el.addEventListener("toggle", handleToggle);
        (el as any)._qaToggleHandler = handleToggle;
      });
    }, 50);

    return () => {
      clearTimeout(timer);
      const detailsElements = container.querySelectorAll<HTMLDetailsElement>('details');
      detailsElements.forEach((el) => {
        if ((el as any)._qaToggleHandler) {
          el.removeEventListener("toggle", (el as any)._qaToggleHandler);
        }
      });
    };
  }, [selectedNode?.id, selectedNode?.answer, foldHeadings]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("qa_scroll_positions");
      if (saved) {
        scrollPositionsRef.current = JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Could not load scroll positions", e);
    }
  }, []);

  const handleScroll = () => {
    if (scrollContainerRef.current && selectedNode) {
      scrollPositionsRef.current[selectedNode.id] = scrollContainerRef.current.scrollTop;
      try {
        localStorage.setItem("qa_scroll_positions", JSON.stringify(scrollPositionsRef.current));
      } catch (e) {
        // Ignore quota limits for scroll positions
      }
    }
  };

  // Restore scroll when switching nodes
  useEffect(() => {
    if (selectedNode) {
      const targetId = selectedNode.id;
      const savedPosition = scrollPositionsRef.current[targetId] || 0;
      
      const restoreScroll = () => {
        if (scrollContainerRef.current && selectedNodeIdRef.current === targetId) {
          scrollContainerRef.current.scrollTop = savedPosition;
        }
      };

      // Restore immediately, then double RAF, then timeout to guarantee layout finished painting
      restoreScroll();
      const rafId1 = requestAnimationFrame(() => {
        restoreScroll();
        const rafId2 = requestAnimationFrame(() => {
          restoreScroll();
        });
      });
      const timeoutId = setTimeout(restoreScroll, 50);

      return () => {
        cancelAnimationFrame(rafId1);
        clearTimeout(timeoutId);
      };
    }
  }, [selectedNode?.id]);

  // Derive active loading stats for currently selected node
  const activeBackgroundTask = (selectedNode && globalBackgroundTasks) 
    ? globalBackgroundTasks[selectedNode.id] 
    : null;

  const isGeneratingAnswer = activeBackgroundTask 
    ? activeBackgroundTask.status === "running"
    : false;

  const isGeneratingSuggestions = selectedNode ? !!generatingSuggestionsIds[selectedNode.id] : false;

  // Derive stage and progress metrics from active background task, falling back to local defaults if idle
  const answeringStage = activeBackgroundTask ? activeBackgroundTask.stage : 0;
  const answeringPercent = activeBackgroundTask ? activeBackgroundTask.percent : 0;
  const elapsedSeconds = activeBackgroundTask ? activeBackgroundTask.elapsedSeconds : 0.0;

  // Keep draft text and editor state synchronized ONLY when selected node ID changes
  useEffect(() => {
    if (selectedNode) {
      setAiSuggestions([]);
      setApiError(null);
      setSelectedText(""); // Reset selected text on node switch
    }
  }, [selectedNode?.id]);

  // Listen to shouldAutoAnswerNextNode for newly created sub-questions
  useEffect(() => {
    if (selectedNode && shouldAutoAnswerNextNode && (!selectedNode.answer || selectedNode.answer.trim() === "")) {
      setShouldAutoAnswerNextNode(false);
      triggerAIDeepAnswer();
    }
  }, [selectedNode?.id, shouldAutoAnswerNextNode]);

  // Handler for text selections in preview mode
  const handleSelection = () => {
    // Add small timeout so the selection API updates correctly on touch devices
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      // Enable sub-question trigger for sensible lengths
      if (text.length > 1 && text.length < 150) {
        setSelectedText(text);
        setSubQuestionInput(displayLanguage === "zh" ? `什么是「${text}」？` : `What is "${text}"?`);
      }
    }, 80);
  };

  if (!selectedNode) {
    const templates = [
      {
        category: displayLanguage === "zh" ? "🔬 前沿科创" : "🔬 Tech Frontier",
        text: displayLanguage === "zh" 
          ? "如何通过新型碳捕集技术与微藻培养结合降低工业二氧化碳排放？探索其生物降解机制与合成工艺瓶颈。" 
          : "How to combine novel carbon capture tech with microalgae cultivation to reduce carbon emissions?",
        desc: displayLanguage === "zh" ? "碳中和与新能源技术路线探索" : "In carbon neutrality & green energy trajectories"
      },
      {
        category: displayLanguage === "zh" ? "⏳ 人文哲思" : "⏳ Philosophy",
        text: displayLanguage === "zh" 
          ? "人工智能艺术创作对人类独特性艺术感知的深远影响与重构？" 
          : "The profound impact and restructuring of AI artistic creation on unique human artistic perception?",
        desc: displayLanguage === "zh" ? "探讨科技变革下的现代人类本质" : "Exploring human essence under tech transformations"
      },
      {
        category: displayLanguage === "zh" ? "📊 商业战略" : "📊 Biz Strategy",
        text: displayLanguage === "zh" 
          ? "在去中心化创作者经济中，如何构建一个零抽佣的问题树确权平台与生态激励模型？" 
          : "How to design a zero-commission digital asset licensing platform in the decentralized creator economy?",
        desc: displayLanguage === "zh" ? "去中心化架构与生态激励模型" : "Decentralized architecture & incentive models"
      },
      {
        category: displayLanguage === "zh" ? "💻 极客探索" : "💻 Deep Tech",
        text: displayLanguage === "zh" 
          ? "如何构建一个支持实时热拔插插件和基于 WASM 的沙箱运行时分布式计算引擎？" 
          : "How to construct a distributed engine supporting real-time pluggable modules based on WASM sandbox runtimes?",
        desc: displayLanguage === "zh" ? "探索现代运行时计算架构与指令集优化" : "Modern system runtimes & architecture"
      }
    ];

    const handleLaunchpadClickSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!launchpadText.trim()) return;
      if (onAddRootNode) {
        onAddRootNode(launchpadText.trim());
        setLaunchpadText("");
      }
    };

    return (
      <div className="h-full flex flex-col justify-start overflow-y-auto p-5 md:p-8 bg-slate-50/50 rounded-xl border border-slate-200/60 font-sans space-y-6 no-scrollbar">
        {/* Onboarding Welcome Header Card */}
        <div className="p-6 md:p-8 bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 rounded-2xl shadow-md border border-indigo-950 text-white relative overflow-hidden shrink-0">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-8 -left-8 w-48 h-48 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
          
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6 z-10">
            <div className="space-y-2 max-w-xl">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-400/20 text-indigo-300 text-[10px] font-bold uppercase tracking-wider">
                <Sparkles className="w-3 h-3 text-indigo-400 animate-pulse" />
                <span>{displayLanguage === "zh" ? "核心科研星盘发射台" : "Core Question Launchpad"}</span>
              </div>
              <h3 className="text-xl md:text-2xl font-bold tracking-tight text-white font-sans">
                {displayLanguage === "zh" ? "如何开启您的一门全新探索课题？" : "How to launch your new research?"}
              </h3>
              <p className="text-xs md:text-sm text-indigo-200/80 leading-relaxed font-medium">
                {displayLanguage === "zh" 
                  ? "一切关系探索星盘，皆衍生自一个强大的“母问题”。提出您最核心的课题，让系统以此自上而下衍生整颗逻辑问题树。" 
                  : "Every relationship astrolabe derives from a foundational 'Mother Question'. Frame your core concept here to automatically expand a multi-level question tree."
                }
              </p>
            </div>
          </div>
        </div>

        {/* Core Input Bar Section */}
        <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200/70 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <PenTool className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                {displayLanguage === "zh" ? "创建您的核心母疑问" : "Define Core Mother Question"}
              </h4>
              <p className="text-[10px] text-slate-400">
                {displayLanguage === "zh" ? "输入一个核心母课题或大纲主题，回车或点击下方一键衍生" : "Enter a core topic or outline, hit enter or click the button below to generate"}
              </p>
            </div>
          </div>

          <form onSubmit={handleLaunchpadClickSubmit} className="space-y-3.5">
            <div className="relative">
              <textarea
                rows={3}
                placeholder={displayLanguage === "zh" 
                  ? "提出一门课题的核心母提问，例如：「如何利用可降解高分子降低微塑料污染？探索其生物降解机制与合成工艺瓶颈」..." 
                  : "Input your core mother question here, e.g. 'How to use biodegradable polymers to reduce microplastic pollution? Explore biodegradation mechanisms'..."
                }
                value={launchpadText}
                onChange={(e) => setLaunchpadText(e.target.value)}
                className="w-full text-xs md:text-sm px-4 py-3 bg-slate-50/50 text-slate-900 rounded-xl border border-slate-200 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/25 transition placeholder-slate-400 font-sans resize-none"
              />
              {launchpadText && (
                <button
                  type="button"
                  onClick={() => setLaunchpadText("")}
                  className="absolute right-3.5 top-3.5 p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <span className="text-[10px] text-indigo-600 font-medium flex items-center gap-1.5 bg-indigo-50/80 px-2.5 py-1 rounded-full border border-indigo-100/50 self-start">
                <Wand2 className="w-3 h-3 text-indigo-500" />
                <span>{displayLanguage === "zh" ? "支持手写大纲或一键调遣 AI 深度拓展衍生解答" : "Supports manual editing or one-click AI deduction and answers"}</span>
              </span>

              <button
                type="submit"
                disabled={!launchpadText.trim()}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs transition-all shadow-sm active:scale-98 flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>{displayLanguage === "zh" ? "一键开启课题衍生" : "Launch Research Topic"}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Templates Prompt Grid */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-slate-700">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            <h4 className="text-xs font-bold uppercase tracking-wider">
              {displayLanguage === "zh" ? "💡 灵感涌现：精选科研与分析大纲模板" : "💡 Inspirations: Selected Research Templates"}
            </h4>
          </div>
          <p className="text-[10px] text-slate-400 -mt-1">
            {displayLanguage === "zh" ? "点击下方精选卡片，可直接将核心母疑问载入上方，快速体验完整的全级决策脑系统极速解构功力：" : "Click any card below to load a professionally constructed core question into the scratchpad immediately:"}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
            {templates.map((tmpl, idx) => (
              <div 
                key={idx}
                onClick={() => setLaunchpadText(tmpl.text)}
                className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-200 flex flex-col justify-between space-y-2 shadow-3xs ${
                  launchpadText === tmpl.text
                    ? "bg-indigo-50/40 border-indigo-400/80 ring-1 ring-indigo-400/20"
                    : "bg-white hover:bg-indigo-50/20 border-slate-200/80 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-bold px-2.5 py-0.5 rounded-full font-sans bg-slate-100 text-slate-600 border border-slate-200/50">
                    {tmpl.category}
                  </span>
                  <span className="text-[8px] text-indigo-500 font-bold uppercase tracking-wider">
                    {displayLanguage === "zh" ? "即刻使用" : "Use this"} →
                  </span>
                </div>
                <p className="text-xs text-slate-800 font-medium leading-relaxed line-clamp-2">
                  {"“" + tmpl.text + "”"}
                </p>
                <p className="text-[9px] text-slate-400 font-mono italic">
                  {tmpl.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Dynamic Instructional Visual Aid */}
        <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 text-left shrink-0">
          <div className="space-y-1">
            <h5 className="text-[11px] font-bold text-slate-700">
              {displayLanguage === "zh" ? "🛸 分形思考星轴：如何无限向下解构？" : "🛸 Fractal Thinking Orbit: How to Deconstruct?"}
            </h5>
            <p className="text-[10px] text-slate-500 leading-normal max-w-xl">
              {displayLanguage === "zh" 
                ? "创建一个母问题后，您可以随意选择它，并利用解答面板中的「衍生子问题」或在答案Markdown中高亮文字并点击「➕以此衍生」即可自上而下不断精细解构。每一层级都支持多线程并行回答。" 
                : "Once you create a mother question, select it and use the 'Sub-questions' function, or drag-highlight any text inside its answer markdown and click '➕ spawn sub-question' to deconstruct forever."
              }
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Helper to construct headers with optional custom LLM configuration from localStorage
  const getHeaders = () => {
    const provider = localStorage.getItem("llm_provider") || "gemini";
    const apiKey = localStorage.getItem("llm_api_key") || localStorage.getItem("minimax_api_key") || "";
    const baseUrl = localStorage.getItem("llm_base_url") || "";
    const model = localStorage.getItem("llm_model") || "";

    const headers: Record<string, string> = { 
      "Content-Type": "application/json",
      "x-llm-provider": provider
    };
    if (apiKey.trim()) {
      headers["x-llm-api-key"] = apiKey.trim();
    }
    if (baseUrl.trim()) {
      headers["x-llm-base-url"] = baseUrl.trim();
    }
    if (model.trim()) {
      headers["x-llm-model"] = model.trim();
    }
    return headers;
  };

  // 1. Call API to get AI Deep Answer (delegated to parent for robust background running)
  const triggerAIDeepAnswer = async () => {
    if (!selectedNode) return;
    setApiError(null);
    if (onTriggerAIDeepAnswer) {
      onTriggerAIDeepAnswer(selectedNode.id);
    }
  };

  // 2. Call API to suggest downstream child questions
  const triggerAISuggestions = async () => {
    if (!selectedNode) return;
    const targetNodeId = selectedNode.id;
    setGeneratingSuggestionsIds(prev => ({ ...prev, [targetNodeId]: true }));
    setApiError(null);
    if (selectedNodeIdRef.current === targetNodeId) {
      setAiSuggestions([]);
    }
    try {
      const response = await fetch("/api/gemini/suggest-children", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          text: selectedNode.text,
          context: nodePath || [],
          lang: displayLanguage,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text() || (displayLanguage === "zh" ? "AI 接口请求失败" : "AI API request failed"));
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      
      if (selectedNodeIdRef.current === targetNodeId) {
        setAiSuggestions(data.suggestions || []);
      }
    } catch (err: any) {
      console.error(err);
      if (selectedNodeIdRef.current === targetNodeId) {
        const activeProvider = (localStorage.getItem("llm_provider") || "gemini").toUpperCase();
        setApiError(err.message || (displayLanguage === "zh" ? `未能调用 AI 启发式子提问，请确保配置了 ${activeProvider}_API_KEY 密钥。` : `Failed to call AI heuristic sub-question, please ensure ${activeProvider}_API_KEY is configured.`));
      }
    } finally {
      setGeneratingSuggestionsIds(prev => {
         const updated = { ...prev };
         delete updated[targetNodeId];
         return updated;
      });
    }
  };

  const handleAddSuggestedChild = (suggestion: AISuggestion) => {
    onAddChild(selectedNode.id, suggestion.text, undefined, suggestion.en_text, false);
    // Remove the added suggestion from list
    setAiSuggestions(prev => prev.filter(item => item.text !== suggestion.text));
  };

  return (
    <div className="h-full flex flex-col bg-white rounded border border-slate-200 shadow-2xs overflow-hidden">
      
      {/* 1. Header: Path Trace and Title */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 shrink-0 md:px-5 md:py-4">
        {/* Mobile-only quick collapse toggle header */}
        <div className="flex md:hidden items-center justify-between gap-2 cursor-pointer select-none" onClick={() => setIsHeaderCollapsed(!isHeaderCollapsed)}>
          <div className="flex items-center gap-1.5 min-w-0">
            {onClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="flex items-center gap-1.5 text-[11px] text-slate-600 font-bold hover:text-slate-900 bg-slate-200/60 hover:bg-slate-200 px-2 py-1.5 rounded-lg border border-slate-300/50 transition-all shrink-0 active:scale-95"
              >
                <X className="w-3.5 h-3.5" />
                <span>{displayLanguage === "zh" ? "返回" : "Back"}</span>
              </button>
            )}
            <span className="text-xs font-bold text-slate-800">
              {displayLanguage === "en" && selectedNode.en_text ? selectedNode.en_text : selectedNode.text}
            </span>
          </div>
          <button className="p-1 hover:bg-slate-200/40 rounded text-slate-500 shrink-0 transition-transform">
            <ChevronDown className={`w-4 h-4 transition-transform duration-250 ${isHeaderCollapsed ? "" : "rotate-180"}`} />
          </button>
        </div>

        {/* Dense Collapsible Detail Panel - Expanded on desktop, toggle-controlled on mobile */}
        <div className={`transition-all duration-350 overflow-hidden ${isHeaderCollapsed ? "hidden md:block" : "block mt-2"}`}>
          <div className="flex items-center justify-between gap-4 mb-2">
            {/* Breadcrumb Path Context */}
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium overflow-x-auto no-scrollbar whitespace-nowrap uppercase tracking-wider">
              {onClose && (
                <button
                  onClick={onClose}
                  className="hidden md:flex items-center gap-1 text-[11px] text-slate-600 font-bold hover:text-slate-900 bg-slate-200/60 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-300/50 transition-all mr-2 cursor-pointer active:scale-95 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{displayLanguage === "zh" ? "返回大纲" : "Back to Outline"}</span>
                </button>
              )}
              <span>{displayLanguage === "zh" ? "问题定位" : "Navigation"}</span>
              {nodePath && nodePath.map((segment, index) => (
                <React.Fragment key={index}>
                  <span className="text-slate-300">/</span>
                  <button
                    onClick={() => onNavigateToNode && onNavigateToNode(segment.id)}
                    className="max-w-[120px] truncate hover:text-indigo-600 hover:underline cursor-pointer"
                    title={segment.name}
                  >
                    {segment.name}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {/* Autosafe Glow Bullet */}
            <div className="flex items-center gap-1.5">
            </div>
          </div>

          {/* Selected Node Primary Heading and Sibling Navigation Buttons */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-2 pt-1">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h2 className="text-base md:text-lg font-bold text-slate-900 md:leading-relaxed">
                {displayLanguage === "en" && selectedNode.en_text ? selectedNode.en_text : selectedNode.text}
              </h2>
            </div>

            {/* Sibling navigation with name hover revealing effect */}
            <div className="flex items-center gap-2 shrink-0">
              {siblingPrev && (
                <button
                  onClick={() => onNavigateToNode && onNavigateToNode(siblingPrev.id)}
                  className="group flex items-center justify-center h-8 px-2 bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 rounded border border-slate-200 transition-all duration-350 cursor-pointer active:scale-95 text-xs font-semibold"
                  title={displayLanguage === "en" ? `Prev: ${siblingPrev.name}` : `上一个: ${siblingPrev.name}`}
                >
                  <ChevronLeft className="w-4 h-4 shrink-0 stroke-[2.5]" />
                  <span className="inline-block max-w-0 overflow-hidden whitespace-nowrap opacity-0 group-hover:max-w-[140px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-350 ease-out">
                    {siblingPrev.name}
                  </span>
                </button>
              )}

              {siblingNext && (
                <button
                  onClick={() => onNavigateToNode && onNavigateToNode(siblingNext.id)}
                  className="group flex items-center justify-center h-8 px-2 bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 rounded border border-slate-200 transition-all duration-350 cursor-pointer active:scale-95 text-xs font-semibold"
                  title={displayLanguage === "en" ? `Next: ${siblingNext.name}` : `下一个: ${siblingNext.name}`}
                >
                  <span className="inline-block max-w-0 overflow-hidden whitespace-nowrap opacity-0 group-hover:max-w-[140px] group-hover:opacity-100 group-hover:mr-1.5 transition-all duration-350 ease-out">
                    {siblingNext.name}
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0 stroke-[2.5]" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls folded from second div */}
        <div className="mt-2.5 pt-2.5 border-t border-slate-200/80">
          
          {/* Mobile Quick Switcher Bar */}
          <div className="flex md:hidden items-center justify-between gap-2.5 w-full">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-700">📖 {displayLanguage === "zh" ? "排版预览" : "Preview"}</span>
            </div>

            <button
              onClick={() => setIsActionsCollapsed(!isActionsCollapsed)}
              className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 rounded-sm text-[10.5px] font-bold transition active:scale-98"
            >
              <Sparkles className="w-3 h-3 text-indigo-600 animate-pulse" />
              <span>{displayLanguage === "zh" ? "智能与排版选项" : "Intelligence & Format Options"}</span>
              <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isActionsCollapsed ? "" : "rotate-180"}`} />
            </button>
          </div>

          {/* Fully Collapsible Action Pane - Hidden on mobile by default, fully visible on widescreen */}
          <div className={`transition-all duration-350 overflow-hidden ${isActionsCollapsed ? "hidden md:flex md:flex-row md:items-center md:justify-between md:gap-3" : "flex flex-col gap-3 mt-3 md:mt-0 md:flex-row md:items-center md:justify-between"}`}>
            
            {/* Tab switch between preview / edit, plus dynamic folding toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {selectedNode.answer && selectedNode.answer.trim().length > 0 && (
                <div className="group flex items-center bg-slate-50 border border-slate-200/60 p-1.5 rounded-sm select-none transition-all duration-300 max-w-[36px] hover:max-w-[320px] overflow-hidden shrink-0">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer whitespace-nowrap shrink-0">
                    <input
                      type="checkbox"
                      checked={foldHeadings}
                      onChange={(e) => {
                        setFoldHeadings(e.target.checked);
                        if (!e.target.checked) {
                          setAllOpenState("default_open");
                        }
                      }}
                      className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer shrink-0"
                    />
                    <span className="flex items-center gap-0.5 max-w-0 overflow-hidden opacity-0 group-hover:max-w-[120px] group-hover:opacity-100 group-hover:ml-1 transition-all duration-300 ease-out shrink-0">
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 stroke-[2.5] shrink-0" />
                      {displayLanguage === "zh" ? "自动段落折叠" : "Auto Fold Headings"}
                    </span>
                  </label>

                  {foldHeadings && (
                    <div className="flex items-center gap-1.5 border-l border-slate-200 pl-2 ml-1 text-[10.5px] max-w-0 overflow-hidden opacity-0 group-hover:max-w-[150px] group-hover:opacity-100 transition-all duration-300 ease-out shrink-0 whitespace-nowrap">
                      <button
                        onClick={() => setAllOpenState("all_open")}
                        className={`px-1.5 py-0.5 rounded-sm font-bold text-indigo-600 hover:bg-indigo-50 cursor-pointer transition-colors ${
                          allOpenState === "all_open" ? "bg-indigo-50/70" : ""
                        }`}
                        title={displayLanguage === "zh" ? "一键展开该篇答案内的所有章节段落" : "Expand all chapters and paragraphs in this answer"}
                      >
                        {displayLanguage === "zh" ? "全部展开" : "Expand All"}
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        onClick={() => setAllOpenState("all_closed")}
                        className={`px-1.5 py-0.5 rounded-sm font-bold text-slate-500 hover:bg-slate-100 cursor-pointer transition-colors ${
                          allOpenState === "all_closed" ? "bg-slate-100" : ""
                        }`}
                        title={displayLanguage === "zh" ? "一键折叠收拢该篇答案内的所有章节段落" : "Collapse all chapters and paragraphs in this answer"}
                      >
                        {displayLanguage === "zh" ? "全部折叠" : "Collapse All"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Gemini Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <button
                onClick={triggerAIDeepAnswer}
                disabled={isGeneratingAnswer}
                className="group flex items-center justify-center px-2.5 py-2 md:py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 disabled:opacity-50 rounded-xs text-xs font-bold transition duration-300 active:scale-95 shadow-2xs cursor-pointer gemini-action-btn"
                title={displayLanguage === "zh" ? "使用 AI 生成本疑问的深度解答" : "Use AI to generate in-depth answer for this question"}
              >
                {isGeneratingAnswer ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="inline-block max-w-0 overflow-hidden whitespace-nowrap opacity-0 group-hover:max-w-[120px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out">
                  {displayLanguage === "zh" ? "AI 自动解答" : "AI Auto Answer"}
                </span>
              </button>

              <button
                onClick={triggerAISuggestions}
                disabled={isGeneratingSuggestions}
                className="group flex items-center justify-center px-2.5 py-2 md:py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xs text-xs font-bold transition duration-300 active:scale-95 cursor-pointer gemini-action-btn"
                title={displayLanguage === "zh" ? "生成适合展开的下级层级深度子疑问" : "Generate suitable next-level child questions for expansion"}
              >
                {isGeneratingSuggestions ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                ) : (
                  <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="inline-block max-w-0 overflow-hidden whitespace-nowrap opacity-0 group-hover:max-w-[120px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out">
                  {displayLanguage === "zh" ? "AI 启发子提问" : "AI Heuristic Children"}
                </span>
              </button>

              <button
                type="button"
                onClick={handleCopyAnswer}
                disabled={!selectedNode.answer || selectedNode.answer.trim().length === 0}
                className="group flex items-center justify-center px-2.5 py-2 md:py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xs text-xs font-bold transition duration-300 active:scale-95 cursor-pointer gemini-action-btn"
                title={
                  isCopied 
                    ? (displayLanguage === "zh" ? "已复制解答内容！" : "Copied!") 
                    : (displayLanguage === "zh" ? "一键复制完整解答" : "Copy entire answer")
                }
              >
                {isCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                    <span className="inline-block max-w-0 overflow-hidden whitespace-nowrap opacity-0 group-hover:max-w-[100px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out">
                      {displayLanguage === "zh" ? "已复制" : "Copied"}
                    </span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 shrink-0" />
                    <span className="inline-block max-w-0 overflow-hidden whitespace-nowrap opacity-0 group-hover:max-w-[100px] group-hover:opacity-100 group-hover:ml-1.5 transition-all duration-300 ease-out">
                      {displayLanguage === "zh" ? "复制解答" : "Copy"}
                    </span>
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* 3. Primary Workspace Area (Scrollable body) */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-5 space-y-5 bg-white relative"
      >
        
        {/* Error Bar */}
        {apiError && (
          <div className="p-3.5 bg-rose-50 text-rose-800 border border-rose-200 text-xs rounded-sm flex items-start gap-2">
            <span className="font-bold shrink-0 mt-0.5">⚠️ API 提示:</span>
            <div className="flex-1 leading-normal">
              {apiError}
              <p className="mt-1 text-rose-500 font-mono">
                请确保您已经在 AI Studio 的 Settings &gt; Secrets 面板内配置了对应且健康的 API Key 密钥。
              </p>
            </div>
          </div>
        )}

        {/* Content Box */}
        {isGeneratingAnswer ? (
          <div className="bg-gradient-to-br from-indigo-50/40 via-slate-50 to-indigo-50/10 border border-indigo-100 rounded-lg p-6 shadow-sm space-y-5 animate-in fade-in duration-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-300 ${
                  answeringStage >= 6 
                    ? "bg-emerald-100 text-emerald-600 animate-none" 
                    : "bg-indigo-100 text-indigo-600 animate-pulse"
                }`}>
                  {answeringStage >= 6 ? (
                    <Check className="w-4 h-4 stroke-[3]" />
                  ) : (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    {displayLanguage === "zh" 
                      ? (answeringStage >= 6 ? "解答生成成功！正在写入视图" : "正在通过 AI 引擎生成解答")
                      : (answeringStage >= 6 ? "Answer generated successfully! Writing to view" : "Generating answer via AI engine...")
                    }
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium">
                    {displayLanguage === "zh"
                      ? (answeringStage >= 6 ? "所有排版流程已完成" : "请稍候，解答将自动排版并更新本节点")
                      : (answeringStage >= 6 ? "Formatting completed" : "Please wait, the answer will be formatted and updated automatically")
                    }
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className={`text-md font-mono font-bold transition-colors duration-300 ${
                  answeringStage >= 6 ? "text-emerald-600" : "text-indigo-600"
                }`}>
                  {answeringPercent}%
                </span>
                <p className="text-[10px] text-slate-400 font-medium font-mono">
                  {displayLanguage === "zh" ? `已耗时 ${elapsedSeconds.toFixed(1)}s` : `Elapsed: ${elapsedSeconds.toFixed(1)}s`}
                </p>
              </div>
            </div>

            {/* Glowing progress bar */}
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
              <div 
                className={`h-full rounded-full transition-all duration-300 ${
                  answeringStage >= 6 
                    ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" 
                    : "bg-indigo-600 shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                }`}
                style={{ width: `${answeringPercent}%` }}
              />
            </div>

            {/* Stages Step List */}
            <div className="grid grid-cols-1 gap-2.5 pt-1">
              {(displayLanguage === "zh" ? [
                { stage: 1, text: "初始化 AI 引擎服务，进行安全握手与通道调度..." },
                { stage: 2, text: "深度剖解当前大纲节点在全景多层级关联树中的上下文脉络..." },
                { stage: 3, text: "启航大脑提问解析：建立并设计学术/专业级逻辑解答模型..." },
                { stage: 4, text: "修辞磨洗打磨，撰写该级提问对应的核心答复论点与论据演绎..." },
                { stage: 5, text: "整合答复并进行最终 Markdown 格式精细排版，完美注入视图..." }
              ] : [
                { stage: 1, text: "Initializing AI engine service, establishing secure handshake and channel scheduling..." },
                { stage: 2, text: "Analyzing the context of the current node in the panoramic multi-level tree..." },
                { stage: 3, text: "Parsing question: Designing an academic/professional level logical answer model..." },
                { stage: 4, text: "Refining phrasing: Writing core thesis statements and deductive arguments..." },
                { stage: 5, text: "Integrating the answer and formatting Markdown, rendering in the view..." }
              ]).map((step) => {
                const isActive = answeringStage === step.stage;
                const isCompleted = answeringStage > step.stage;
                return (
                  <div 
                    key={step.stage} 
                    className={`flex items-start gap-3 p-2 rounded transition-all duration-300 ${
                      isActive 
                        ? "bg-indigo-50/70 border-l-2 border-indigo-600 pl-2.5 animate-pulse" 
                        : isCompleted
                        ? "bg-emerald-50/[0.15] opacity-100"
                        : "opacity-80"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isCompleted ? (
                        <div className="w-4.5 h-4.5 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 animate-in zoom-in duration-300">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      ) : isActive ? (
                        <div className="w-4.5 h-4.5 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                          <Loader2 className="w-3 h-3 text-indigo-600 animate-spin" />
                        </div>
                      ) : (
                        <div className="w-4.5 h-4.5 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-[10px] font-mono font-bold">
                          {step.stage}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${isActive ? "text-indigo-950 font-bold" : isCompleted ? "text-slate-600 font-medium" : "text-slate-400 font-medium"}`}>
                        {step.text}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="bg-slate-50/80 p-5 rounded-r border-l-4 border-indigo-600 min-h-[220px]">
            {selectedNode.answer && selectedNode.answer.trim().length > 0 ? (
              (() => {
                const parsed = parseThinkAndContent(selectedNode.answer);
                const bilingualData = parseAnswersByLanguage(parsed.content);
                
                let renderContent = bilingualData.default;
                if (displayLanguage === "zh") renderContent = bilingualData.zh;
                else if (displayLanguage === "en") renderContent = bilingualData.en;
                else renderContent = `<div lang="zh">\n\n${bilingualData.zh}\n\n</div>\n\n---\n\n<div lang="en">\n\n${bilingualData.en}\n\n</div>`;

                return (
                  <div 
                    ref={markdownContainerRef}
                    className="markdown-body text-slate-800 leading-relaxed text-[13.5px] space-y-3.5 select-text cursor-text"
                    onMouseUp={handleSelection}
                    onTouchEnd={handleSelection}
                  >
                    {parsed.think && (
                      <details className="think-details mb-4 animate-in fade-in duration-300" open={false}>
                        <summary className="think-summary">
                          <span className="flex items-center gap-1.5 align-middle select-none">
                            <span className="inline-block text-amber-500 animate-[pulse_3s_infinite] font-semibold text-[13.5px]">🧠</span>
                            <span>{displayLanguage === "zh" ? "思考过程 (已折叠，点击展开)" : "Thinking Process (Collapsed, click to expand)"}</span>
                          </span>
                        </summary>
                        <div className="think-content border-t border-slate-100 dark:border-slate-800 mt-1">
                          <Markdown 
                            remarkPlugins={[remarkMath, remarkGfm]}
                            rehypePlugins={[rehypeRaw, rehypeKatex]}
                          >
                            {parsed.think}
                          </Markdown>
                        </div>
                      </details>
                    )}

                    <Markdown
                      remarkPlugins={[remarkMath, remarkGfm]}
                      rehypePlugins={[rehypeRaw, rehypeKatex]}
                      components={{
                        a: ({ href, children, ...props }) => {
                          if (href?.startsWith("#node-")) {
                            const targetId = href.replace("#node-", "");
                            return (
                              <a
                                href={href}
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (onNavigateToNode) {
                                    onNavigateToNode(targetId);
                                  }
                                }}
                                className="text-indigo-600 hover:text-indigo-800 font-bold underline underline-offset-4 decoration-indigo-300 hover:decoration-indigo-700 bg-indigo-50/50 hover:bg-indigo-50 px-1 py-0.5 rounded transition cursor-pointer"
                                title={displayLanguage === "zh" ? "点击前往该划词的追问答案节点" : "Click to go to the follow-up question node"}
                              >
                                {children}
                              </a>
                            );
                          }
                          return (
                            <a 
                              href={href} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-indigo-600 hover:text-indigo-850 hover:underline font-semibold transition decoration-indigo-300 hover:decoration-indigo-700 underline underline-offset-4"
                              {...props}
                            >
                              {children}
                            </a>
                          );
                        },
                        img: ({ src, alt, ...props }) => {
                          return (
                            <span className="block my-5 text-center">
                              <img
                                src={src}
                                alt={alt || "Topic illustration"}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="mx-auto rounded-xl border border-slate-200/80 shadow-md max-h-[380px] object-cover hover:scale-[1.01] transition-transform duration-200"
                                {...props}
                              />
                              {alt && (
                                <span className="block text-center text-[10.5px] text-slate-400 mt-2 italic font-mono">
                                  {alt}
                                </span>
                              )}
                            </span>
                          );
                        }
                      } as any}
                    >
                      {foldHeadings ? makeMarkdownHeadingsCollapsible(renderContent, allOpenState) : renderContent}
                    </Markdown>
                  </div>
                );
              })()
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-slate-400">
                <Sparkles className="w-7 h-7 text-indigo-300 mb-2 animate-pulse" />
                <p className="text-xs text-slate-550 font-bold">{displayLanguage === "zh" ? "目前暂无解答内容" : "No answer content yet"}</p>
                <p className="text-[10px] text-slate-400 mt-1">{displayLanguage === "zh" ? "欢迎点击右上方「AI 自动解答」自动构建逻辑论述框架..." : "Click 'AI Auto Answer' at top right to automatically build logical discussion framework..."}</p>
              </div>
            )}
          </div>
        )}

        {/* Subtle tip when no text is selected */}
        {selectedNode.answer && selectedNode.answer.trim().length > 0 && !selectedText && (
          <div className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-100/60 flex items-center gap-1.5 justify-center">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
            <span>{displayLanguage === "zh" ? "💡 提示：在上方排版中划选任何词汇，可触发智能追问面板开展更细颗粒度的子课题逻辑探索。" : "💡 Tip: Select any text above to trigger the smart follow-up panel for finer-grained sub-topic exploration."}</span>
          </div>
        )}

        {/* 4. AI Suggested Topics Panel (Dynamic append tree) */}
        {(isGeneratingSuggestions || aiSuggestions.length > 0) && (
          <div className="mt-6 border-t border-dashed border-slate-200 pt-5">
            <h3 className="text-xs font-bold text-slate-600 flex items-center gap-1.5 uppercase tracking-wide mb-3">
              <Lightbulb className="w-3.5 h-3.5 text-indigo-600" />
              {localStorage.getItem("llm_provider") === "minimax" ? "MiniMax" : (localStorage.getItem("llm_provider") === "gemini" ? "Gemini" : (localStorage.getItem("llm_provider") || "Gemini").toUpperCase())} {displayLanguage === "zh" ? "逻辑大纲启发看板" : "Logical Outline Heuristic Board"}
            </h3>

            {isGeneratingSuggestions ? (
              <div className="space-y-3">
                <div className="h-10 bg-slate-100 animate-pulse rounded-sm w-full" />
                <div className="h-10 bg-slate-100 animate-pulse rounded-sm w-3/4" />
                <div className="h-10 bg-slate-100 animate-pulse rounded-sm w-5/6" />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5">
                {aiSuggestions.map((suggestion, index) => (
                  <div 
                    key={index}
                    className="p-3 bg-indigo-50/30 hover:bg-indigo-50 border border-indigo-150 border-indigo-100/50 rounded-sm flex items-start justify-between gap-3 transition-colors group"
                  >
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-indigo-950">
                        {displayLanguage === "en" && suggestion.en_text ? suggestion.en_text : suggestion.text}
                      </h4>
                      <p className="text-xs text-slate-550 mt-1 leading-relaxed">
                        {displayLanguage === "en" && suggestion.en_reason ? suggestion.en_reason : suggestion.reason}
                      </p>
                    </div>
                    <button
                      onClick={() => handleAddSuggestedChild(suggestion)}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xs text-[11px] font-bold transition active:scale-95 cursor-pointer shadow-2xs"
                      title={displayLanguage === "zh" ? "将此推荐作为子问题挂载进左侧树阵" : "Mount this recommendation as a child question in the left tree"}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {displayLanguage === "zh" ? "采纳挂载" : "Adopt & Mount"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* 3.5 Text Selection Sub-question Interaction panel (Floating over the preview pane, transparent/backdrop-blur) */}
      {selectedNode.answer && selectedNode.answer.trim().length > 0 && selectedText && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-[92%] max-w-sm z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-indigo-150 border-indigo-100 shadow-xl rounded-lg p-3.5 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Sparkles className="w-3.5 h-3.5 text-indigo-650 shrink-0 text-indigo-600 animate-pulse" />
              <span className="text-[11px] font-bold text-slate-800">{displayLanguage === "zh" ? "划词追问" : "Highlight Ask"}</span>
              <span className="text-[10px] text-indigo-700 bg-indigo-50/80 px-1.5 py-0.5 rounded font-bold">
                {selectedText}
              </span>
            </div>
            <button 
              onClick={() => setSelectedText("")}
              className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-100 rounded transition shrink-0"
              title={displayLanguage === "zh" ? "清除选择" : "Clear selection"}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick recommendation template pills */}
          <div className="flex flex-wrap gap-1">
            {[
              displayLanguage === "zh" ? `什么是「${selectedText}」？` : `What is "${selectedText}"?`,
              displayLanguage === "zh" ? `剖析「${selectedText}」的原理` : `Analyze principles of "${selectedText}"`,
              displayLanguage === "zh" ? `「${selectedText}」的应用` : `Applications of "${selectedText}"`
            ].map((tpl, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSubQuestionInput(tpl)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition cursor-pointer text-left truncate max-w-[170px] ${
                  subQuestionInput === tpl
                    ? "bg-indigo-600 border-indigo-600 text-white font-semibold"
                    : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
                title={tpl}
              >
                {tpl}
              </button>
            ))}
          </div>

          {/* Input field */}
          <input
            type="text"
            value={subQuestionInput}
            onChange={(e) => setSubQuestionInput(e.target.value)}
            className="w-full text-xs px-2.5 py-1.5 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded focus:outline-none font-bold text-slate-850"
            placeholder={displayLanguage === "zh" ? "自定义追问课题..." : "Custom follow-up topic..."}
          />

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-1.5 pt-1.5 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                const finalTitle = subQuestionInput.trim() || (displayLanguage === "zh" ? `深入追问: ${selectedText}` : `Deep Follow-up: ${selectedText}`);
                onAddChild(selectedNode.id, finalTitle, selectedText, undefined, false);
                setSelectedText("");
              }}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded text-[11px] font-medium flex items-center gap-1 cursor-pointer transition"
            >
              <Plus className="w-3" />
              {displayLanguage === "zh" ? "仅建节点" : "Create Node"}
            </button>

            <button
              type="button"
              disabled={isGeneratingAnswer}
              onClick={() => {
                const finalTitle = subQuestionInput.trim() || (displayLanguage === "zh" ? `什么是「${selectedText}」？` : `What is "${selectedText}"?`);
                onAddChild(selectedNode.id, finalTitle, selectedText, undefined, false);
                setSelectedText("");
              }}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer transition shadow-2xs hover:shadow-xs"
            >
              <Sparkles className="w-3 animate-pulse" />
              {displayLanguage === "zh" ? "AI 追问解答" : "AI Follow-up Answer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
