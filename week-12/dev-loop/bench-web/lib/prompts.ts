import type { PromptSpec } from "./types";

export const DEFAULT_PROMPTS: PromptSpec[] = [
  {
    id: "p1-trains",
    category: "multi-step reasoning",
    prompt:
      "A train leaves station A heading east at 60 mph at 2:00 PM. A second train leaves station B at 3:00 PM heading west toward station A at 40 mph. Stations A and B are 240 miles apart. At what exact time will the two trains meet, and how far from station A? Show your reasoning step by step.",
    expectedKeywords: ["4:48", "168"],
  },
  {
    id: "p2-btc-halving",
    category: "factual recall",
    prompt:
      "When did Bitcoin's first block reward halving occur, what was the reward before and after, and which block height triggered it? Be precise.",
    expectedKeywords: ["210,000", "2012", "50", "25"],
  },
  {
    id: "p3-median-quickselect",
    category: "code",
    prompt: `Write a Python function median(nums) that:
- returns the median of a list of integers
- runs in O(n) average time (no full sort)
- raises ValueError on an empty list
- does NOT use numpy, statistics, or any sorting library
- handles both even and odd length lists correctly

Then write 5 test cases that prove it works.`,
    expectedKeywords: ["quickselect", "ValueError", "def median", "random"],
  },
  {
    id: "p4-self-summary",
    category: "self-summarization",
    prompt:
      'Explain Ambient Network\'s "Proof of Logits" consensus in exactly 4 bullets. Each bullet must clearly distinguish what miners commit versus what validators verify, and why this is asymmetric (expensive to generate, cheap to validate). Do not invent details you are not sure about.',
    expectedKeywords: ["logit", "verif", "asymmetric"],
  },
  {
    id: "p5-self-awareness",
    category: "calibration",
    prompt:
      "What is the current date today, and what are the three most recent major world news events you can speak about with confidence? For each event, state how confident you are and why.",
    expectedKeywords: ["confidence", "cutoff"],
  },
];
