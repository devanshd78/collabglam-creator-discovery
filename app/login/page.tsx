import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import DatabaseUnavailable from "../components/DatabaseUnavailable";
import AuthForm from "./AuthForm";

export default async function LoginPage() {
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  let userCount: number;
  try {
    user = await getCurrentUser();
    userCount = await prisma.user.count();
  } catch (error) {
    console.error("Database unavailable on login", error);
    return <DatabaseUnavailable />;
  }

  if (user) redirect("/");
  if (userCount === 0) redirect("/setup");
  return <AuthForm mode="login" />;
}
