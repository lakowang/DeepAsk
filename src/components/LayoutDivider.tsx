import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";

export const LayoutDivider = ({ 
  isExpanded, 
  onToggle 
}: { 
  isExpanded: boolean; 
  onToggle: () => void; 
}) => (
  <button
    onClick={onToggle}
    className="w-4 bg-slate-100 hover:bg-slate-200 border-x border-slate-200 flex items-center justify-center cursor-pointer transition-colors z-20"
  >
    <motion.div
      animate={{ rotate: isExpanded ? 180 : 0 }}
      transition={{ type: "spring", damping: 20, stiffness: 200 }}
    >
      <ChevronRight className="w-4 h-4 text-slate-500" />
    </motion.div>
  </button>
);
