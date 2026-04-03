import LoginForm from "@/components/auth/login-form";

export const metadata = {
  title: "Login — DataLens",
};

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <LoginForm className="w-full max-w-md" />
    </main>
  );
}
