import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: "admin" | "user";
  created_at: string;
};

/** Returns the signed-in user and their profile, or redirects to /login. */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, role, created_at")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  // Until the profiles migration runs, fall back to the role stored in app_metadata.
  const role: Profile["role"] = profile?.role ?? (user.app_metadata?.role === "admin" ? "admin" : "user");

  return {
    user,
    profile,
    role,
    // Surfaced in the UI so a missing migration is obvious during setup.
    profileError: error?.message ?? null,
  };
});
