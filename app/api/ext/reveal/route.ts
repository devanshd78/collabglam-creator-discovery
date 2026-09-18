import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { cleanEmail, editableCreatorWhere, EMAIL_PATTERN, REVEAL_OUTCOMES, revealsToday, setCreatorEmail, type RevealOutcome } from "@/lib/reveals";

/**
 * The extension reports what happened on a creator's About panel:
 *  - "revealed" with the email the member uncovered → saved to the creator (and so to the CSV);
 *  - "none" → the channel shows no business email, so it leaves the queue;
 *  - "limit" → YouTube refused because this Google account hit its daily cap.
 */
export async function POST(req: NextRequest) {
  const { user, error } = await requireApiUser({ allowExtension: true });
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { creatorId?: unknown; outcome?: unknown; email?: unknown; accountIndex?: unknown };

  const outcome = String(body.outcome) as RevealOutcome;
  if (!REVEAL_OUTCOMES.includes(outcome)) return NextResponse.json({ error: "Unknown outcome" }, { status: 400 });
  const accountIndex = Number(body.accountIndex);
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > 20) {
    return NextResponse.json({ error: "Invalid account" }, { status: 400 });
  }
  const creator = await prisma.creator.findFirst({
    where: { id: typeof body.creatorId === "string" ? body.creatorId : "", ...editableCreatorWhere(user) },
    select: { id: true, channelId: true, channelUrl: true, email: true },
  });
  if (!creator) return NextResponse.json({ error: "Creator not found in your lists" }, { status: 404 });

  const email = cleanEmail(body.email);
  if (outcome === "revealed") {
    if (!EMAIL_PATTERN.test(email)) return NextResponse.json({ error: "That doesn't look like an email address" }, { status: 400 });
    await setCreatorEmail(creator, email, "YouTube About page (revealed)");
  } else if (outcome === "none") {
    await prisma.creator.update({ where: { id: creator.id }, data: { noPublicEmail: true } });
  }
  await prisma.emailReveal.create({
    data: {
      userId: user.id,
      creatorId: creator.id,
      channelId: creator.channelId,
      accountIndex,
      outcome,
      email: outcome === "revealed" ? email : null,
    },
  });
  return NextResponse.json({ ok: true, today: await revealsToday(user.id) });
}
