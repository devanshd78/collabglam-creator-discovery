import { redirect } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import DatabaseUnavailable from "../components/DatabaseUnavailable";
import AuthForm from "../login/AuthForm";

/** Only reachable while there are no accounts — creates the first admin. */
export default async function SetupPage() {
  // Whether an admin exists must be read per request, never baked in at build time.
  await connection();
  let userCount: number;
  try {
    userCount = await prisma.user.count();
  } catch (error) {
    console.error("Database unavailable during setup", error);
    return <DatabaseUnavailable />;
  }

  if (userCount > 0) redirect("/login");
  return <AuthForm mode="setup" />;
}
