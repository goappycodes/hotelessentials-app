import { BedDouble } from "lucide-react";

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg shadow-brand-600/30">
        <BedDouble className="size-5" />
      </span>
      <span
        className={`text-[15px] font-semibold tracking-tight ${inverted ? "text-white" : "text-slate-900"}`}
      >
        Hotel Essentials
      </span>
    </div>
  );
}
