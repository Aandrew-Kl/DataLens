import RegisterForm from "@/components/auth/register-form";

export const metadata = {
  title: "Register — DataLens",
};

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <RegisterForm className="w-full max-w-md" />
    </div>
  );
}
