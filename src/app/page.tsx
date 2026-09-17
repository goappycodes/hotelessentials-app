import { redirect } from "next/navigation";

// The proxy routes "/" by auth state; this is a fallback.
export default function Home() {
  redirect("/login");
}
