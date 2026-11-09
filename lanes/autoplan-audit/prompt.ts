// Copyright (c) 2026 Garry Tan. MIT License.
// Section 6's frozen panel question and labels. The packet is PROMPT_HEAD, the change, the built plan and PROMPT_TAIL;
// nothing else goes to a judge.
export const PROMPT_HEAD = [
  "You are checking a written plan against one change that was accepted for it.",
  "Question: Does the built plan state this change, in any words?",
  "Answer with one of four labels:",
  "- LANDED: the specific rule, number, condition or section the change asks for is stated in the built plan.",
  "- PARTLY: some but not all of a multi-part change is stated.",
  "- NOT_LANDED: the change is not stated.",
  "- REVERSED: the built plan states the opposite of the change.",
  "Judge only from the built plan below. Words may differ; the substance must be there.",
].join("\n");

export const PROMPT_TAIL = [
  "Reason as briefly as you need. Then end your reply with one line that holds one JSON object and nothing else:",
  '{"label": "LANDED" | "PARTLY" | "NOT_LANDED" | "REVERSED", "quote": "<at most 30 words copied exactly from the built plan that show your label; empty for NOT_LANDED>"}',
].join("\n");
