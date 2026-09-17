import { requireUser } from "@/lib/auth";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { user, profile, role } = await requireUser();

  const name = profile?.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "User";
  const email = profile?.email ?? user.email ?? "";

  return (
    <div className="min-h-screen lg:pl-64">
      <Sidebar />
      <div className="flex min-h-screen flex-col">
        <Topbar name={name} email={email} role={role} />
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
