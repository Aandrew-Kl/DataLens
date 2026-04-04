import RegisterForm from "@/components/auth/register-form";

export const metadata = {
  title: "Register — DataLens",
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

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[] | undefined }>;
}) {
  const { redirect } = await searchParams;
  const redirectTo = normalizeRedirectTarget(redirect);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <RegisterForm className="w-full max-w-md" redirectTo={redirectTo} />
    </div>
  );
}
