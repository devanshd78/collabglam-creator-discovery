import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  requireApiUser,
} from "@/lib/auth";

import {
  hashPassword,
} from "@/lib/passwords";

import {
  resolveYoutubeApiKey,
} from "@/lib/youtube/keys";

/**
 * Admin creates a team member and assigns
 * exactly one YouTube API key.
 */
export async function POST(
  req: NextRequest
) {
  const {
    error,
  } =
    await requireApiUser({
      admin: true,
    });

  if (error) {
    return error;
  }

  const body =
    (await req
      .json()
      .catch(
        () => ({})
      )) as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
      youtubeApiKeyId?: string;
    };

  const name =
    body.name?.trim() ??
    "";

  const email =
    body.email
      ?.trim()
      .toLowerCase() ??
    "";

  const password =
    body.password ?? "";

  const youtubeApiKeyId =
    body.youtubeApiKeyId?.trim() ??
    "";

  if (
    !name ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(
      email
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Enter a name and a valid email.",
      },
      {
        status: 400,
      }
    );
  }

  if (
    password.length <
    8
  ) {
    return NextResponse.json(
      {
        error:
          "Password must be at least 8 characters.",
      },
      {
        status: 400,
      }
    );
  }

  /*
   * Key must exist on this server.
   */
  if (
    !youtubeApiKeyId ||
    !resolveYoutubeApiKey(
      youtubeApiKeyId
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Select an available YouTube API key.",
      },
      {
        status: 400,
      }
    );
  }

  /*
   * Check allocation before creating user.
   */
  const keyOwner =
    await prisma.user.findFirst({
      where: {
        youtubeApiKeyId,
      },

      select: {
        id: true,
        name: true,
      },
    });

  if (keyOwner) {
    return NextResponse.json(
      {
        error:
          `That YouTube API key is already allocated to ${keyOwner.name}.`,
      },
      {
        status: 409,
      }
    );
  }

  const existingUser =
    await prisma.user.findUnique({
      where: {
        email,
      },

      select: {
        id: true,
      },
    });

  if (existingUser) {
    return NextResponse.json(
      {
        error:
          "Someone with that email already has an account.",
      },
      {
        status: 409,
      }
    );
  }

  try {
    const user =
      await prisma.user.create({
        data: {
          name,

          email,

          passwordHash:
            await hashPassword(
              password
            ),

          role:
            body.role ===
            "ADMIN"
              ? "ADMIN"
              : "MEMBER",

          youtubeApiKeyId,
        },

        select: {
          id: true,
          name: true,
          email: true,
          youtubeApiKeyId: true,
        },
      });

    return NextResponse.json(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        youtubeApiKeyId:
          user.youtubeApiKeyId,
      },
      {
        status: 201,
      }
    );
  } catch (err) {
    if (
      (
        err as {
          code?: string;
        }
      ).code ===
      "P2002"
    ) {
      return NextResponse.json(
        {
          error:
            "That email or YouTube API key is already allocated.",
        },
        {
          status: 409,
        }
      );
    }

    throw err;
  }
}