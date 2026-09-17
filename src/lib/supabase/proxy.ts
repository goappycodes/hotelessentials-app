import { createServerClient } from "@supabase/ssr";
import { supabaseKey, supabaseUrl } from "./env";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = ["/login"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser(): it refreshes the auth token.
  // getUser() validates the session with the Auth server (not just the JWT signature), so a
  // revoked session — e.g. after a password change — is cleared here instead of passing the
  // proxy and then failing requireUser(), which would cause a /login ⇄ /dashboard redirect loop.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthenticated = Boolean(user);

  const { pathname } = request.nextUrl;

  // API routes enforce their own auth and return 401 instead of redirecting.
  if (pathname.startsWith("/api/")) return response;

  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!isAuthenticated && !isPublic) return redirectTo("/login");
  if (isAuthenticated && (isPublic || pathname === "/")) return redirectTo("/dashboard");

  return response;
}
