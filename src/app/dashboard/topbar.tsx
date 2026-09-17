import { LogOut, Search } from "lucide-react";
import { logout } from "@/app/actions";

type Props = { name: string; email: string; role: "admin" | "user" };

export function Topbar({ name, email, role }: Props) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-slate-200/70 bg-white/80 pl-16 pr-4 backdrop-blur-xl sm:pr-8 lg:pl-8">
      <div className="relative hidden max-w-sm flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Search…"
          className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/15"
        />
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-fuchsia-500 text-xs font-semibold text-white">
            {initials}
          </span>
          <div className="hidden leading-tight sm:block">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
              {name}
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                  role === "admin" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {role}
              </span>
            </p>
            <p className="text-xs text-slate-500">{email}</p>
          </div>
        </div>

        <form action={logout}>
          <button
            type="submit"
            className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="size-4" />
            <span className="hidden md:inline">Logout</span>
          </button>
        </form>
      </div>
    </header>
  );
}
