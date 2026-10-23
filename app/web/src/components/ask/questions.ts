// Shared Ask contract: imported by the Ask drawer (client) and by lib/ask.ts (server). Plain module.

export const SUGGESTED_QUESTIONS = ["Who is overdue on SpO2?", "Which drafts are waiting and why?", "What did the last threshold edit change?"] as const;
export const ASK_STEPS = ["Understand", "Query", "Check", "Answer"] as const;
export type AskStep = (typeof ASK_STEPS)[number];
export type AskSource = "live" | "recorded";
export interface AskCheck { sql_present: boolean; safety_terms_ok: boolean | null; notes: string | null; }
export interface AskAgentAnswer {
  question: string;
  answer: string | null;        // plain sentences from the agent
  sql: string | null;           // SQL the agent's CareAnalyst tool generated
  source: AskSource;            // 'live' = agent answered now; 'recorded' = from ASK_CACHE / fixture
  model: string | null;         // model id taken from the response or from Snowflake, never hard-coded
  recorded_at: string | null;   // ISO timestamp for recorded answers
  label: string;                // "Live answer" or "Recorded answer (<recorded_at formatted>)"
  message: string | null;       // calm one-line reason when it fell back, else null
  check: AskCheck;
}
