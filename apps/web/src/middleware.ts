import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Link landing pages are public because their session arrives in the URL hash, which the server never sees. */
const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/reset-password", "/invitations/accept", "/auth"];
/** Signed-in users are sent to the dashboard from these. */
const GUEST_ONLY_PATHS = ["/login", "/register", "/forgot-password"];

const matches = (pathname: string, paths: string[]) =>
  paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return new NextResponse("Supabase is not configured for the web app.", { status: 500 });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() revalidates the token with Supabase and refreshes the session cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname, search } = request.nextUrl;

  const redirectTo = (path: string) => {
    const target = request.nextUrl.clone();
    target.pathname = path;
    target.search = "";
    if (path === "/login") target.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!user && !matches(pathname, PUBLIC_PATHS)) return redirectTo("/login");
  if (user && matches(pathname, GUEST_ONLY_PATHS)) return redirectTo("/dashboard");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
