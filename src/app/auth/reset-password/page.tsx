import { Suspense } from "react";
import { ResetPasswordScreen } from "@/features/auth";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordScreen />
    </Suspense>
  );
}
