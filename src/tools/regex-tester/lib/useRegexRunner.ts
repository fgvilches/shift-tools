import { useEffect, useRef, useState } from "react";
import { DEBOUNCE_MS } from "./engine";
import type { EvalResult, ReplaceResult } from "./engine";
import { runner } from "./runner";
import type { EngineMode } from "./runner";

export interface RegexRunnerInput {
  pattern: string;
  flags: string;
  text: string;
  template: string;
  withReplace: boolean;
}

export interface RegexRunnerOutput {
  evaluation: EvalResult | null;
  replacement: ReplaceResult | null;
  pending: boolean;
  mode: EngineMode;
}

/**
 * Debounced bridge between the editor state and the RegExp worker. Responses
 * for superseded inputs are discarded, so result panels always match the
 * pattern/text currently on screen.
 */
export function useRegexRunner({
  pattern,
  flags,
  text,
  template,
  withReplace,
}: RegexRunnerInput): RegexRunnerOutput {
  const [evaluation, setEvaluation] = useState<EvalResult | null>(null);
  const [replacement, setReplacement] = useState<ReplaceResult | null>(null);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<EngineMode>(() => runner.mode());
  const token = useRef({ evaluate: 0, replace: 0 });

  useEffect(() => {
    const evalToken = (token.current.evaluate += 1);
    const replaceToken = (token.current.replace += 1);

    if (pattern.length === 0) {
      setEvaluation(null);
      setReplacement(null);
      setPending(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setPending(true);
      let outstanding = withReplace ? 2 : 1;
      const settle = () => {
        outstanding -= 1;
        if (outstanding === 0) setPending(false);
      };

      void runner.evaluate(pattern, flags, text).then((result) => {
        if (token.current.evaluate !== evalToken) return;
        setEvaluation(result);
        settle();
      });

      if (withReplace) {
        void runner.replace(pattern, flags, text, template).then((result) => {
          if (token.current.replace !== replaceToken) return;
          setReplacement(result);
          settle();
        });
      } else {
        setReplacement(null);
      }

      setMode(runner.mode());
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [pattern, flags, text, template, withReplace]);

  return { evaluation, replacement, pending, mode };
}
