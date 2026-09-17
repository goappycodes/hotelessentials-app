import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md animate-fade-up rounded-3xl border border-slate-200/70 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8">
        <div className="mb-8">
          <Logo />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome back</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to continue to your dashboard.</p>

        <LoginForm />
      </div>
    </main>
  );
}
