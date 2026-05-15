import Link from "next/link";

import { Button } from "@/components/ui/button";
import { WaitlistForm } from "@/components/waitlist-form";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="container flex h-16 items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">CareLedger</span>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Sign up</Link>
          </Button>
        </nav>
      </header>

      <section className="container flex flex-1 flex-col items-start justify-center gap-8 py-16">
        <div className="max-w-2xl space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            The admin command center for caring for an aging parent.
          </h1>
          <p className="text-lg text-muted-foreground">
            CareLedger is built for adult children handling the non-medical work
            of eldercare. Track facility bills, split expenses across siblings,
            store important documents, and log visits — all in one place. No
            medical data, just the paperwork.
          </p>
        </div>

        <div className="w-full space-y-2">
          <p className="text-sm font-medium">
            Join the waitlist to get early access.
          </p>
          <WaitlistForm />
        </div>
      </section>

      <footer className="container py-8 text-sm text-muted-foreground">
        © {new Date().getFullYear()} CareLedger
      </footer>
    </main>
  );
}
