import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { Field, Input, SegmentedControl, Switch } from "@/components/ui/Form";
import { InfoNotice } from "@/components/ui/Feedback";
import { SectionLabel } from "@/components/ui/Card";
import type { AuthKind, HttpAuth } from "@/lib/types";
import { AUTH_KINDS } from "../lib/request";

export function AuthEditor({
  auth,
  reveal,
  onPatch,
  onRevealChange,
}: {
  auth: HttpAuth;
  reveal: boolean;
  onPatch: (patch: Partial<HttpAuth>) => void;
  onRevealChange: (reveal: boolean) => void;
}) {
  const secretType = reveal ? "text" : "password";

  const revealToggle = (
    <IconButton
      size="sm"
      label={reveal ? "Hide secret" : "Show secret"}
      icon={reveal ? <EyeOff size={12} /> : <Eye size={12} />}
      onClick={() => onRevealChange(!reveal)}
    />
  );

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel trailing={<span className="font-mono text-[10px] text-outline">{auth.kind}</span>}>
          Authorization
        </SectionLabel>
        <SegmentedControl
          value={auth.kind}
          onChange={(kind: AuthKind) => onPatch({ kind })}
          options={AUTH_KINDS}
          ariaLabel="Authorization kind"
        />
      </div>

      {auth.kind === "none" && (
        <div className="rounded-lg border border-dashed border-white/[0.07] px-3 py-4 text-center">
          <KeyRound size={15} className="mx-auto text-outline" aria-hidden />
          <p className="mt-1.5 text-[12px] text-on-surface">No authorization</p>
          <p className="text-[10.5px] text-outline">The request goes out without an Authorization header.</p>
        </div>
      )}

      {auth.kind === "basic" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Field label="Username">
            <Input
              mono
              sizeVariant="sm"
              value={auth.username ?? ""}
              autoComplete="off"
              spellCheck={false}
              aria-label="Basic auth username"
              onChange={(e) => onPatch({ username: e.target.value })}
            />
          </Field>
          <Field label="Password">
            <Input
              mono
              sizeVariant="sm"
              type={secretType}
              value={auth.password ?? ""}
              autoComplete="off"
              spellCheck={false}
              aria-label="Basic auth password"
              onChange={(e) => onPatch({ password: e.target.value })}
              trailingSlot={revealToggle}
            />
          </Field>
        </div>
      )}

      {auth.kind === "bearer" && (
        <Field label="Bearer token">
          <Input
            mono
            sizeVariant="sm"
            type={secretType}
            value={auth.token ?? ""}
            autoComplete="off"
            spellCheck={false}
            placeholder="eyJhbGciOi…"
            aria-label="Bearer token"
            onChange={(e) => onPatch({ token: e.target.value })}
            trailingSlot={revealToggle}
          />
        </Field>
      )}

      {auth.kind === "apiKey" && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Field label="Key name" hint="Defaults to X-API-Key when left empty.">
              <Input
                mono
                sizeVariant="sm"
                value={auth.headerName ?? ""}
                spellCheck={false}
                placeholder="X-API-Key"
                aria-label="API key header name"
                onChange={(e) => onPatch({ headerName: e.target.value })}
              />
            </Field>
            <Field label="Key value">
              <Input
                mono
                sizeVariant="sm"
                type={secretType}
                value={auth.token ?? ""}
                autoComplete="off"
                spellCheck={false}
                aria-label="API key value"
                onChange={(e) => onPatch({ token: e.target.value })}
                trailingSlot={revealToggle}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-black/25 border border-white/[0.055] px-2.5 py-1.5">
            <div className="min-w-0">
              <p className="text-[11.5px] text-on-surface">Append as query parameter</p>
              <p className="text-[10px] text-outline">
                {auth.inQuery
                  ? "The key is appended to the URL — no header is set."
                  : "The key is sent as a request header."}
              </p>
            </div>
            <Switch
              checked={auth.inQuery}
              onChange={(inQuery) => onPatch({ inQuery })}
              label="Send API key as query parameter"
              size="sm"
            />
          </div>
        </div>
      )}

      <InfoNotice icon={<ShieldCheck size={12} />} tone="primary">
        Credentials are handed to the local Rust core with this request only. They are never written to history or to
        the restored draft — save the method, not the secret.
      </InfoNotice>
    </div>
  );
}
