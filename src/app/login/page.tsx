import LoginForm from "@/components/auth/login-form";

export const metadata = {
  title: "Login — DataLens",
};

function normalizeRedirectTarget(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/";
  }

  if (candidate === "/login" || candidate === "/register") {
    return "/";
  }

  return candidate;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[] | undefined }>;
}) {
  const { redirect } = await searchParams;
  const redirectTo = normalizeRedirectTarget(redirect);

  return (
    <main className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-950 p-4">
      <LoginForm className="w-full max-w-md" redirectTo={redirectTo} />
    </main>
  );
}
