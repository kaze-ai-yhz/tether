"use client";

import { useRef, useState } from "react";
import {
  Dialog,
  FieldError,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  Radio,
  RadioGroup,
  Text,
  TextArea,
  TextField,
} from "react-aria-components";
import type { RuleEditResult, RuleField, RuleRow } from "@/lib/types";
import { MIN_REASON_LENGTH } from "@/lib/validate";
import { Button } from "../Button";
import { cx } from "../cx";
import dialogStyles from "../dialog.module.css";
import { Icon } from "../icons";
import { postJson } from "../shell/request";
import { StepLoader } from "../StepLoader";
import { Arrow, ImpactSummary } from "./ImpactSummary";
import { FIELD_LABEL, editableFields, formatValue, readImpact, toNumber, type ImpactView } from "./rules-format";
import styles from "./rules.module.css";

/** Start values for the dialog, e.g. a revert to the value before the last save. */
export interface EditPrefill {
  field: RuleField;
  value: string;
}

/** What a successful POST /api/rules/:id returned, for the result row and the revert offer. */
export interface SavedEdit {
  ruleId: string;
  field: RuleField;
  /** Value before the save as UPDATE_RULE reports it, else the value the dialog opened with. */
  oldValue: string | null;
  newValue: string | null;
  /** UPDATE_RULE's message, if any. */
  message: string | null;
  /** Changed V_RULE_FIRINGS rows from the response; null in fixture mode or when none were returned. */
  impact: ImpactView | null;
  /** Fixture mode: nothing was saved. */
  fixtures: boolean;
}

export interface EditRuleDialogProps {
  rule: RuleRow | null;
  prefill: EditPrefill | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (saved: SavedEdit) => void;
}

/** Edit threshold (clinician only): field, new value, reason; preview the impact, then save. */
export function EditRuleDialog({ rule, prefill, isOpen, onClose, onSaved }: EditRuleDialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen && rule !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={dialogStyles.overlay}
    >
      <Modal className={dialogStyles.modal}>
        <Dialog className={dialogStyles.dialog}>
          {({ close }) => (rule ? <EditForm rule={rule} prefill={prefill} close={close} onSaved={onSaved} /> : null)}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

type Parsed = { ok: true; value: number } | { ok: false; message: string | null };

/** Mirrors the route's checks so the buttons enable only for values the API accepts. */
function parseValue(field: RuleField, text: string): Parsed {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, message: null };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false, message: "Use digits only, with an optional decimal point." };
  const value = Number(trimmed);
  if ((field === "window_days" || field === "min_readings") && (!Number.isInteger(value) || value < 1)) {
    return { ok: false, message: `${FIELD_LABEL[field]} must be a whole number of 1 or more.` };
  }
  return { ok: true, value };
}

function messageOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const message = (data as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : null;
}

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "done";
      field: RuleField;
      value: number;
      impact: ImpactView | null;
      message: string | null;
    }
  | { kind: "error"; text: string; code: string | null };

interface EditFormProps {
  rule: RuleRow;
  prefill: EditPrefill | null;
  close: () => void;
  onSaved: (saved: SavedEdit) => void;
}

function EditForm({ rule, prefill, close, onSaved }: EditFormProps) {
  const fields = editableFields(rule);
  const startField = prefill && fields.includes(prefill.field) ? prefill.field : (fields[0] ?? null);
  const [field, setField] = useState<RuleField | null>(startField);
  const [valueText, setValueText] = useState(() => {
    if (!startField) return "";
    return prefill && prefill.field === startField ? prefill.value : (formatValue(rule[startField]) ?? "");
  });
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ text: string; code: string | null } | null>(null);
  // Bumped on every input change so a late preview response for old inputs is ignored.
  const previewTicket = useRef(0);

  if (!field) {
    return (
      <>
        <Heading slot="title" className={dialogStyles.title}>
          Edit threshold · <span className={styles.dialogRule}>{rule.rule_id}</span>
        </Heading>
        <p className={dialogStyles.description}>V_RULES lists no editable threshold for this rule.</p>
        <div className={dialogStyles.actions}>
          <Button variant="tertiary" onPress={close} autoFocus>
            Close
          </Button>
        </div>
      </>
    );
  }

  const current = toNumber(rule[field]);
  const currentText = formatValue(rule[field]);
  const parsed = parseValue(field, valueText);
  const same = parsed.ok && current !== null && parsed.value === current;
  const reasonCount = reason.trim().length;
  const reasonReady = reasonCount >= MIN_REASON_LENGTH;
  const canPreview = parsed.ok && preview.kind !== "loading" && !saving;
  const canSave = parsed.ok && !same && reasonReady;
  const ruleUrl = `/api/rules/${encodeURIComponent(rule.rule_id)}`;

  function clearPreview() {
    previewTicket.current += 1;
    setPreview({ kind: "idle" });
  }

  function changeField(next: string) {
    const nextField = next as RuleField;
    setField(nextField);
    setValueText(formatValue(rule[nextField]) ?? "");
    clearPreview();
  }

  function changeValue(text: string) {
    setValueText(text);
    clearPreview();
  }

  async function runPreview(target: RuleField, value: number) {
    previewTicket.current += 1;
    const ticket = previewTicket.current;
    setPreview({ kind: "loading" });
    const outcome = await postJson<RuleEditResult>(`${ruleUrl}/preview`, { field: target, value });
    if (ticket !== previewTicket.current) return;
    if (!outcome.ok) {
      setPreview({ kind: "error", text: outcome.text, code: outcome.code });
      return;
    }
    setPreview({
      kind: "done",
      field: target,
      value,
      impact: outcome.fixtures ? null : readImpact(outcome.data),
      message: messageOf(outcome.data),
    });
  }

  async function save(target: RuleField, value: number) {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const outcome = await postJson<RuleEditResult>(ruleUrl, { field: target, value, reason: reason.trim() });
    setSaving(false);
    if (!outcome.ok) {
      setSaveError({ text: outcome.text, code: outcome.code });
      return;
    }
    const data = outcome.data;
    onSaved({
      ruleId: rule.rule_id,
      field: target,
      oldValue: formatValue(data?.old_value) ?? currentText,
      newValue: formatValue(data?.new_value) ?? formatValue(value),
      message: messageOf(data),
      impact: outcome.fixtures ? null : readImpact(data),
      fixtures: outcome.fixtures,
    });
    close();
  }

  const previewFailedOnSnowflake =
    preview.kind === "error" && (preview.code === "SNOWFLAKE_ERROR" || preview.code === "SNOWFLAKE_REFUSED");

  return (
    <form
      className={dialogStyles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave && parsed.ok) void save(field, parsed.value);
      }}
    >
      <Heading slot="title" className={dialogStyles.title}>
        Edit threshold · <span className={styles.dialogRule}>{rule.rule_id}</span>
      </Heading>
      <div className={cx(dialogStyles.description, styles.dialogContext)}>
        <span className={styles.dialogStep}>{rule.step}</span>
        {rule.citation ? <span className={styles.dialogCitation}>{rule.citation}</span> : null}
        {prefill ? (
          <span className={styles.dialogCitation}>Prefilled with the value before the last save. A reason is still needed.</span>
        ) : null}
      </div>

      {rule.is_red_flag ? (
        <p className={styles.dialogFloor}>
          <Icon name="triangle" size={14} />
          <span>
            Floor: cannot be loosened. UPDATE_RULE refuses an edit that would make this red flag fire less often.
          </span>
        </p>
      ) : null}

      {fields.length > 1 ? (
        <RadioGroup
          value={field}
          onChange={changeField}
          orientation="horizontal"
          isDisabled={saving}
          className={dialogStyles.field}
        >
          <Label className={dialogStyles.label}>Field</Label>
          <div className={styles.segments}>
            {fields.map((option) => (
              <Radio key={option} value={option} className={styles.segment}>
                {({ isSelected }) => (
                  <>
                    <span className={styles.segmentLabel}>
                      {isSelected ? <Icon name="check" size={14} /> : null}
                      {FIELD_LABEL[option]}
                    </span>
                    <span className={styles.segmentNow}>now {formatValue(rule[option]) ?? "—"}</span>
                  </>
                )}
              </Radio>
            ))}
          </div>
        </RadioGroup>
      ) : (
        <div className={styles.staticField}>
          <span className={dialogStyles.label}>Field</span>
          <span>
            {FIELD_LABEL[field]} <span className={styles.segmentNow}>now {currentText ?? "—"}</span>
          </span>
        </div>
      )}

      <TextField
        value={valueText}
        onChange={changeValue}
        isInvalid={!parsed.ok && parsed.message !== null}
        isDisabled={saving}
        validationBehavior="aria"
        className={dialogStyles.field}
      >
        <Label className={dialogStyles.label}>New value</Label>
        <Input className={styles.input} inputMode="decimal" autoComplete="off" autoFocus />
        <Text slot="description" className={dialogStyles.hint}>
          {same ? `Same as the current value (${currentText}).` : `Now ${currentText ?? "—"}`}
        </Text>
        <FieldError className={styles.fieldError}>{parsed.ok ? null : parsed.message}</FieldError>
      </TextField>

      <TextField
        value={reason}
        onChange={setReason}
        isRequired
        isDisabled={saving}
        validationBehavior="aria"
        className={dialogStyles.field}
      >
        <Label className={dialogStyles.label}>Reason</Label>
        <TextArea className={dialogStyles.textarea} rows={3} placeholder="Why this change (saved with the edit)" />
        <Text slot="description" className={dialogStyles.hint}>
          {reasonReady ? `${reasonCount} characters` : `At least ${MIN_REASON_LENGTH} characters (${reasonCount} so far)`}
        </Text>
      </TextField>

      <div className={styles.previewBar}>
        <Button
          variant="secondary"
          size="sm"
          isDisabled={!canPreview}
          onPress={() => {
            if (parsed.ok) void runPreview(field, parsed.value);
          }}
        >
          Preview impact
        </Button>
        {preview.kind === "loading" ? <StepLoader label="Evaluating V_RULE_FIRINGS…" /> : null}
      </div>

      <div aria-live="polite">
        {preview.kind === "done" ? (
          <section className={styles.preview} aria-label="Preview impact">
            <p className={styles.previewHead}>
              Preview, not saved · {FIELD_LABEL[preview.field]} {currentText ?? "—"}
              <Arrow />
              {formatValue(preview.value)}
            </p>
            {preview.impact ? <ImpactSummary impact={preview.impact} tense="preview" /> : null}
            {preview.message ? <p className={styles.procMessage}>{preview.message}</p> : null}
          </section>
        ) : null}
        {preview.kind === "error" ? (
          <p className={styles.inlineError} role="alert">
            {preview.text}
            {preview.code ? <span className={styles.errorCode}>{preview.code}</span> : null}
            {previewFailedOnSnowflake ? "\nSave edit still reports the patients whose firing changed." : null}
          </p>
        ) : null}
      </div>

      {saveError ? (
        <p className={dialogStyles.error} role="alert">
          {saveError.text}
          {saveError.code ? <span className={styles.errorCode}>{saveError.code}</span> : null}
        </p>
      ) : null}

      <div className={dialogStyles.actions}>
        {saving ? <StepLoader className={styles.saving} /> : null}
        <Button variant="tertiary" onPress={close} isDisabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isDisabled={!canSave} isPending={saving}>
          Save edit
        </Button>
      </div>
    </form>
  );
}
