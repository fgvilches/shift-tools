import { AlertTriangle, Check, Eraser, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SectionLabel } from "@/components/ui/Card";
import { CodeArea, CopyButton } from "@/components/ui/CodeArea";
import { SegmentedControl } from "@/components/ui/Form";
import { InfoNotice } from "@/components/ui/Feedback";
import type { BodyKind } from "@/lib/types";
import { BODY_HINT, BODY_KINDS, BODY_PLACEHOLDER, type JsonCheck } from "../lib/request";

export function BodyEditor({
  kind,
  body,
  issue,
  onKindChange,
  onBodyChange,
  onFormat,
  onClear,
}: {
  kind: BodyKind;
  body: string;
  issue: JsonCheck | null;
  onKindChange: (kind: BodyKind) => void;
  onBodyChange: (body: string) => void;
  onFormat: () => void;
  onClear: () => void;
}) {
  const bytes = body.length === 0 ? 0 : new TextEncoder().encode(body).length;
  const lines = body.length === 0 ? 0 : body.split("\n").length;
  const valid = issue?.ok === true;
  const invalid = issue?.ok === false;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel trailing={<span className="font-mono text-[10px] text-outline tnum">{kind}</span>}>
          Body buffer
        </SectionLabel>
        <SegmentedControl
          value={kind}
          onChange={onKindChange}
          options={BODY_KINDS}
          size="sm"
          ariaLabel="Request body kind"
        />
      </div>

      {kind === "none" ? (
        <div className="space-y-2">
          <InfoNotice tone="neutral">
            No body is sent. Switch the buffer to JSON, text, form, or URL-encoded to attach a payload.
          </InfoNotice>
          <div className="rounded-lg border border-dashed border-white/[0.07] px-3 py-8 text-center">
            <p className="text-[11px] text-outline">Content-Length: 0</p>
          </div>
        </div>
      ) : (
        <CodeArea
          value={body}
          onChange={onBodyChange}
          minHeight={214}
          ariaLabel={`Request ${kind} body`}
          placeholder={BODY_PLACEHOLDER[kind]}
          toolbar={
            <>
              <div className="flex items-center gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<Wand2 size={11} />}
                  onClick={onFormat}
                  disabled={kind !== "json" || body.trim().length === 0}
                >
                  Format
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<Eraser size={11} />}
                  onClick={onClear}
                  disabled={body.length === 0}
                >
                  Clear
                </Button>
                <CopyButton text={body} label="Copy" disabled={body.length === 0} />
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px] text-outline">
                {kind === "json" && body.trim().length > 0 && (
                  <span
                    className={valid ? "flex items-center gap-1 text-secondary" : "flex items-center gap-1 text-error"}
                    aria-live="polite"
                  >
                    {valid ? <Check size={10} /> : <AlertTriangle size={10} />}
                    {valid ? "Valid JSON" : "Invalid JSON"}
                  </span>
                )}
                <span className="tnum">
                  {lines} lines · {bytes} B
                </span>
              </div>
            </>
          }
        />
      )}

      {invalid && issue && (
        <p className="text-[10.5px] leading-tight text-error" role="alert">
          {issue.line ? `Line ${issue.line}: ` : ""}
          {issue.message}
        </p>
      )}

      {kind !== "none" && (
        <p className="text-[10.5px] leading-tight text-outline">{BODY_HINT[kind]}</p>
      )}
    </div>
  );
}
