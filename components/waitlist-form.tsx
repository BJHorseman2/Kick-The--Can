"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinWaitlist } from "@/app/actions/waitlist";

export function WaitlistForm() {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "ok" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await joinWaitlist(formData);
      if (result.ok) setStatus({ kind: "ok" });
      else setStatus({ kind: "error", message: result.error });
    });
  }

  if (status.kind === "ok") {
    return (
      <p className="rounded-md bg-secondary p-4 text-sm">
        Thanks — you&apos;re on the list. We&apos;ll be in touch.
      </p>
    );
  }

  return (
    <form
      action={onSubmit}
      className="flex w-full max-w-md flex-col gap-3 sm:flex-row"
    >
      <Input
        type="email"
        name="email"
        required
        placeholder="you@example.com"
        autoComplete="email"
        aria-label="Email address"
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Join waitlist"}
      </Button>
      {status.kind === "error" ? (
        <p className="text-sm text-destructive sm:basis-full">
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
