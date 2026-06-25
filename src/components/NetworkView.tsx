import { useState, useEffect, useRef, useMemo } from "react";
import { 
  Network, 
  Search, 
  Sliders, 
  Maximize2, 
  Minimize2, 
  Info, 
  CheckCircle2, 
  HelpCircle, 
  Compass, 
  ChevronRight, 
  FileText, 
  Cpu, 
  Edit3, 
  ListCollapse, 
  Sparkles, 
  Trash2,
  RefreshCw,
  X
} from "lucide-react";
import * as d3 from "d3";
import { QuestionNode } from "../types";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { makeMarkdownHeadingsCollapsible, parseThinkAndContent, parseAnswersByLanguage } from "./TreeHelper";

interface NetworkViewProps {
  questions: QuestionNode[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onUpdateAnswer: (id: string, text: string) => void;
  onEditNodeTitle: (id: string, text: string) => void;
  onDeleteNode: (id: string) => void;
  onAddChildNode: (parentId: string, text: string) => void;
  onNavigateToTree: (id: string) => void;
  minimaxApiKey: string;
  searchTerm?: string;
  onSearchTermChange?: (term: string) => void;
  displayLanguage?: "zh" | "en";
  theme?: "cartoon" | "geeker" | "zen" | "scientist";
  hideInspector?: boolean;
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  text: string;
  answer: string;
  depth: number;
  parentId: string | null;
  rootId?: string;
  childrenCount: number;
  hasAnswer: boolean;
  createdAt: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  id: string;
  isCrossGroup?: boolean;
  score?: number;
  sharedKeywords?: string[];
}

export function NetworkView({
  questions,
  selectedNodeId,
  onSelectNode,
  onUpdateAnswer,
  onEditNodeTitle,
  onDeleteNode,
  onAddChildNode,
  onNavigateToTree,
  minimaxApiKey,
  searchTerm = "",
  onSearchTermChange,
  displayLanguage = "zh",
  theme = "cartoon",
  hideInspector = false,
}: NetworkViewProps) {
  // UI & controls states
  const [searchQuery, setSearchQuery] = useState(searchTerm);

  // Sync state when parent search term changes
  useEffect(() => {
    setSearchQuery(searchTerm);
  }, [searchTerm]);
  const [colorMode, setColorMode] = useState<"depth" | "status">("depth");
  const [nodeSizeFactor, setNodeSizeFactor] = useState(1);
  const [linkDistance, setLinkDistance] = useState(80);
  const [forceStrength, setForceStrength] = useState(-150);
  const [activeNode, setActiveNode] = useState<GraphNode | null>(null);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  
  // Custom scope for displaying constellation orbit
  const [graphScope, setGraphScope] = useState<"global" | "focus">("global");
  
  // Cross-group cognitive connection parameters
  const [showCrossLinks, setShowCrossLinks] = useState(true);
  const [crossLinkThreshold, setCrossLinkThreshold] = useState(0.12);
  const [maxHighlightLinks, setMaxHighlightLinks] = useState(25);
  
  // Interactive Editing States (within graph inspector card)
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isAddingSubQuestion, setIsAddingSubQuestion] = useState(false);
  const [newSubQuestionText, setNewSubQuestionText] = useState("");
  
  // AI triggers inside inspector
  const [isGeneratingAnswer, setIsGeneratingAnswer] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

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

  const [showControls, setShowControls] = useState(false);
  const [isHelpTipExpanded, setIsHelpTipExpanded] = useState(false);

  // SVG dimensions
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const lastCenteredNodeIdRef = useRef<string | null>(null);

  // Parse questions recursively to generate flat nodes, hierarchy links and semantic cross-group links
  const { nodes, links, crossLinks, stats } = useMemo(() => {
    const flatNodes: GraphNode[] = [];
    const flatLinks: GraphLink[] = [];
    let maxDepthVal = 0;
    let answeredCount = 0;

    function traverse(node: QuestionNode, depth = 0, parentId: string | null = null, currentRootId: string | null = null) {
      if (depth > maxDepthVal) maxDepthVal = depth;
      if (node.answer && node.answer.trim() !== "") {
        answeredCount++;
      }

      const myRootId = currentRootId || node.id;

      flatNodes.push({
        id: node.id,
        text: displayLanguage === "en" && node.en_text ? node.en_text : node.text,
        answer: node.answer || "",
        depth,
        parentId,
        rootId: myRootId,
        childrenCount: node.children.length,
        hasAnswer: !!(node.answer && node.answer.trim() !== ""),
        createdAt: node.createdAt || Date.now(),
      });

      node.children.forEach((child) => {
        flatLinks.push({
          source: node.id,
          target: child.id,
          id: `${node.id}-${child.id}`
        });
        traverse(child, depth + 1, node.id, myRootId);
      });
    }

    // Local helper to find parent root containing selectedNodeId recursively
    const findRootForNode = (nodesList: QuestionNode[], targetId: string): QuestionNode | null => {
      const existsInBranch = (node: QuestionNode, id: string): boolean => {
        if (node.id === id) return true;
        for (const child of node.children) {
          if (existsInBranch(child, id)) return true;
        }
        return false;
      };

      for (const q of nodesList) {
        if (existsInBranch(q, targetId)) return q;
      }
      return null;
    };

    if (graphScope === "focus" && selectedNodeId) {
      const activeRoot = findRootForNode(questions, selectedNodeId);
      if (activeRoot) {
        traverse(activeRoot, 0, null, null);
      } else {
        questions.forEach((q) => traverse(q, 0, null, null));
      }
    } else {
      questions.forEach((q) => traverse(q, 0, null, null));
    }

    // Calculate cross-group semantic linkages (only execute under scale if enabled)
    let selectedCrossLinks: Array<{ source: string, target: string, id: string, score: number, sharedKeywords: string[] }> = [];

    if (showCrossLinks && flatNodes.length > 0) {
      const stopWords = new Set([
        "", "的", "了", "在", "是", "我", "你", "他", "和", "与", "或", "而", "中", "其", "于", "之", "为", "下", "上", "个", "等", "及", "以", "对",
        "着", "也", "就", "不", "有", "这", "那", "到", "自", "从", "往", "过", "得", "对于", "关于", "如何", "怎么", "什么", "为什么", "是何",
        "the", "a", "an", "and", "or", "in", "on", "of", "to", "for", "is", "are", "with", "this", "that", "it"
      ]);
      const chineseRange = /[\u4e00-\u9fa5]/;

      // Fast keyword extractor
      const getKeywords = (text: string) => {
        const keywords = new Set<string>();
        if (!text) return keywords;
        
        const clean = text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'，。！？：；（）「」《》【】、\n\r]/g, " ");
        const words = clean.split(/\s+/);
        for (const w of words) {
          if (w.length >= 2 && !stopWords.has(w)) {
            keywords.add(w);
          }
        }
        
        for (let i = 0; i < text.length - 1; i++) {
          const bi = text.slice(i, i + 2);
          if (chineseRange.test(bi[0]) && chineseRange.test(bi[1])) {
            if (!stopWords.has(bi)) {
              keywords.add(bi);
            }
          }
        }
        return keywords;
      };

      // Cache computed keyword sets and build inverted index: keyword -> node IDs
      const nodeKeywords: Record<string, Set<string>> = {};
      const keywordToNodeIds: Record<string, string[]> = {};

      flatNodes.forEach(node => {
        const kws = getKeywords(`${node.text} ${node.answer}`);
        nodeKeywords[node.id] = kws;
        kws.forEach(kw => {
          if (!keywordToNodeIds[kw]) {
            keywordToNodeIds[kw] = [];
          }
          keywordToNodeIds[kw].push(node.id);
        });
      });

      // Compute pairwise similarity efficiently using inverted index to avoid O(N^2) loops
      const crossLinksRaw: Array<{ source: string, target: string, id: string, score: number, sharedKeywords: string[] }> = [];
      const seenPairs = new Set<string>();

      // Safe-guard: if we have more than 500 nodes, restrict similarity calculations to prevent UI freeze
      const maxNodesToCompare = flatNodes.length > 500 ? 150 : flatNodes.length;
      const nodesToCompare = flatNodes.length > 500 ? flatNodes.slice(0, maxNodesToCompare) : flatNodes;

      nodesToCompare.forEach(nodeA => {
        const keywordsA = nodeKeywords[nodeA.id];
        if (!keywordsA || keywordsA.size === 0) return;

        // Collect potential candidate nodes sharing at least one keyword
        const candidates = new Set<string>();
        keywordsA.forEach(kw => {
          const list = keywordToNodeIds[kw] || [];
          list.forEach(id => {
            if (id !== nodeA.id) {
              candidates.add(id);
            }
          });
        });

        candidates.forEach(idB => {
          const pairKey = nodeA.id < idB ? `${nodeA.id}-${idB}` : `${idB}-${nodeA.id}`;
          if (seenPairs.has(pairKey)) return;
          seenPairs.add(pairKey);

          const nodeB = flatNodes.find(n => n.id === idB);
          if (!nodeB) return;

          if (nodeA.rootId && nodeB.rootId && nodeA.rootId !== nodeB.rootId) {
            const keywordsB = nodeKeywords[idB];
            if (keywordsB && keywordsB.size > 0) {
              const shared: string[] = [];
              let intersectCount = 0;
              for (const kw of keywordsA) {
                if (keywordsB.has(kw)) {
                  intersectCount++;
                  if (shared.length < 4) {
                    shared.push(kw);
                  }
                }
              }

              if (intersectCount > 0) {
                const unionSize = keywordsA.size + keywordsB.size - intersectCount;
                const jaccard = intersectCount / unionSize;

                if (jaccard >= crossLinkThreshold) {
                  crossLinksRaw.push({
                    source: nodeA.id,
                    target: idB,
                    id: `cross-${nodeA.id}-${idB}`,
                    score: jaccard,
                    sharedKeywords: shared
                  });
                }
              }
            }
          }
        });
      });

      crossLinksRaw.sort((a, b) => b.score - a.score);
      selectedCrossLinks = crossLinksRaw.slice(0, maxHighlightLinks);
    }

    return {
      nodes: flatNodes,
      links: flatLinks,
      crossLinks: selectedCrossLinks,
      stats: {
        totalNodes: flatNodes.length,
        totalLinks: flatLinks.length,
        answeredCount,
        maxDepth: maxDepthVal + 1,
        completionRate: flatNodes.length > 0 ? Math.round((answeredCount / flatNodes.length) * 100) : 0,
        crossLinksCount: selectedCrossLinks.length
      }
    };
  }, [questions, crossLinkThreshold, maxHighlightLinks, showCrossLinks, graphScope, selectedNodeId]);

  // Sync selectedNodeId from props into activeNode state on mount or change
  useEffect(() => {
    if (selectedNodeId) {
      const match = nodes.find(n => n.id === selectedNodeId);
      if (match) {
        setActiveNode(match);
        setEditedTitle(match.text);
        setIsMobileDrawerOpen(true);
      }
    } else if (nodes.length > 0 && !activeNode) {
      setActiveNode(nodes[0]);
      setEditedTitle(nodes[0].text);
    }
  }, [selectedNodeId, nodes]);

  const handleNodeClick = (node: GraphNode) => {
    setActiveNode(node);
    onSelectNode(node.id);
    setEditedTitle(node.text);
    setIsEditingTitle(false);
    setIsAddingSubQuestion(false);
    setApiError(null);
    setIsMobileDrawerOpen(true);
  };

  // Set up standard zoom behavior
  const [zoomScale, setZoomScale] = useState(1);
  const handleResetZoom = () => {
    if (!svgRef.current) return;
    const svgSelection = d3.select(svgRef.current);
    svgSelection.transition().duration(750).call(
      (zoomSelection as any).transform,
      d3.zoomIdentity.translate(0, 0).scale(1)
    );
  };

  const zoomSelection = d3.zoom()
    .scaleExtent([0.1, 4])
    .on("zoom", (event) => {
      d3.select("#network-g").attr("transform", event.transform);
      setZoomScale(event.transform.k);
    });

  // Main interactive force simulation lifecycle
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 500;

    // Clone data for physical mutation safety
    const runNodes: GraphNode[] = nodes.map(n => ({ ...n }));
    const runLinks: GraphLink[] = [
      ...links.map(l => ({ ...l, isCrossGroup: false })),
      ...(showCrossLinks ? crossLinks.map(cl => ({
        id: cl.id,
        source: cl.source,
        target: cl.target,
        score: cl.score,
        sharedKeywords: cl.sharedKeywords,
        isCrossGroup: true
      })) : [])
    ].map(l => ({
      ...l,
      // Use cloned node reference if matched, else keep string ID
      source: runNodes.find(rn => rn.id === (typeof l.source === 'object' ? l.source.id : l.source)) || l.source,
      target: runNodes.find(rn => rn.id === (typeof l.target === 'object' ? l.target.id : l.target)) || l.target,
    }));

    // Setup svg interactive Zoom binding
    const svgSelection = d3.select(svgRef.current);
    svgSelection.call(zoomSelection as any);

    // Cache the D3 selections of DOM elements to avoid heavy d3.selectAll queries in the tick loop
    const linkPaths = svgSelection.selectAll(".link-path").data(runLinks.filter(l => !l.isCrossGroup));
    const crossLinkPaths = svgSelection.selectAll(".cross-link-path").data(runLinks.filter(l => l.isCrossGroup));
    const nodeElements = svgSelection.selectAll(".node-element").data(runNodes);

    // Optimize forces configuration under high scale (N > 150)
    const isLargeGraph = runNodes.length > 150;
    const isHugeGraph = runNodes.length > 500;

    const chargeForce = d3.forceManyBody()
      .strength(forceStrength)
      .distanceMax(isHugeGraph ? 350 : (isLargeGraph ? 550 : 1000));

    const collisionForce = d3.forceCollide().radius((d: any) => {
      const textLabel = d.text.length > 18 ? `${d.text.slice(0, 17)}...` : d.text;
      const px = d.parentId === null ? 14 : 10;
      const rectWidth = Math.max(85, textLabel.length * 6.5 + px * 2 + (d.childrenCount > 0 ? 16 : 0));
      return (rectWidth / 2 + 14) * nodeSizeFactor;
    });

    // Instantiate forces
    const sim = d3.forceSimulation<GraphNode, GraphLink>(runNodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(runLinks)
        .id((d) => d.id)
        .distance((link) => link.isCrossGroup ? linkDistance * 1.8 : linkDistance)
        .strength((link) => link.isCrossGroup ? 0.06 : 0.8)
      )
      .force("charge", chargeForce)
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", collisionForce);

    // Run layout ticks synchronously to pre-position nodes and avoid laggy "flying nodes" animations
    const preTicks = isHugeGraph ? 70 : (isLargeGraph ? 45 : 15);
    for (let i = 0; i < preTicks; ++i) {
      sim.tick();
    }

    if (isLargeGraph) {
      sim.alphaDecay(0.045); // Settle down faster to free CPU resources
    }

    simulationRef.current = sim;

    // Center on the selected node on load or change
    if (selectedNodeId) {
      const selectedNode = runNodes.find(n => n.id === selectedNodeId);
      if (selectedNode && typeof selectedNode.x === 'number' && typeof selectedNode.y === 'number') {
        const currentTransform = d3.zoomTransform(svgRef.current);
        const k = currentTransform.k || 1;
        
        const targetX = width / 2 - k * selectedNode.x;
        const targetY = height / 2 - k * selectedNode.y;
        
        const isInitial = lastCenteredNodeIdRef.current === null;
        lastCenteredNodeIdRef.current = selectedNodeId;
        
        if (isInitial) {
          svgSelection.call(
            (zoomSelection as any).transform,
            d3.zoomIdentity.translate(targetX, targetY).scale(k)
          );
        } else {
          svgSelection.transition()
            .duration(700)
            .ease(d3.easeCubicOut)
            .call(
              (zoomSelection as any).transform,
              d3.zoomIdentity.translate(targetX, targetY).scale(k)
            );
        }
      }
    }

    // Define tick operations using optimized cached selections
    sim.on("tick", () => {
      linkPaths.attr("d", (d: any) => {
        const x1 = d.source.x;
        const y1 = d.source.y;
        const x2 = d.target.x;
        const y2 = d.target.y;
        const dx = x2 - x1;
        const cx1 = x1 + dx * 0.45;
        const cy1 = y1;
        const cx2 = x1 + dx * 0.55;
        const cy2 = y2;
        return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
      });

      crossLinkPaths
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      nodeElements.attr("transform", (d: any) => `translate(${d.x}, ${d.y})`);
    });

    // Handle Drag Interlocking Lifecycle
    const dragBehavior = d3.drag<SVGGElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeElements.call(dragBehavior as any);

    return () => {
      sim.stop();
    };
  }, [nodes, links, crossLinks, showCrossLinks, linkDistance, forceStrength, nodeSizeFactor, selectedNodeId]);

  // Handle Inspector Actions
  const handleSaveTitleEdit = () => {
    if (!activeNode || !editedTitle.trim()) return;
    onEditNodeTitle(activeNode.id, editedTitle.trim());
    setActiveNode({
      ...activeNode,
      text: editedTitle.trim()
    });
    setIsEditingTitle(false);
  };

  // Add child questions directly inside network view
  const handleAddSubQuestionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeNode || !newSubQuestionText.trim()) return;
    
    onAddChildNode(activeNode.id, newSubQuestionText.trim());
    
    // Clear and collapse add form
    setNewSubQuestionText("");
    setIsAddingSubQuestion(false);
    
    // Notify user visually
    setApiError(null);
  };

  // AI-Assisted prompt responder directly within Network View overlay inspector
  const triggerAiAnswerInNetwork = async () => {
    if (!activeNode) return;
    setIsGeneratingAnswer(true);
    setApiError(null);
    const provider = localStorage.getItem("llm_provider") || "gemini";
    try {
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

      // Generate a sleek prompt path context
      const response = await fetch("/api/gemini/answer", {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: activeNode.text,
          context: activeNode.parentId ? [activeNode.text] : []
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP 错误状态: ${response.status}`);
      }

      const resData = await response.json();
      const generatedText = resData.text || "";
      
      onUpdateAnswer(activeNode.id, generatedText);
      setActiveNode({
        ...activeNode,
        answer: generatedText,
        hasAnswer: true
      });
    } catch (err: any) {
      console.error(err);
      setApiError(err.message || `未能调用 ${provider.toUpperCase()} AI，请检查您的 API Key 与接口配置。`);
    } finally {
      setIsGeneratingAnswer(false);
    }
  };

  // Render Depth levels with high aesthetic colors
  const getNodeColor = (d: GraphNode) => {
    // Dynamic query highlight matching
    const isMatched = searchQuery
      ? d.text.toLowerCase().includes(searchQuery.toLowerCase()) || d.answer.toLowerCase().includes(searchQuery.toLowerCase())
      : true;

    if (!isMatched) {
      if (theme === "geeker") {
        return "#1e293b"; // Dark slate for out-of-focus
      } else if (theme === "zen") {
        return "#e5e5e5"; // Soft sterile gray for out-of-focus
      } else if (theme === "scientist") {
        return "#1e293b"; // Dark slate for out-of-focus in scientist
      } else {
        return "#cbd5e1"; // Muted slate-300 for out-of-focus in cartoon
      }
    }

    if (colorMode === "status") {
      if (theme === "geeker") {
        return d.hasAnswer ? "#10b981" : "#0f766e"; // Green/teal shades
      } else if (theme === "cartoon") {
        return d.hasAnswer ? "#10b981" : "#db2777"; // Emerald vs Cartoon Labubu Pink
      } else if (theme === "scientist") {
        return d.hasAnswer ? "#38bdf8" : "#2563eb"; // Cyan vs Royal Science Blue
      } else {
        return d.hasAnswer ? "#111111" : "#888888"; // Clean Black vs Gray for Zen Master
      }
    }

    // Depth-based color palette
    if (theme === "geeker") {
      const colors = [
        "#10b981", // Emerald
        "#22c55e", // Green
        "#4ade80", // Bright Green
        "#34d399", // Mint Green
        "#059669", // Darker Emerald
      ];
      return colors[d.depth % colors.length];
    } else if (theme === "zen") {
      // Zen Master sterile gray/neutral/black shades
      const colors = [
        "#111111", // Black
        "#444444", // Charcoal
        "#666666", // Slate Gray
        "#888888", // Medium Gray
        "#aaaaaa", // Light Gray
      ];
      return colors[d.depth % colors.length];
    } else if (theme === "scientist") {
      // Scientist professional high-contrast cyan/indigo spectrum
      const colors = [
        "#38bdf8", // Sky blue/cyan
        "#0ea5e9", // Electric ocean
        "#0284c7", // Bright navy
        "#2563eb", // Deep clinical blue
        "#06b6d4", // Glowing teal
      ];
      return colors[d.depth % colors.length];
    } else {
      // Cartoon playful rainbow colors
      const colors = [
        "#db2777", // Playful pink
        "#ea580c", // Sunny orange
        "#ca8a04", // Playful Yellow
        "#0891b2", // Cute Cyan
        "#7c3aed", // Soft violet
      ];
      return colors[d.depth % colors.length];
    }
  };

  return (
    <div className="flex-1 flex flex-col xl:flex-row gap-6 overflow-hidden h-full">
      
      {/* Network Graph Workspace Wrapper */}
      <div className={`flex-1 bg-white shadow-xs flex flex-col overflow-hidden relative ${hideInspector ? '' : 'rounded-xl border border-slate-200/80'}`} ref={containerRef}>
        
        {/* Graph Inner Top Header */}
        <div className={`border-b border-slate-100 flex gap-3 items-center justify-between shrink-0 bg-slate-50/50 z-10 sticky top-0 ${hideInspector ? 'hidden' : 'p-4 flex-wrap'}`}>
          <div className="flex items-center gap-2">
            <div className="p-1 text-indigo-600 bg-indigo-50 rounded">
              <Network className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-slate-800">{displayLanguage === "zh" ? "Q&A 提问脑图" : "Q&A Mind Map"}</h2>
              <p className="text-[10px] text-slate-400">{displayLanguage === "zh" ? "使用力导向图呈现问题层级衍生的思维演化路线" : "Using force-directed graph to present the evolutionary path of question hierarchies"}</p>
            </div>
          </div>

          <div className={`flex gap-2.5 ${hideInspector ? 'w-full flex-col' : 'items-center'}`}>
            {/* Search Input Filter */}
            <div className={`relative ${hideInspector ? 'w-full' : ''}`}>
              <input
                type="text"
                placeholder={displayLanguage === "zh" ? "在脑图中模糊检索并高亮..." : "Fuzzy search and highlight in the map..."}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (onSearchTermChange) {
                    onSearchTermChange(e.target.value);
                  }
                }}
                className={`pl-8 pr-7 py-1.5 px-3 bg-white text-[11px] rounded-full border border-slate-200 focus:outline-none focus:border-indigo-400 text-slate-800 focus:ring-1 focus:ring-indigo-100 ${hideInspector ? 'w-full' : 'w-48'}`}
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              {searchQuery && (
                <button onClick={() => {
                  setSearchQuery("");
                  if (onSearchTermChange) {
                    onSearchTermChange("");
                  }
                }} className="absolute right-2.5 top-1.5 text-[10px] text-slate-300 hover:text-slate-500 font-bold">✕</button>
              )}
            </div>

            {/* Quick Stats Summary on top */}
            {!hideInspector && (
              <div className="hidden sm:flex text-[10px] bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200/40 font-mono text-slate-500 items-center gap-1.5">
                <span>{displayLanguage === "zh" ? "节点:" : "Nodes:"} <strong className="text-slate-800">{stats.totalNodes}</strong></span>
                <span className="text-slate-300">|</span>
                <span>{displayLanguage === "zh" ? "已答:" : "Answered:"} <strong className="text-emerald-600">{stats.answeredCount}</strong>({stats.completionRate}%)</span>
              </div>
            )}
            
            <button
              onClick={() => setShowControls(!showControls)}
              className={`hidden md:flex p-1.5 rounded-md border transition-colors cursor-pointer ${showControls ? "bg-indigo-100 border-indigo-200 text-indigo-700" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"}`}
              title={displayLanguage === "zh" ? "切换极客级渲染参数调节面板" : "Toggle Geeker Rendering Control Panel"}
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {showControls && (
          <div className="hidden md:flex flex-col shrink-0">
            {/* Physics Force Parameters Control Tray */}
            <div className={`px-4 py-3 bg-slate-50/60 border-b border-slate-100 items-center text-[10px] text-slate-500 font-medium ${hideInspector ? 'flex flex-row overflow-x-auto no-scrollbar gap-4 whitespace-nowrap' : 'grid grid-cols-2 sm:grid-cols-5 gap-4'}`}>
              <div className="flex items-center gap-1.5">
                <span>{displayLanguage === "zh" ? "色彩模式:" : "Color Mode:"}</span>
                <select
                  value={colorMode}
                  onChange={(e) => setColorMode(e.target.value as any)}
                  className="bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[10px] text-slate-600 font-bold focus:outline-none cursor-pointer"
                >
                  <option value="depth">{displayLanguage === "zh" ? "按大纲深度层级" : "By Depth Level"}</option>
                  <option value="status">{displayLanguage === "zh" ? "按是否已写答案" : "By Answered Status"}</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span>{displayLanguage === "zh" ? "星轨范围:" : "Scope:"}</span>
                <select
                  value={graphScope}
                  onChange={(e) => setGraphScope(e.target.value as any)}
                  className="bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[10px] text-indigo-700 font-bold focus:outline-none cursor-pointer hover:border-slate-300 transition"
                  title={displayLanguage === "zh" ? "全图或聚焦渲染单支。海量数据下单支渲染极具效率并告别蜘蛛网杂乱！" : "Global or focus render. Focus render is highly efficient for massive data and avoids spider web clutter!"}
                >
                  <option value="global">{displayLanguage === "zh" ? "🪐 全量星谱" : "🪐 Global Scope"}</option>
                  <option value="focus">{displayLanguage === "zh" ? "🎯 聚焦单支" : "🎯 Focus Single"}</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span>{displayLanguage === "zh" ? "节点大小:" : "Node Size:"}</span>
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.1"
                  value={nodeSizeFactor}
                  onChange={(e) => setNodeSizeFactor(parseFloat(e.target.value))}
                  className="w-16 accent-indigo-600 h-1 bg-slate-200 rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex items-center gap-2">
                <span>{displayLanguage === "zh" ? "连线弹力:" : "Link Distance:"}</span>
                <input
                  type="range"
                  min="40"
                  max="200"
                  step="10"
                  value={linkDistance}
                  onChange={(e) => setLinkDistance(parseInt(e.target.value))}
                  className="w-16 accent-indigo-600 h-1 bg-slate-200 rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={handleResetZoom}
                  className="px-2 py-0.5 bg-white border border-slate-200 rounded hover:bg-slate-50 text-[10px] text-slate-600 flex items-center gap-1 cursor-pointer transition shadow-2xs font-bold"
                  title={displayLanguage === "zh" ? "复位缩放与居中" : "Reset Zoom & Center"}
                >
                  <Maximize2 className="w-2.5 h-2.5" />
                  <span>{displayLanguage === "zh" ? "重置居中" : "Reset Center"} (x{zoomScale.toFixed(1)})</span>
                </button>
              </div>
            </div>

            {/* Cross-group Cognitive Relational Orbits Controls */}
            <div className="px-4 py-2 bg-indigo-50/40 border-b border-indigo-100/50 flex flex-wrap gap-4 items-center justify-between text-[10px] text-slate-600 font-medium font-sans">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-1.5 cursor-pointer text-indigo-900 font-bold">
                  <input
                    type="checkbox"
                    checked={showCrossLinks}
                    onChange={(e) => setShowCrossLinks(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3 h-3 cursor-pointer"
                  />
                  <span>{displayLanguage === "zh" ? "🛸 激活跨组关联星轨" : "🛸 Activate Cross-group Links"}</span>
                </label>
            <span className="text-slate-300">|</span>
            {showCrossLinks && (
              <>
                <div className="flex items-center gap-1.5">
                  <span>{displayLanguage === "zh" ? "关联阈值 (Jaccard):" : "Threshold (Jaccard):"}</span>
                  <input
                    type="range"
                    min="0.05"
                    max="0.30"
                    step="0.01"
                    value={crossLinkThreshold}
                    onChange={(e) => setCrossLinkThreshold(parseFloat(e.target.value))}
                    className="w-20 accent-indigo-600 h-1 bg-indigo-100 rounded-lg cursor-pointer"
                  />
                  <span className="font-mono text-indigo-700 bg-white px-1.5 py-0.5 rounded border border-indigo-100 font-bold">
                    {crossLinkThreshold.toFixed(2)}
                  </span>
                </div>
                <span className="text-slate-300">|</span>
                <div className="flex items-center gap-1.5">
                  <span>{displayLanguage === "zh" ? "最大链路数:" : "Max Links:"}</span>
                  <input
                    type="range"
                    min="5"
                    max="60"
                    step="5"
                    value={maxHighlightLinks}
                    onChange={(e) => setMaxHighlightLinks(parseInt(e.target.value))}
                    className="w-16 accent-indigo-600 h-1 bg-indigo-100 rounded-lg cursor-pointer"
                  />
                  <span className="font-mono text-indigo-700 bg-white px-1.5 py-0.5 rounded border border-indigo-100 font-bold">
                    {maxHighlightLinks}
                  </span>
                </div>
              </>
            )}
          </div>
          <div className="text-[9px] text-indigo-700 font-bold bg-indigo-100/80 px-2.5 py-0.5 rounded-full border border-indigo-100 shrink-0">
            {displayLanguage === "zh" ? "已捕获跨组星联轨:" : "Captured Cross-group Links:"} {stats.crossLinksCount || 0} {displayLanguage === "zh" ? "条" : ""}
          </div>
        </div>
        </div>
        )}

        {/* Dynamic Force SVG Canvas */}
        {(() => {
          let canvasWrapperClass = "";
          if (theme === "geeker") {
            canvasWrapperClass = "bg-neutral-950 border border-neutral-900 rounded-xl";
          } else if (theme === "cartoon") {
            canvasWrapperClass = "bg-[#fdfbf7] border-2 border-[#ebdcb9] rounded-2xl shadow-[4px_4px_0_#ebdcb9]";
          } else if (theme === "scientist") {
            canvasWrapperClass = "bg-[#0d1527] border border-[#1e293b] rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.15)]";
          } else { // zen
            canvasWrapperClass = "bg-[#fafafa] border border-[#e0e0e0] rounded-xl shadow-none";
          }

          const markerColor = theme === "geeker" ? "#10b981" : theme === "cartoon" ? "#db2777" : theme === "scientist" ? "#38bdf8" : "#888888";
          const linkStroke = theme === "geeker" ? "rgba(16,185,129,0.35)" : theme === "cartoon" ? "rgba(219,39,119,0.3)" : theme === "scientist" ? "rgba(56,189,248,0.25)" : "rgba(136,136,136,0.25)";
          const linkStrokeWidth = theme === "cartoon" ? "2" : "1.5";

          const emptyStateClass = `absolute inset-0 flex flex-col items-center justify-center p-8 text-center ${
            theme === "geeker" 
              ? "text-emerald-700/60" 
              : theme === "cartoon" 
                ? "text-[#a78b71]" 
                : theme === "scientist"
                  ? "text-sky-500/60"
                  : "text-stone-400"
          }`;
          const emptyStateIconClass = `w-12 h-12 mb-2 ${
            theme === "geeker" 
              ? "text-emerald-950/40" 
              : theme === "cartoon" 
                ? "text-[#ebdcb9]" 
                : theme === "scientist"
                  ? "text-sky-800/40"
                  : "text-stone-300"
          }`;
          const emptyStateText = displayLanguage === "zh" 
            ? "暂无提问数据。请在左侧添加新的研究节点以渲染脑图。" 
            : "No research node data available yet. Please add a node on the left to render the mind map.";

          const baseHelpTipWrapperClass = `absolute bottom-3 left-3 backdrop-blur-md shadow-2xs border cursor-pointer hover:opacity-90 active:scale-95 transition-all duration-200 ${
            theme === "geeker"
              ? "bg-neutral-950/90 border-emerald-500/20 text-emerald-400/80"
              : theme === "cartoon"
                ? "bg-[#fdfbf7]/95 border-[#ebdcb9] text-[#7c5c43]"
                : theme === "scientist"
                  ? "bg-[#0d1527]/95 border-sky-500/20 text-sky-400/80"
                  : "bg-[#fafafa]/95 border-[#e0e0e0] text-stone-500"
          }`;
          
          const helpTipWrapperExpandedClass = `${baseHelpTipWrapperClass} px-2.5 py-1.5 rounded-md text-[10px] space-y-0.5 max-w-64`;
          const helpTipWrapperCollapsedClass = `${baseHelpTipWrapperClass} p-1.5 rounded-full flex items-center justify-center`;
          const helpTipTitleClass = `font-bold flex items-center gap-1 ${
            theme === "geeker"
              ? "text-emerald-300"
              : theme === "cartoon"
                ? "text-[#5c4033]"
                : theme === "scientist"
                  ? "text-sky-300"
                  : "text-stone-800"
          }`;
          const helpTipIconColor = theme === "geeker" ? "#10b981" : theme === "cartoon" ? "#db2777" : theme === "scientist" ? "#38bdf8" : "#555555";

          return (
            <div className={`flex-1 relative cursor-grab active:cursor-grabbing overflow-hidden ${canvasWrapperClass}`}>
              {nodes.length > 0 ? (
                <svg
                  ref={svgRef}
                  className="w-full h-full select-none"
                  id="network-canvas"
                >
                  {/* Define cool markers for links directional indicators */}
                  <defs>
                    <marker
                      id="arrow"
                      viewBox="0 0 10 10"
                      refX="18"
                      refY="5"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1 L 10 5 L 0 9 z" fill={markerColor} />
                    </marker>
                  </defs>

                  {/* High performance Level-of-Detail (LOD) styles to optimize browser rendering under scale */}
                  <style>{`
                    .hide-node-details text {
                      display: none !important;
                    }
                    .hide-node-details .node-element rect {
                      filter: none !important;
                    }
                  `}</style>

                  <g id="network-g">
                    {/* 1. Links Rendered underneath */}
                    <g className="links-group">
                      {/* Standard Hierarchical parent-child Links (Arrow and Solid/Dashed) */}
                      {links.map((link) => (
                        <path
                          key={link.id}
                          className="link-path transition-all"
                          fill="none"
                          stroke={linkStroke}
                          strokeWidth={linkStrokeWidth}
                          strokeDasharray={
                            typeof link.target === 'object' && !link.target.hasAnswer
                              ? "4 4"
                              : undefined
                          }
                          markerEnd="url(#arrow)"
                        />
                      ))}

                      {/* Cross-group Cognitive Relational Links */}
                      {showCrossLinks && crossLinks.map((link: any) => {
                        const isSourceSelected = activeNode?.id === (typeof link.source === 'object' ? link.source.id : link.source);
                        const isTargetSelected = activeNode?.id === (typeof link.target === 'object' ? link.target.id : link.target);
                        const isHighlighted = isSourceSelected || isTargetSelected;

                        const crossLinkStroke = isHighlighted
                          ? (theme === "geeker" ? "#34d399" : theme === "cartoon" ? "#db2777" : theme === "scientist" ? "#38bdf8" : "#111111")
                          : (theme === "geeker" ? "#064e3b" : theme === "cartoon" ? "#ebdcb9" : theme === "scientist" ? "#1e293b" : "#e5e5e5");

                        return (
                          <line
                            key={`cross-${link.id}`}
                            className="cross-link-path transition-all cursor-pointer"
                            stroke={crossLinkStroke}
                            strokeOpacity={isHighlighted ? "0.9" : "0.35"}
                            strokeWidth={isHighlighted ? "2" : "1"}
                            strokeDasharray={isHighlighted ? "2 2" : "4 4"}
                          >
                            <title>{displayLanguage === "zh" ? `跨组相似度: ${(link.score * 100).toFixed(0)}% (关联词: ${link.sharedKeywords?.join(", ") || ""})` : `Cross-group Similarity: ${(link.score * 100).toFixed(0)}% (Keywords: ${link.sharedKeywords?.join(", ") || ""})`}</title>
                          </line>
                        );
                      })}
                    </g>

                    {/* 2. Nodes Rendered on top with Level-of-Detail optimization */}
                    <g className={`nodes-group ${zoomScale < 0.45 && nodes.length > 150 ? "hide-node-details" : ""}`}>
                      {nodes.map((node) => {
                        const isSelected = activeNode?.id === node.id;
                        const isRoot = node.parentId === null;
                        const nodeColor = getNodeColor(node);
                        const queryMatches = searchQuery 
                          ? node.text.toLowerCase().includes(searchQuery.toLowerCase())
                          : false;

                        const textLabel = node.text.length > 18 ? `${node.text.slice(0, 16)}...` : node.text;

                        // Theme custom halo and color parameters matching the mind map card style
                        const selectedHaloStroke = theme === "geeker" ? "#10b981" : theme === "cartoon" ? "#db2777" : theme === "scientist" ? "#38bdf8" : "#4f46e5";

                        const queryMatchFilter = queryMatches
                          ? (theme === "geeker"
                             ? "drop-shadow(0 0 8px rgba(16,185,129,0.65))"
                             : theme === "cartoon"
                               ? "drop-shadow(0 0 8px rgba(219,39,119,0.5))"
                               : theme === "scientist"
                                 ? "drop-shadow(0 0 10px rgba(56,189,248,0.7))"
                                 : "drop-shadow(0 0 6px rgba(0,0,0,0.15))")
                          : undefined;

                        // Layout and Size boundaries for rect card
                        const px = isRoot ? 14 : 10;
                        const rectHeight = isRoot ? 32 : 26;
                        // 6.2px per character + padding + children pill space
                        const rectWidth = Math.max(85, textLabel.length * 6.5 + px * 2 + (node.childrenCount > 0 ? 18 : 0));

                        let cardBg = "#ffffff";
                        let cardStroke = nodeColor;
                        let textFillColor = "";
                        let countBg = "rgba(0,0,0,0.06)";
                        let countColor = "#475569";
                        let textWeightClass = "font-medium";
                        let textDropShadow = "";

                        // Inject design details based on themes
                        if (theme === "geeker") {
                          cardBg = isSelected ? "rgba(16, 185, 129, 0.2)" : "rgba(10, 10, 12, 0.95)";
                          cardStroke = isSelected ? "#34d399" : (queryMatches ? "#10b981" : "rgba(16, 185, 129, 0.5)");
                          textFillColor = isSelected ? "#34d399" : (queryMatches ? "#6ee7b7" : "rgba(16, 185, 129, 0.85)");
                          countBg = "rgba(16, 185, 129, 0.25)";
                          countColor = "#34d399";
                          textDropShadow = isSelected ? "drop-shadow-[0_0_2px_rgba(16,185,129,0.5)]" : "";
                          textWeightClass = isSelected ? "font-bold" : "font-medium";
                        } else if (theme === "scientist") {
                          cardBg = isSelected ? "rgba(56, 189, 248, 0.2)" : "rgba(13, 21, 39, 0.95)";
                          cardStroke = isSelected ? "#38bdf8" : (queryMatches ? "#7dd3fc" : "rgba(56, 189, 248, 0.5)");
                          textFillColor = isSelected ? "#38bdf8" : (queryMatches ? "#93c5fd" : "#cbd5e1");
                          countBg = "rgba(56, 189, 248, 0.25)";
                          countColor = "#38bdf8";
                          textDropShadow = isSelected ? "drop-shadow-[0_0_2px_rgba(56,189,248,0.5)]" : "";
                          textWeightClass = isSelected ? "font-bold" : "font-medium";
                        } else if (theme === "cartoon") {
                          cardBg = isSelected ? "#fbcfe8" : "#fffcf3";
                          cardStroke = "#5c4033";
                          textFillColor = "#5c4033";
                          countBg = isSelected ? "#be185d" : "#5c4033";
                          countColor = "#ffffff";
                          textWeightClass = isSelected ? "font-bold" : "font-medium";
                        } else { // zen
                          cardBg = isSelected ? "rgba(79, 70, 229, 0.08)" : "#ffffff";
                          cardStroke = isSelected ? "#4f46e5" : (queryMatches ? "#6366f1" : "rgba(148, 163, 184, 0.72)");
                          textFillColor = isSelected ? "#4f46e5" : "#1e293b";
                          countBg = isSelected ? "#4f46e5" : "rgba(0, 0, 0, 0.06)";
                          countColor = isSelected ? "#ffffff" : "#64748b";
                          textWeightClass = isSelected ? "font-semibold" : "font-medium";
                        }

                        // Customize tooltip colors based on interactive application themes
                        let tooltipBg = "#1e293b";
                        let tooltipTextColor = "#ffffff";
                        let tooltipStroke = "#334155";

                        if (theme === "geeker") {
                          tooltipBg = "#0e0e11";
                          tooltipTextColor = "#10b981";
                          tooltipStroke = "#10b981";
                        } else if (theme === "scientist") {
                          tooltipBg = "#090d16";
                          tooltipTextColor = "#38bdf8";
                          tooltipStroke = "#38bdf8";
                        } else if (theme === "cartoon") {
                          tooltipBg = "#fffcf3";
                          tooltipTextColor = "#5c4033";
                          tooltipStroke = "#5c4033";
                        }

                        const tooltipWidth = Math.max(90, node.text.length * 5.8 + 16);

                        // Shift text slightly left when children count is next to it
                        const textXPosition = node.childrenCount > 0 ? -7 : 0;

                        return (
                          <g
                            key={node.id}
                            className="node-element cursor-pointer group"
                            id={`node-${node.id}`}
                            onClick={() => handleNodeClick(node)}
                          >
                            <title>{node.text.length > 80 ? node.text.substring(0, 80) + '...' : node.text}</title>
                            {/* Selected halo card glow */}
                            {isSelected && (
                              <rect
                                x={-rectWidth / 2 - 4}
                                y={-rectHeight / 2 - 4}
                                width={rectWidth + 8}
                                height={rectHeight + 8}
                                rx={isRoot ? 12 : 10}
                                ry={isRoot ? 12 : 10}
                                fill="none"
                                stroke={selectedHaloStroke}
                                className="animate-pulse"
                                strokeWidth="1.5"
                              />
                            )}

                            {/* Cartoon Flat Heavy Shadow (Theme Specific Solid Drop shadow) */}
                            {theme === "cartoon" && (
                              <rect
                                x={-rectWidth / 2 + 3}
                                y={-rectHeight / 2 + 3}
                                width={rectWidth}
                                height={rectHeight}
                                rx={isRoot ? 10 : 7}
                                ry={isRoot ? 10 : 7}
                                fill="#5c4033"
                              />
                            )}

                            {/* Main Card Body */}
                            <rect
                              x={-rectWidth / 2}
                              y={-rectHeight / 2}
                              width={rectWidth}
                              height={rectHeight}
                              rx={isRoot ? 10 : 7}
                              ry={isRoot ? 10 : 7}
                              fill={cardBg}
                              stroke={cardStroke}
                              strokeWidth={theme === "cartoon" ? 2.5 : isSelected ? 2 : 1.25}
                              className="transition-all duration-300 shadow-md group-hover:scale-[1.03]"
                              filter={queryMatchFilter}
                            />

                            {/* Centered Node Label */}
                            <text
                              x={textXPosition}
                              y={1.2}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fill={textFillColor}
                              className={`text-[10px] select-none pointer-events-none transition-all ${textWeightClass}`}
                              style={{ filter: textDropShadow || undefined }}
                            >
                              {textLabel}
                            </text>

                            {/* Children count pill indicators aligned inside the right side of card */}
                            {node.childrenCount > 0 && (
                              <g transform={`translate(${rectWidth / 2 - 14}, 0)`}>
                                <circle
                                  r={7}
                                  fill={countBg}
                                  className="transition-all group-hover:scale-110"
                                />
                                <text
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  y={0.5}
                                  className="text-[8.5px] font-extrabold select-none pointer-events-none"
                                  fill={countColor}
                                >
                                  {node.childrenCount}
                                </text>
                              </g>
                            )}

                            {/* Premium Interactive Hover Tooltip for Truncated Nodes */}
                            {node.text.length > 18 && (
                              <g 
                                className="opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none select-none" 
                                transform={`translate(0, ${-rectHeight / 2 - 12})`}
                              >
                                <text
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  y={0}
                                  fill={tooltipTextColor}
                                  className="text-[9px] font-bold tracking-wide"
                                  style={{
                                    textShadow: theme === "geeker" 
                                      ? "0 0 4px rgba(16,185,129,0.9), 0 1px 1px #000" 
                                      : theme === "scientist" 
                                        ? "0 0 4px rgba(56,189,248,0.9), 0 1px 1px #000"
                                        : theme === "cartoon"
                                          ? "1px 1px 0px #fff, -1px -1px 0px #fff, 1px -1px 0px #fff, -1px 1px 0px #fff"
                                          : "1px 1px 1px #fff, -1px -1px 1px #fff, 1px -1px 1px #fff, -1px 1px 1px #fff"
                                  }}
                                >
                                  {node.text}
                                </text>
                              </g>
                            )}
                          </g>
                        );
                      })}
                    </g>
                  </g>
                </svg>
              ) : (
                <div className={emptyStateClass}>
                  <HelpCircle className={emptyStateIconClass} />
                  <p className="text-xs">{emptyStateText}</p>
                </div>
              )}

              {/* Interactive help tip inside Canvas area */}
              <div className="hidden lg:block">
                <div 
                  className={isHelpTipExpanded ? helpTipWrapperExpandedClass : helpTipWrapperCollapsedClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsHelpTipExpanded(!isHelpTipExpanded);
                  }}
                  title={!isHelpTipExpanded ? (displayLanguage === "zh" ? "展开星盘触控说明" : "Expand touch instructions") : (displayLanguage === "zh" ? "点击收起说明" : "Click to collapse")}
                >
                  {!isHelpTipExpanded ? (
                    <Info className="w-4 h-4" style={{ color: helpTipIconColor }} />
                  ) : (
                    <>
                      <p className={helpTipTitleClass}>
                        <Info className="w-3 h-3" style={{ color: helpTipIconColor }} />
                        <span>{displayLanguage === "zh" ? "星盘触控说明：" : "Canvas touch instructions:"}</span>
                      </p>
                      <p>{displayLanguage === "zh" ? <>1. 鼠标<strong>按住空白处拖拽</strong> 可以平移画布</> : <>1. <strong>Click and drag</strong> on empty space to pan the canvas</>}</p>
                      <p>{displayLanguage === "zh" ? <>2. 使用<strong>鼠标滚轮</strong> 可以对星轨进行缩放</> : <>2. Use <strong>mouse wheel</strong> to zoom in/out</>}</p>
                      <p>{displayLanguage === "zh" ? <>3. <strong>拖拉气泡节点</strong> 能够暂时锚定物理拉扯位置</> : <>3. <strong>Drag node bubbles</strong> to temporarily anchor their physical position</>}</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Drawer backdrop for mobile screens */}
      {!hideInspector && isMobileDrawerOpen && activeNode && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-45 xl:hidden animate-in fade-in duration-200"
          onClick={() => setIsMobileDrawerOpen(false)}
        />
      )}

      {/* Floating Panel / Side Column: Dynamic Question Inspector & Q&A Board */}
      {!hideInspector && (
        <div 
          className={`bg-white shadow-xs flex flex-col overflow-hidden transition-all duration-300
            fixed bottom-0 left-0 right-0 z-50 h-[80vh] rounded-t-2xl border-t border-x shadow-2xl xl:shadow-xs
            xl:relative xl:bottom-auto xl:left-auto xl:right-auto xl:z-auto xl:h-full xl:w-[480px] xl:shrink-0 xl:rounded-xl xl:border border-slate-200/80
            ${isMobileDrawerOpen && activeNode ? "translate-y-0" : "translate-y-full xl:translate-y-0"}
          `}
        >
          {activeNode ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            
            {/* Mobile Pull Indicator */}
            <div 
              className="flex justify-center py-2 xl:hidden bg-slate-50/80 border-b border-slate-100/50 cursor-pointer shrink-0"
              onClick={() => setIsMobileDrawerOpen(false)}
            >
              <div className="w-12 h-1.5 bg-slate-300 rounded-full" />
            </div>

            {/* Inspector Header / Metadata */}
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 space-y-2 shrink-0">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-0.5 uppercase tracking-wider">
                  <Compass className="w-2.5 h-2.5" />
                  <span>{displayLanguage === "zh" ? `星盘观察岗 ➔ 深度层级 ${activeNode.depth}` : `Inspector ➔ Depth Level ${activeNode.depth}`}</span>
                </span>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onNavigateToTree(activeNode.id)}
                    className="text-[10px] text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-0.5 font-bold cursor-pointer"
                    title={displayLanguage === "zh" ? "定位该问题节点在左边树层中的原位置" : "Locate original position in the tree view"}
                  >
                    <span>{displayLanguage === "zh" ? "定位到大纲树" : "Locate in Tree"}</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>

                  {/* Mobile Close Button */}
                  <button
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="xl:hidden p-1 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full transition cursor-pointer flex items-center justify-center"
                    title={displayLanguage === "zh" ? "收起解答栏" : "Collapse answer panel"}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Editable Question Title Block */}
              {isEditingTitle ? (
                <div className="space-y-1.5 pt-1">
                  <input
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 border border-indigo-400 focus:ring-1 focus:ring-indigo-100 rounded focus:outline-none font-medium bg-white text-slate-900"
                    placeholder={displayLanguage === "zh" ? "编辑问题文本..." : "Edit question text..."}
                  />
                  <div className="flex items-center gap-1.5 justify-end">
                    <button
                      onClick={() => setIsEditingTitle(false)}
                      className="px-2 py-1 bg-slate-100 rounded text-[10px] text-slate-600 hover:bg-slate-200 font-bold cursor-pointer"
                    >
                      {displayLanguage === "zh" ? "取消" : "Cancel"}
                    </button>
                    <button
                      onClick={handleSaveTitleEdit}
                      className="px-2 py-1 bg-indigo-600 text-white rounded text-[10px] hover:bg-indigo-700 font-bold cursor-pointer shadow-2xs"
                    >
                      {displayLanguage === "zh" ? "提交修改" : "Save Changes"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2 pt-1 group">
                  <h3 className="text-sm font-bold text-slate-800 leading-snug flex-1">
                    {activeNode.text}
                  </h3>
                  <button
                    onClick={() => setIsEditingTitle(true)}
                    className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded cursor-pointer transition opacity-0 group-hover:opacity-100"
                    title={displayLanguage === "zh" ? "重命名该提问内容" : "Rename Question"}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Answer Display and Sandbox Editor Block */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
              
              {/* Core Q&A Draft Area */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5 text-indigo-500" />
                    <span>{displayLanguage === "zh" ? "解答成果汇编" : "Answer Compilation"}</span>
                  </span>

                  {/* Complete Check Indicator */}
                  <span className={`text-[10px] font-bold flex items-center gap-1 ${
                    activeNode.hasAnswer 
                      ? "text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100" 
                      : "text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200"
                  }`}>
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{activeNode.hasAnswer ? (displayLanguage === "zh" ? "已编写研报" : "Answer Written") : (displayLanguage === "zh" ? "解答待完善" : "Pending Answer")}</span>
                  </span>
                </div>

                {/* Main Text Content container (Markdown Supported!) */}
                <div className="space-y-3">
                    {/* Rendered answer container strictly following guidelines */}
                    {activeNode.answer ? (
                      (() => {
                        const parsed = parseThinkAndContent(activeNode.answer);
                        const bilingualData = parseAnswersByLanguage(parsed.content);
                        let renderContent = bilingualData.default;
                        if (displayLanguage === "zh") renderContent = bilingualData.zh;
                        else if (displayLanguage === "en") renderContent = bilingualData.en;
                        else renderContent = `<div lang="zh">\n\n${bilingualData.zh}\n\n</div>\n\n---\n\n<div lang="en">\n\n${bilingualData.en}\n\n</div>`;

                        return (
                          <div className="markdown-body text-xs leading-relaxed text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-100">
                            {parsed.think && (
                              <details className="think-details mb-4 animate-in fade-in duration-300" open={false}>
                                <summary className="think-summary">
                                  <span className="flex items-center gap-1.5 align-middle select-none">
                                    <span className="inline-block text-amber-500 animate-[pulse_3s_infinite] font-semibold text-[11px]">🧠</span>
                                    <span className="text-[11px]">{displayLanguage === "zh" ? "思考过程 (已折叠，点击展开)" : "Thinking Process (Collapsed, click to expand)"}</span>
                                  </span>
                                </summary>
                                <div className="think-content border-t border-slate-100 dark:border-slate-800 mt-1">
                                  <ReactMarkdown 
                                    remarkPlugins={[remarkMath]}
                                    rehypePlugins={[rehypeRaw, rehypeKatex]}
                                  >
                                    {parsed.think}
                                  </ReactMarkdown>
                                </div>
                              </details>
                            )}

                            <div className="flex items-center justify-end gap-1.5 mb-2">
                              {foldHeadings && (
                                <div className="flex items-center gap-1.5 border-slate-200 text-[10px]">
                                  <button
                                    onClick={() => setAllOpenState("all_open")}
                                    className={`px-1.5 py-0.5 rounded-sm font-bold text-indigo-600 hover:bg-indigo-50 cursor-pointer transition-colors ${
                                      allOpenState === "all_open" ? "bg-indigo-50/70" : ""
                                    }`}
                                    title={displayLanguage === "zh" ? "一键展开说明区块内容" : "Expand all block contents"}
                                  >
                                    {displayLanguage === "zh" ? "全部展开" : "Expand All"}
                                  </button>
                                  <span className="text-slate-300">|</span>
                                  <button
                                    onClick={() => setAllOpenState("all_closed")}
                                    className={`px-1.5 py-0.5 rounded-sm font-bold text-slate-500 hover:bg-slate-100 cursor-pointer transition-colors ${
                                      allOpenState === "all_closed" ? "bg-slate-100" : ""
                                    }`}
                                    title={displayLanguage === "zh" ? "一键折叠收缩说明区块内容" : "Collapse all block contents"}
                                  >
                                    {displayLanguage === "zh" ? "全部折叠" : "Collapse All"}
                                  </button>
                                </div>
                              )}
                            </div>

                            <ReactMarkdown
                              remarkPlugins={[remarkMath]}
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
                                          onNavigateToTree(targetId);
                                        }}
                                        className="text-indigo-600 hover:text-indigo-800 font-bold underline underline-offset-4 decoration-indigo-300 hover:decoration-indigo-700 bg-indigo-50/50 hover:bg-indigo-50 px-1 py-0.5 rounded transition cursor-pointer"
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
                                        className="mx-auto rounded-xl border border-slate-200/80 shadow-md max-h-[220px] object-cover"
                                        {...props}
                                      />
                                    </span>
                                  );
                                }
                              }}
                            >
                              {foldHeadings ? makeMarkdownHeadingsCollapsible(renderContent, allOpenState) : renderContent}
                            </ReactMarkdown>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="border border-dashed border-slate-200 bg-slate-50/40 rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-2.5 text-slate-400">
                        <div className="p-2.5 bg-slate-100 rounded-full text-slate-300">
                          <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-650">{displayLanguage === "zh" ? "该问题当前为空白答案" : "This question currently has a blank answer"}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{displayLanguage === "zh" ? "您可以触发" : "You can trigger"} {localStorage.getItem("llm_provider") === "minimax" ? "MiniMax" : (localStorage.getItem("llm_provider") === "gemini" ? "Gemini" : (localStorage.getItem("llm_provider") || "Gemini").toUpperCase())} {displayLanguage === "zh" ? "AI 进行极速研讨大纲..." : "AI for rapid outline discussion..."}</p>
                        </div>
                      </div>
                    )}

                    {/* Operational Actions */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {/* AI integration from server-side proxy */}
                      <button
                        onClick={triggerAiAnswerInNetwork}
                        disabled={isGeneratingAnswer}
                        className="px-3.5 py-1.5 bg-indigo-600 disabled:opacity-50 text-white rounded hover:bg-indigo-700 text-[10px] font-bold flex items-center gap-1.5 transition cursor-pointer shadow-3xs"
                      >
                        <Cpu className="w-3.5 h-3.5" />
                        {isGeneratingAnswer ? (
                          <span>{localStorage.getItem("llm_provider") === "minimax" ? "MiniMax" : (localStorage.getItem("llm_provider") === "gemini" ? "Gemini" : (localStorage.getItem("llm_provider") || "Gemini").toUpperCase())} {displayLanguage === "zh" ? "分析中..." : "Analyzing..."}</span>
                        ) : (
                          <span>{displayLanguage === "zh" ? "AI 自动解答" : "AI Auto Answer"} ({localStorage.getItem("llm_provider") === "minimax" ? "MiniMax" : (localStorage.getItem("llm_provider") === "gemini" ? "Gemini" : (localStorage.getItem("llm_provider") || "Gemini").toUpperCase())})</span>
                        )}
                      </button>
                    </div>
                    
                    {apiError && (
                      <div className="p-3 bg-red-50 rounded border border-red-100 text-[11px] text-red-600 flex items-start gap-1.5">
                        <span className="font-bold">❌ Error:</span>
                        <span className="flex-1">{apiError}</span>
                      </div>
                    )}
                  </div>
                </div>

              {/* Nested Child node generator within the same node */}
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <ListCollapse className="w-3.5 h-3.5 text-indigo-500" />
                    <span>{displayLanguage === "zh" ? `子级衍生问题大纲 (${activeNode.childrenCount})` : `Child Derivative Outline (${activeNode.childrenCount})`}</span>
                  </span>

                  <button
                    onClick={() => {
                      setIsAddingSubQuestion(!isAddingSubQuestion);
                      setNewSubQuestionText("");
                    }}
                    className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>{displayLanguage === "zh" ? "+ 新建子问题" : "+ New Child Question"}</span>
                  </button>
                </div>

                {isAddingSubQuestion && (
                  <form onSubmit={handleAddSubQuestionSubmit} className="p-3 bg-slate-50 rounded-lg border border-slate-200/60 space-y-2">
                    <input
                      type="text"
                      autoFocus
                      placeholder={displayLanguage === "zh" ? "输入将要衍生讨论的具体细分子疑问..." : "Enter the specific child question to discuss..."}
                      value={newSubQuestionText}
                      onChange={(e) => setNewSubQuestionText(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-200 focus:outline-none focus:border-indigo-400 rounded text-slate-800 font-medium"
                    />
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        type="button"
                        onClick={() => setIsAddingSubQuestion(false)}
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-[10px] text-slate-500 font-bold"
                      >
                        {displayLanguage === "zh" ? "取消" : "Cancel"}
                      </button>
                      <button
                        type="submit"
                        disabled={!newSubQuestionText.trim()}
                        className="px-2.5 py-1 bg-indigo-600 text-white rounded text-[10px] font-bold hover:bg-indigo-700 shadow-2xs"
                      >
                        {displayLanguage === "zh" ? "生成新问题" : "Create New Question"}
                      </button>
                    </div>
                  </form>
                )}

                {/* Sub questions listing within inspector card */}
                {activeNode.childrenCount > 0 ? (
                  <div className="space-y-1.5">
                    {nodes
                      .filter((n) => n.parentId === activeNode.id)
                      .map((subNode) => (
                        <div
                          key={subNode.id}
                          onClick={() => handleNodeClick(subNode)}
                          className="px-3 py-2 bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-100 rounded-lg flex items-center justify-between text-xs text-slate-700 cursor-pointer transition group"
                        >
                          <span className="font-medium group-hover:text-indigo-900 truncate">
                            {subNode.text}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                            subNode.hasAnswer 
                              ? "bg-emerald-100 text-emerald-800" 
                              : "bg-slate-100 text-slate-400"
                          }`}>
                            {subNode.hasAnswer ? (displayLanguage === "zh" ? "已写" : "Written") : (displayLanguage === "zh" ? "未写" : "Unwritten")}
                          </span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-400 italic">{displayLanguage === "zh" ? "此提问暂无后续衍生的二级问题讨论节点。" : "This question currently has no subsequent derived child nodes."}</p>
                )}
              </div>

              {/* 3. Cross-group Cognitive Attraction Explorer */}
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                  <Compass className="w-3.5 h-3.5 text-indigo-500" />
                  <span>{displayLanguage === "zh" ? "🌠 跨组相关性星轨" : "🌠 Cross-group Correlation Link"} ({
                    crossLinks.filter(cl => cl.source === activeNode.id || cl.target === activeNode.id).length
                  })</span>
                </span>

                {(() => {
                  const myCrossLinks = crossLinks.filter(cl => 
                    cl.source === activeNode.id || cl.target === activeNode.id
                  );

                  if (myCrossLinks.length === 0) {
                    return (
                      <p className="text-[10px] text-slate-400 italic">
                        {displayLanguage === "zh" ? "在当前星盘设定下，当前节点未捕获与其他问题组的跨界关联轨道。" : "Under the current canvas scope, this node has not captured cross-boundary correlation links with other question groups."}
                      </p>
                    );
                  }

                  return (
                    <div className="space-y-2">
                      {myCrossLinks.map((cl, idx) => {
                        const otherId = cl.source === activeNode.id ? cl.target : cl.source;
                        const otherNode = nodes.find(n => n.id === otherId);
                        if (!otherNode) return null;

                        const originGroupNode = nodes.find(n => n.id === otherNode.rootId);
                        const groupLabel = originGroupNode ? originGroupNode.text : (displayLanguage === "zh" ? "其他问题组" : "Other group");

                        return (
                          <div
                            key={idx}
                            onClick={() => handleNodeClick(otherNode)}
                            className="p-2.5 bg-indigo-50/25 hover:bg-indigo-50 border border-indigo-150 rounded-lg flex flex-col gap-1.5 text-xs cursor-pointer transition-all hover:border-indigo-300"
                          >
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="font-bold text-indigo-800 bg-indigo-50/70 px-2 py-0.5 rounded max-w-[200px]">
                                {displayLanguage === "zh" ? "所属问题组:" : "Parent Group:"} {groupLabel}
                              </span>
                              <span className="font-mono text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded">
                                {displayLanguage === "zh" ? "相似比" : "Similarity"} {(cl.score * 100).toFixed(0)}%
                              </span>
                            </div>

                            <p className="font-medium text-slate-700 leading-snug hover:text-indigo-900">
                              {otherNode.text}
                            </p>

                            {cl.sharedKeywords && cl.sharedKeywords.length > 0 && (
                              <div className="flex flex-wrap gap-1 items-center">
                                <span className="text-[9px] text-slate-400 font-bold shrink-0">{displayLanguage === "zh" ? "重合词:" : "Overlap:"}</span>
                                {cl.sharedKeywords.map((kw, kwIdx) => (
                                  <span
                                    key={kwIdx}
                                    className="text-[9px] px-1.5 py-0.2 bg-white text-slate-600 border border-slate-200/80 font-bold rounded"
                                  >
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Footer deletion utility inside observe card */}
            <div className="p-3 bg-red-50/20 border-t border-slate-100 flex items-center justify-between shrink-0">
              <span className="text-[10px] text-slate-400 font-mono">ID: {activeNode.id}</span>
              <button
                onClick={() => {
                  onDeleteNode(activeNode.id);
                  // Selection resets automatically to parent
                }}
                className="px-2 md:px-2.5 py-1 bg-white border border-red-200 text-red-600 rounded hover:bg-red-50 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition"
                title={displayLanguage === "zh" ? "删除此提问及子集" : "Delete Question and Children"}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{displayLanguage === "zh" ? "彻底移除此节点" : "Remove Node Completely"}</span>
              </button>
            </div>

          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 space-y-2">
            <Sliders className="w-10 h-10 text-slate-200 mb-1" />
            <p className="text-xs font-bold text-slate-700">{displayLanguage === "zh" ? "没有选定需要审计的提问节点" : "No question node selected for inspection"}</p>
            <p className="text-[10px] text-slate-400 leading-relaxed max-w-xs">
              {displayLanguage === "zh" ? "在左侧的力学树形星空中单点击中任意星体气泡，以便实时观测它的路径详情、修改报告大纲并执行 AI 深度解构等操作。" : "Single-click any star bubble in the force-directed tree map on the left to observe its path details in real time, modify the report outline, and execute AI deep deconstruction."}
            </p>
          </div>
        )}
      </div>
      )}

    </div>
  );
}
