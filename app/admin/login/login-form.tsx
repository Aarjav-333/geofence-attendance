"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        // Always submit as a password field (so browsers don't store it as ordinary
        // form history) and keep it hidden for the next attempt if login fails.
        const field = e.currentTarget.elements.namedItem("password");
        if (field instanceof HTMLInputElement) field.type = "password";
        setShowPassword(false);
      }}
      className="space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-sm"
    >
      <div>
        <label htmlFor="username" className="mb-1.5 block text-sm font-medium">
          Username
        </label>
        <input id="username" name="username" className="input" autoComplete="username" required defaultValue={state.username} key={state.username} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            className="input pr-12"
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          {/* Visibility toggle only switches the input type; the value stays in the input. */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            aria-controls="password"
            title={showPassword ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-bad-bg px-3 py-2.5 text-sm text-bad">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c6.5 0 10 8 10 8a17.6 17.6 0 0 1-2.2 3.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
