import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Clock, Package, ShieldCheck, ShoppingCart } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { user, profile, role, profileError } = await requireUser();
  const firstName = (profile?.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "there").split(" ")[0];
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  const supabase = await createClient();
  const count = (table: string, filter?: [string, string]) => {
    let query = supabase.from(table).select("*", { count: "exact", head: true });
    if (filter) query = query.eq(...filter);
    return query.then(({ count }) => count ?? 0);
  };

  const [orders, pending, fulfilled, batches] = await Promise.all([
    count("sales_order_list"),
    count("sales_order_list", ["dispatch_status", "pending"]),
    count("sales_order_list", ["dispatch_status", "fulfilled"]),
    count("sales_order_batches"),
  ]);

  const stats = [
    { label: "Sales orders", value: orders, icon: ShoppingCart, tone: "from-brand-500 to-indigo-600", href: "/dashboard/sales-orders" },
    { label: "Pending dispatch", value: pending, icon: Clock, tone: "from-amber-500 to-orange-600", href: "/dashboard/sales-orders?dispatch=pending" },
    { label: "Fulfilled", value: fulfilled, icon: CheckCircle2, tone: "from-emerald-500 to-teal-600", href: "/dashboard/sales-orders?dispatch=fulfilled" },
    { label: "Dispatch batches", value: batches, icon: Package, tone: "from-fuchsia-500 to-pink-600", href: "/dashboard/sales-orders" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {profileError && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            Could not load your profile: <span className="font-mono">{profileError}</span>. Have you run the database
            migrations (<code className="font-mono">npm run db:push</code>)?
          </p>
        </div>
      )}

      {/* Welcome */}
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-brand-600/50 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-40 size-64 rounded-full bg-fuchsia-500/30 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <CalendarDays className="size-4" /> {today}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Good to see you, {firstName} 👋</h1>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
            <ShieldCheck className="size-5 text-brand-200" />
            <div className="text-sm leading-tight">
              <p className="font-medium capitalize">{role} access</p>
              <p className="text-xs text-slate-400">{profile?.email ?? user.email}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, tone, href }, i) => (
          <Link
            key={label}
            href={href}
            style={{ animationDelay: `${i * 60}ms` }}
            className="group animate-fade-up rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className={`grid size-10 place-items-center rounded-xl bg-gradient-to-br ${tone} text-white shadow-sm`}>
                <Icon className="size-5" />
              </span>
              <ArrowRight className="size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
            </div>
            <p className="mt-4 text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
              {new Intl.NumberFormat("en-IN").format(value)}
            </p>
          </Link>
        ))}
      </section>
    </div>
  );
}
