export interface QuestionNode {
  id: string;
  text: string;
  en_text?: string;
  answer: string;
  isExpanded: boolean;
  children: QuestionNode[];
  createdAt: number;
}

export type AISuggestion = {
  text: string;
  reason: string;
  en_text?: string;
  en_reason?: string;
};
