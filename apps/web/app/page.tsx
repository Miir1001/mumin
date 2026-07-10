"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  Briefcase,
  Building2,
  FileText,
  GraduationCap,
  Landmark,
  LineChart,
  Search,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const roles = [
  { icon: UserRound, label: "Job Seekers", description: "Build a career, not just a resume." },
  { icon: Building2, label: "Employers", description: "Hire the right people, faster." },
  { icon: Search, label: "Recruiters", description: "Find and rank top talent with AI." },
  { icon: Users, label: "HR Managers", description: "Manage teams and pipelines in one place." },
  { icon: GraduationCap, label: "Universities", description: "Connect graduates to real careers." },
  { icon: Landmark, label: "Government", description: "Coordinate workforce programs at scale." },
];

const aiFeatures = [
  {
    icon: FileText,
    title: "AI Resume Builder",
    description: "Generate ATS-optimized resumes tailored to every role you apply for.",
  },
  {
    icon: Sparkles,
    title: "Smart Matching",
    description: "Semantic job and candidate matching that goes far beyond keyword search.",
  },
  {
    icon: Bot,
    title: "Interview Coach",
    description: "Practice with an AI interviewer and get real-time, actionable feedback.",
  },
  {
    icon: LineChart,
    title: "Hiring Analytics",
    description: "Pipeline, time-to-hire, and diversity insights for every open role.",
  },
];

function fadeUp(delay = 0) {
  return {
    initial: { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-80px" },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  };
}

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] bg-[radial-gradient(60%_50%_at_50%_0%,hsl(var(--primary)/0.16),transparent)]" />

      <header className="sticky top-0 z-50">
        <div className="glass mx-auto mt-4 flex max-w-6xl items-center justify-between rounded-2xl px-5 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">TalentHub AI</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#roles" className="transition-colors hover:text-foreground">
              Platform
            </a>
            <a href="#ai" className="transition-colors hover:text-foreground">
              AI Features
            </a>
            <a href="#pricing" className="transition-colors hover:text-foreground">
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
              Sign in
            </Button>
            <Button size="sm">
              Get started
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto flex max-w-4xl flex-col items-center px-6 pb-20 pt-24 text-center sm:pt-32">
          <motion.div
            {...fadeUp(0)}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            One ecosystem for the entire hiring lifecycle
          </motion.div>

          <motion.h1
            {...fadeUp(0.05)}
            className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl"
          >
            The AI employment platform for
            <span className="text-primary"> every side of hiring.</span>
          </motion.h1>

          <motion.p {...fadeUp(0.1)} className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
            TalentHub AI unifies job search, applicant tracking, recruiting, and workforce development —
            with AI matching, resume tools, and analytics built in from day one.
          </motion.p>

          <motion.div {...fadeUp(0.15)} className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button size="lg">
              Find your next hire
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline">
              Explore jobs
            </Button>
          </motion.div>
        </section>

        <section id="roles" className="mx-auto max-w-6xl px-6 py-20">
          <motion.div {...fadeUp(0)} className="mb-12 text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Built for every stakeholder</h2>
            <p className="mt-3 text-muted-foreground">
              A dedicated, permissioned dashboard for each role in the hiring ecosystem.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((role, i) => (
              <motion.div
                key={role.label}
                {...fadeUp(0.04 * i)}
                className="group rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-lg"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <role.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">{role.label}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{role.description}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section id="ai" className="border-y border-border bg-muted/40">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <motion.div {...fadeUp(0)} className="mb-12 text-center">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">AI at every step</h2>
              <p className="mt-3 text-muted-foreground">
                From resume to offer, TalentHub AI helps you move faster with better decisions.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {aiFeatures.map((feature, i) => (
                <motion.div
                  key={feature.title}
                  {...fadeUp(0.05 * i)}
                  className="rounded-2xl border border-border bg-card p-6"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold">{feature.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{feature.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-24 text-center">
          <motion.div {...fadeUp(0)}>
            <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Briefcase className="h-6 w-6" />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Ready to build your hiring pipeline?
            </h2>
            <p className="mt-3 text-muted-foreground">
              Create a free account and post your first job in minutes.
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Button size="lg">
                Get started for free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} TalentHub AI. All rights reserved.</span>
          <div className="flex gap-6">
            <a href="#" className="transition-colors hover:text-foreground">
              Privacy
            </a>
            <a href="#" className="transition-colors hover:text-foreground">
              Terms
            </a>
            <a href="#" className="transition-colors hover:text-foreground">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
