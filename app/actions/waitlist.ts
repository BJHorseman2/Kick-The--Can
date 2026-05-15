"use server";

import { createClient } from "@/lib/supabase/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WaitlistResult =
  | { ok: true }
  | { ok: false; error: string };

export async function joinWaitlist(formData: FormData): Promise<WaitlistResult> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const supabase = createClient();
  const { error } = await supabase.from("waitlist").insert({ email });

  if (error) {
    // Unique violation = already on the list. Treat as success.
    if (error.code === "23505") return { ok: true };
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  return { ok: true };
}
