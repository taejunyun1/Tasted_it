import { useEffect, useRef } from "react";
import { Form, useFormAction, useNavigation } from "react-router";

type SubmissionState = { state: string; formMethod?: string; formAction?: string };

export function isAuthFormPending(navigation: SubmissionState, action: string) {
  if (navigation.state === "idle" || navigation.formMethod?.toLowerCase() !== "post" || !navigation.formAction) return false;
  const base = "https://retaste.invalid";
  return new URL(navigation.formAction, base).pathname === new URL(action, base).pathname;
}

export function AuthForm({ id, action, className, error, submitLabel, pendingLabel, submitClassName, children }: {
  id: string;
  action?: string;
  className?: string;
  error?: string;
  submitLabel: string;
  pendingLabel: string;
  submitClassName?: string;
  children: React.ReactNode;
}) {
  const pending = isAuthFormPending(useNavigation(), useFormAction(action));
  const form = useRef<HTMLFormElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!pending && error) {
      const invalid = form.current?.querySelector<HTMLElement>('[aria-invalid="true"], input:invalid, select:invalid, textarea:invalid');
      (invalid ?? summary.current)?.focus();
    }
  }, [error, pending]);

  return <Form ref={form} method="post" action={action} className={className} aria-busy={pending}
    onSubmit={(event) => { if (pending) event.preventDefault(); }}>
    {!pending && error && <p ref={summary} id={`${id}-error`} role="alert" tabIndex={-1} className="border border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
    {children}
    <button type="submit" disabled={pending} className={submitClassName ?? "rounded-full bg-neutral-950 px-5 py-3 font-semibold text-white disabled:cursor-wait disabled:opacity-60"}>{pending ? pendingLabel : submitLabel}</button>
    <p role="status" className="sr-only">{pending ? pendingLabel : ""}</p>
  </Form>;
}
