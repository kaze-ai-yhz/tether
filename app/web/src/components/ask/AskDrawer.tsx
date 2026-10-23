"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextField,
} from "react-aria-components";
import { Button } from "../Button";
import chips from "../chips.module.css";
import { cx } from "../cx";
import { ErrorState } from "../ErrorState";
import { Icon } from "../icons";
import { StepLoader } from "../StepLoader";
import { postJson } from "../shell/request";
import { SUGGESTED_QUESTIONS, type AskAgentAnswer } from "./questions";
import { SqlDisclosure } from "./SqlDisclosure";
import { StepProgress, stepStatus, type AskPhase } from "./StepProgress";
import styles from "./ask.module.css";

export interface AskDrawerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Asked as soon as the drawer opens with it (e.g. a KPI tile's question). */
  initialQuestion?: string;
}

interface AskError {
  text: string;
  code: string | null;
}

const NO_ANSWER = "There is no recorded answer for this question yet. Try one of the suggested questions.";

/** Splits plain answer text into paragraphs on blank lines; single line breaks stay inside a paragraph. */
function paragraphsOf(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Marker label for the answer's provenance; the model id comes from the response, never hard-coded. */
function Provenance({ model }: { model: string | null }) {
  return (
    <span className={cx(chips.chip, chips.md, chips.marker, styles.provenance)} data-model={model ?? undefined}>
      <span className={chips.markerGlyph} aria-hidden="true" />
      <span className={styles.provenanceText}>Answered by Cortex Agent · {model ?? "model not reported"}</span>
    </span>
  );
}

function AnswerBlock({ answer, fixtures }: { answer: AskAgentAnswer; fixtures: boolean }) {
  const paragraphs = paragraphsOf(answer.answer);
  const hasAnswer = paragraphs.length > 0;
  const flagged = answer.check?.safety_terms_ok === false;
  const checkNotRun = answer.check?.safety_terms_ok == null ? answer.check?.notes ?? null : null;
  return (
    <article className={styles.answer} aria-label="Answer">
      <div className={styles.answerMeta}>
        <span className={styles.answerLabel}>{answer.label}</span>
        {fixtures ? <span className={cx(chips.chip, chips.sm, chips.neutral)}>Sample data</span> : null}
      </div>
      {hasAnswer ? (
        <>
          {answer.message ? (
            <p className={styles.note}>
              <Icon name="info" size={14} className={styles.noteIcon} />
              <span>{answer.message}</span>
            </p>
          ) : null}
          <div className={styles.answerText}>
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          {flagged ? (
            <p className={styles.caution} role="note">
              <Icon name="triangle" size={14} className={styles.noteIcon} />
              <span>{answer.check?.notes ?? "The safety terms check flagged this answer. Read it with care."}</span>
            </p>
          ) : null}
          {checkNotRun ? (
            <p className={styles.note}>
              <span>{checkNotRun}</span>
            </p>
          ) : null}
          <Provenance model={answer.model} />
        </>
      ) : (
        <p className={styles.muted}>{answer.message ?? NO_ANSWER}</p>
      )}
      {hasAnswer || answer.sql ? <SqlDisclosure sql={answer.sql} /> : null}
    </article>
  );
}

/** Right-edge drawer that asks Cortex Agent about the queue, rules and readings and shows the SQL it ran. */
export function AskDrawer({ isOpen, onOpenChange, initialQuestion }: AskDrawerProps) {
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<AskPhase>("idle");
  const [answer, setAnswer] = useState<AskAgentAnswer | null>(null);
  const [error, setError] = useState<AskError | null>(null);
  const [fixtures, setFixtures] = useState(false);
  const [lastAsked, setLastAsked] = useState("");
  const requestId = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const askedInitial = useRef<string | null>(null);
  const asking = phase === "asking";

  async function ask(raw: string) {
    const text = raw.trim();
    if (!text || asking) return;
    const id = ++requestId.current;
    setQuestion(text);
    setLastAsked(text);
    setPhase("asking");
    setAnswer(null);
    setError(null);
    const outcome = await postJson<AskAgentAnswer>("/api/ask/agent", { question: text });
    if (id !== requestId.current) return;
    setFixtures(outcome.fixtures);
    if (outcome.ok && outcome.data) {
      setAnswer(outcome.data);
      setPhase("answered");
    } else {
      setError({ text: outcome.text, code: outcome.code });
      setPhase("error");
    }
  }

  // The input and the suggestions are disabled or hidden while asking; focus moves to the result
  // region once it holds the loader (an empty region is display: none and cannot take focus).
  useEffect(() => {
    if (asking) resultRef.current?.focus();
  }, [asking]);

  // Asks the initial question once per distinct value when the drawer opens with one.
  useEffect(() => {
    if (!isOpen || !initialQuestion?.trim() || askedInitial.current === initialQuestion) return;
    const timer = setTimeout(() => {
      askedInitial.current = initialQuestion;
      void ask(initialQuestion);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialQuestion]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  const status = stepStatus(phase, answer);

  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className={styles.overlay}>
      <Modal className={styles.drawer}>
        <Dialog className={styles.dialog}>
          {({ close }) => (
            <>
              <header className={styles.header}>
                <div className={styles.headerText}>
                  <Heading slot="title" className={styles.title}>
                    Ask
                  </Heading>
                  <p className={styles.subtitle}>
                    Questions about the queue, rules and readings. Synthetic data. Answers show the SQL that ran.
                  </p>
                </div>
                <Button variant="tertiary" size="sm" icon="close" iconOnly aria-label="Close Ask" onPress={close} />
              </header>

              <div className={styles.body}>
                <form className={styles.form} onSubmit={onSubmit}>
                  <TextField value={question} onChange={setQuestion} isDisabled={asking} className={styles.field}>
                    <Label className={styles.label}>Question</Label>
                    <div className={styles.inputRow}>
                      <Input className={styles.input} placeholder="Ask about drafts, rules or readings" />
                      <Button type="submit" variant="primary" isDisabled={!question.trim()} isPending={asking}>
                        Ask
                      </Button>
                    </div>
                  </TextField>
                </form>

                <StepProgress status={status} />

                <div ref={resultRef} className={styles.result} tabIndex={-1} aria-live="polite" aria-busy={asking}>
                  {asking ? <StepLoader label="Asking Cortex Agent…" /> : null}
                  {phase === "answered" && answer ? <AnswerBlock answer={answer} fixtures={fixtures} /> : null}
                  {phase === "error" && error ? (
                    <ErrorState
                      title="Could not get an answer"
                      message={error.text}
                      code={error.code}
                      onRetry={lastAsked ? () => void ask(lastAsked) : undefined}
                      retryLabel="Ask again"
                    />
                  ) : null}
                </div>

                {asking ? null : (
                  <section className={styles.suggestions} aria-labelledby="ask-suggestions-label">
                    <h3 id="ask-suggestions-label" className={styles.label}>
                      Suggested questions
                    </h3>
                    <ul className={styles.suggestionList}>
                      {SUGGESTED_QUESTIONS.map((suggestion) => (
                        <li key={suggestion}>
                          <AriaButton className={styles.suggestion} onPress={() => void ask(suggestion)}>
                            <Icon name="ask" size={14} className={styles.suggestionIcon} />
                            <span>{suggestion}</span>
                          </AriaButton>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** Top bar "Ask" button that opens the Ask drawer. */
export function AskTrigger() {
  const [isOpen, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      <Button variant="tertiary" size="sm" icon="ask">
        Ask
      </Button>
      <AskDrawer isOpen={isOpen} onOpenChange={setOpen} />
    </DialogTrigger>
  );
}
