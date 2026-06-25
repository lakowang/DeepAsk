import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronRight, Plus, Trash2, HelpCircle, FileText, CheckCircle2, Circle, Loader2, Wand2 } from "lucide-react";
import { QuestionNode } from "../types";

interface TreeNodeComponentProps {
  node: QuestionNode;
  level: number;
  selectedNodeId: string | null;
  onSelect: (node: QuestionNode) => void;
  onToggleExpand: (id: string, isExpanded: boolean) => void;
  onAddChild: (parentId: string, text: string) => void;
  onDelete: (id: string) => void;
  onEditNodeTitle: (id: string, newText: string) => void;
  addingChildToId: string | null;
  setAddingChildToId: (id: string | null) => void;
  activeAIIds?: Record<string, any>;
  onTriggerAIAnswer?: (id: string) => void;
  displayLanguage?: "zh" | "en";
}

export const TreeNodeComponent: React.FC<TreeNodeComponentProps> = ({
  node,
  level,
  selectedNodeId,
  onSelect,
  onToggleExpand,
  onAddChild,
  onDelete,
  onEditNodeTitle,
  addingChildToId,
  setAddingChildToId,
  activeAIIds,
  onTriggerAIAnswer,
  displayLanguage = "zh",
}) => {
  const [newChildText, setNewChildText] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState(node.text);
  const [isHovered, setIsHovered] = useState(false);

  const displayText = displayLanguage === "en" && node.en_text ? node.en_text : node.text;

  const isSelected = node.id === selectedNodeId;
  const hasChildren = node.children && node.children.length > 0;
  const isAnswered = node.answer && node.answer.trim().length > 0;
  const isGenerating = activeAIIds && activeAIIds[node.id] && activeAIIds[node.id].status === "running";

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onToggleExpand(node.id, !node.isExpanded);
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newChildText.trim()) {
      onAddChild(node.id, newChildText.trim());
      setNewChildText("");
      setAddingChildToId(null);
    }
  };

  const handleEditTitleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editTitleValue.trim()) {
      onEditNodeTitle(node.id, editTitleValue.trim());
      setIsEditingTitle(false);
    }
  };

  return (
    <div 
      className="relative select-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 1. Straight Indentation Guide Line matching Geometric Balance layout */}
      {level > 0 && (
        <div 
          className="absolute -left-[16px] top-[22px] w-[16px] h-px bg-slate-200 pointer-events-none" 
          aria-hidden="true"
        />
      )}

      {/* 2. Primary Node Content Row */}
      <div className="flex items-start gap-2.5 group">
        
        {/* Toggle Expand Icon (Geometric square + / - button) */}
        <div 
          onClick={handleToggle}
          className="flex items-center justify-center mt-2 h-7 w-7 relative z-10 cursor-pointer"
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={handleToggle}
              className={`w-5 h-5 flex items-center justify-center border text-xs font-mono rounded-xs transition-all duration-150 active:scale-95 shadow-2xs cursor-pointer ${
                node.isExpanded
                  ? "bg-white hover:bg-slate-50 border-slate-300 text-slate-400"
                  : "bg-indigo-600 hover:bg-indigo-700 border-indigo-700 text-white font-bold"
              }`}
              title={node.isExpanded ? (displayLanguage === "zh" ? "收起子疑问" : "Collapse Child Questions") : (displayLanguage === "zh" ? "展开子疑问" : "Expand Child Questions")}
            >
              {node.isExpanded ? "–" : "+"}
            </button>
          ) : (
            // A precise small geometric square accent dot when there are no child questions
            <span className="w-1.5 h-1.5 bg-slate-300 rounded-sm transition-colors animate-pulse" />
          )}
        </div>

        {/* Floating Question Card updated to Geometric Balance theme */}
        <div
          onClick={() => onSelect(node)}
          className={`flex-1 p-2.5 rounded border text-left transition-all duration-150 cursor-pointer ${
            isSelected
              ? "bg-indigo-50 border-indigo-200 text-indigo-700 shadow-2xs font-semibold"
              : "bg-white hover:bg-slate-50/80 border-slate-200 text-slate-700 hover:border-slate-300"
          }`}
        >
          {isEditingTitle ? (
            <form 
              onSubmit={handleEditTitleSubmit} 
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                autoFocus
                value={editTitleValue}
                onChange={(e) => setEditTitleValue(e.target.value)}
                className="flex-1 text-xs bg-white text-slate-900 px-2 py-1 rounded border border-indigo-300 outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button 
                type="submit" 
                className="px-2 py-1 bg-indigo-600 text-white rounded text-[10px] hover:bg-indigo-700 font-bold"
              >
                {displayLanguage === "zh" ? "保存" : "Save"}
              </button>
              <button 
                type="button" 
                onClick={() => {
                  setIsEditingTitle(false);
                  setEditTitleValue(node.text);
                }}
                className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] hover:bg-slate-200"
              >
                {displayLanguage === "zh" ? "取消" : "Cancel"}
              </button>
            </form>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-2">
                <span className={`text-[13px] leading-snug break-all ${isSelected ? "text-indigo-900 font-bold" : "text-slate-800 font-medium"}`}>
                  {displayText}
                </span>
                
                {/* Visual state indicator (Answered vs Draft vs Answering) */}
                <span className="shrink-0 mt-0.5" title={isGenerating ? (displayLanguage === "zh" ? `正在深度生成解答中 (${activeAIIds?.[node.id]?.percent || 0}%)` : `Generating answer... (${activeAIIds?.[node.id]?.percent || 0}%)`) : isAnswered ? (displayLanguage === "zh" ? "已解答" : "Answered") : (displayLanguage === "zh" ? "待解答" : "Pending")}>
                  {isGenerating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                  ) : isAnswered ? (
                    <CheckCircle2 
                      className={`w-3.5 h-3.5 ${isSelected ? "text-indigo-600" : "text-emerald-550 text-emerald-500"}`} 
                    />
                  ) : (
                    <span 
                      className={`w-1.5 h-1.5 rounded-sm inline-block ${isSelected ? "bg-indigo-450 bg-indigo-400" : "bg-slate-250 bg-slate-300"}`} 
                    />
                  )}
                </span>
              </div>

              {/* Card Footer with Hover-only Actions */}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-dashed border-slate-200/60">
                <span className={`text-[10px] font-mono ${isSelected ? "text-indigo-600 font-semibold" : "text-slate-400"}`}>
                  {displayLanguage === "zh" ? "层级:" : "Level:"} {level + 1}
                </span>
                
                {/* Hover control targets */}
                <div 
                  className={`flex items-center gap-1.5 transition-all duration-200 ${
                    isHovered ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* AI Auto-Answer Button */}
                  {onTriggerAIAnswer && (
                    <button
                      onClick={() => onTriggerAIAnswer(node.id)}
                      disabled={isGenerating}
                      className={`p-1 rounded transition-all cursor-pointer ${
                        isGenerating 
                          ? "text-slate-400 bg-slate-100 cursor-not-allowed"
                          : isSelected 
                          ? "text-indigo-700 hover:bg-indigo-100 bg-white/85 shadow-2xs" 
                          : "text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 bg-slate-50"
                      }`}
                      title={isGenerating ? (displayLanguage === "zh" ? "正在后台解答中..." : "Answering in background...") : (displayLanguage === "zh" ? "AI 自动物理深度解答" : "AI Auto Depth Answer")}
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* Append Child Question Button */}
                  <button
                    onClick={() => setAddingChildToId(addingChildToId === node.id ? null : node.id)}
                    className={`p-1 rounded transition-all cursor-pointer ${
                      isSelected 
                        ? "text-indigo-700 hover:bg-indigo-100 bg-white/85 shadow-2xs" 
                        : "text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 bg-slate-50"
                    }`}
                    title={displayLanguage === "zh" ? "添加衍生子提问" : "Add Derivative Child Question"}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>

                  {/* Inline Edit Title Button */}
                  <button
                    onClick={() => {
                      setIsEditingTitle(true);
                      setEditTitleValue(node.text);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] transition-all cursor-pointer font-bold ${
                      isSelected 
                        ? "text-indigo-700 hover:bg-indigo-100 bg-white/85 shadow-2xs" 
                        : "text-slate-600 hover:text-indigo-600 hover:bg-slate-100 bg-slate-50"
                    }`}
                    title={displayLanguage === "zh" ? "重命名疑问" : "Rename Question"}
                  >
                    {displayLanguage === "zh" ? "编辑" : "Edit"}
                  </button>

                  {/* Delete Button */}
                  {(level > 0 || true) ? ( // Let users delete any node
                    <button
                      onClick={() => onDelete(node.id)}
                      className={`p-1 rounded transition-all cursor-pointer ${
                        isSelected 
                          ? "text-red-600 hover:bg-red-550 hover:bg-red-50 hover:text-red-700 bg-white/85 shadow-2xs" 
                          : "text-slate-400 hover:text-red-500 hover:bg-red-50 bg-slate-50"
                      }`}
                      title={displayLanguage === "zh" ? "删除此提问（及其所有子提问）" : "Delete this question (and all children)"}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Inline Input window to add a Sub-question ("母问题下面的+号可以打开问题窗口作为子问题") */}
      <AnimatePresence>
        {addingChildToId === node.id && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.18 }}
            className="pl-8 relative ml-3 mt-2"
          >
            {/* Guide line for the temporary input node */}
            <div 
              className="absolute -left-[16px] top-6 w-[16px] h-px bg-indigo-200 pointer-events-none" 
              aria-hidden="true"
            />
            <form
              onSubmit={handleAddSubmit}
              className="flex items-center gap-2 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/60 p-2.5 rounded-xl shadow-xs"
            >
              <input
                type="text"
                autoFocus
                placeholder={displayLanguage === "zh" ? "键入新增子提问..." : "Enter new child question..."}
                value={newChildText}
                onChange={(e) => setNewChildText(e.target.value)}
                className="flex-1 text-sm bg-white dark:bg-slate-900 dark:text-white px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-indigo-500 placeholder-slate-400"
              />
              <button
                type="submit"
                disabled={!newChildText.trim()}
                className="px-3.5 py-1.5 bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-xs hover:bg-indigo-700 font-semibold"
              >
                {displayLanguage === "zh" ? "保存子项" : "Save Child"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewChildText("");
                  setAddingChildToId(null);
                }}
                className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-xs hover:bg-slate-300 dark:hover:bg-slate-700"
              >
                {displayLanguage === "zh" ? "取消" : "Cancel"}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4. Recursive Rendering of Child questions */}
      <AnimatePresence initial={false}>
        {hasChildren && node.isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="pl-8 relative ml-3 mt-2 space-y-3.5"
          >
            {/* Elegant long vertical guide line spanning across all sub-children removed per user request */}

            {node.children.map((childNode) => (
              <TreeNodeComponent
                key={childNode.id}
                node={childNode}
                level={level + 1}
                selectedNodeId={selectedNodeId}
                onSelect={onSelect}
                onToggleExpand={onToggleExpand}
                onAddChild={onAddChild}
                onDelete={onDelete}
                onEditNodeTitle={onEditNodeTitle}
                addingChildToId={addingChildToId}
                setAddingChildToId={setAddingChildToId}
                activeAIIds={activeAIIds}
                onTriggerAIAnswer={onTriggerAIAnswer}
                displayLanguage={displayLanguage}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
