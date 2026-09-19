"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  KeyRound,
  Loader2,
  UserPlus,
} from "lucide-react";

import {
  dateTime,
} from "@/lib/format";

interface Member {
  id: string;
  name: string;
  email: string;

  role:
    | "ADMIN"
    | "MEMBER";

  active: boolean;

  lastLoginAt:
    | string
    | null;

  saved: number;

  youtubeApiKeyId:
    | string
    | null;
}

interface ApiKeyOption {
  id: string;
  index: number;

  /*
   * Only "Key 1", "Key 2", etc.
   */
  label: string;

  allocatedToId:
    | string
    | null;

  allocatedToName:
    | string
    | null;
}

interface FormState {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "MEMBER";
  youtubeApiKeyId: string;
}

export default function UsersClient({
  users,
  meId,
  apiKeys,
}: {
  users: Member[];
  meId: string;
  apiKeys: ApiKeyOption[];
}) {
  const router =
    useRouter();

  const [form, setForm] =
    useState<FormState>({
      name: "",
      email: "",
      password: "",
      role: "MEMBER",
      youtubeApiKeyId: "",
    });

  const [busy, setBusy] =
    useState(false);

  const [
    message,
    setMessage,
  ] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);

  const allocatedKeyCount =
    apiKeys.filter(
      (key) =>
        Boolean(
          key.allocatedToId
        )
    ).length;

  const availableKeyCount =
    apiKeys.length -
    allocatedKeyCount;

  async function call(
    url: string,
    method: string,
    body: unknown
  ): Promise<boolean> {
    const response =
      await fetch(
        url,
        {
          method,

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify(
              body
            ),
        }
      );

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (!response.ok) {
      setMessage({
        text:
          data.error ??
          "Something went wrong.",

        ok: false,
      });

      return false;
    }

    router.refresh();

    return true;
  }

  async function addMember(
    e: React.FormEvent
  ) {
    e.preventDefault();

    if (
      !form.youtubeApiKeyId
    ) {
      setMessage({
        text:
          "Select an available YouTube API key.",

        ok: false,
      });

      return;
    }

    setBusy(true);
    setMessage(null);

    const name =
      form.name.trim();

    const success =
      await call(
        "/api/admin/users",
        "POST",
        form
      );

    if (success) {
      setMessage({
        text:
          `${name} was added successfully. The selected YouTube API key is now allocated to this account.`,

        ok: true,
      });

      setForm({
        name: "",
        email: "",
        password: "",
        role: "MEMBER",
        youtubeApiKeyId: "",
      });
    }

    setBusy(false);
  }

  async function resetPassword(
    user: Member
  ) {
    const password =
      window.prompt(
        `New password for ${user.name} (minimum 8 characters)`
      );

    if (!password) {
      return;
    }

    const success =
      await call(
        `/api/admin/users/${user.id}`,
        "PATCH",
        {
          password,
        }
      );

    if (success) {
      setMessage({
        text:
          `Password updated for ${user.name}.`,

        ok: true,
      });
    }
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={
          addMember
        }
        className="card p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--ink)]">
            Add a team member
          </h2>

          <div className="text-[11px] text-[var(--muted-2)]">
            {apiKeys.length} keys configured
            {" · "}
            {availableKeyCount} available
            {" · "}
            {allocatedKeyCount} allocated
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
          <input
            className="input"
            placeholder="Name"
            value={
              form.name
            }
            onChange={(
              e
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  name:
                    e.target
                      .value,
                })
              )
            }
            required
          />

          <input
            className="input"
            type="email"
            placeholder="Email"
            value={
              form.email
            }
            onChange={(
              e
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  email:
                    e.target
                      .value,
                })
              )
            }
            required
          />

          <input
            className="input"
            type="text"
            placeholder="Temporary password (8+)"
            minLength={8}
            value={
              form.password
            }
            onChange={(
              e
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  password:
                    e.target
                      .value,
                })
              )
            }
            required
            autoComplete="new-password"
          />

          <select
            className="input"
            value={
              form.role
            }
            onChange={(
              e
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  role:
                    e.target
                      .value as
                      | "ADMIN"
                      | "MEMBER",
                })
              )
            }
          >
            <option value="MEMBER">
              Member
            </option>

            <option value="ADMIN">
              Admin
            </option>
          </select>

          <select
            className="input"
            value={
              form.youtubeApiKeyId
            }
            onChange={(
              e
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  youtubeApiKeyId:
                    e.target
                      .value,
                })
              )
            }
            required
          >
            <option value="">
              Select YouTube API key
            </option>

            {apiKeys.map(
              (key) => {
                const allocated =
                  Boolean(
                    key.allocatedToId
                  );

                return (
                  <option
                    key={
                      key.id
                    }
                    value={
                      key.id
                    }
                    disabled={
                      allocated
                    }
                  >
                    {
                      key.label
                    }

                    {" — "}

                    {key.allocatedToName
                      ? `Allocated to ${key.allocatedToName}`
                      : "Available"}
                  </option>
                );
              }
            )}
          </select>

          <button
            type="submit"
            disabled={
              busy ||
              availableKeyCount ===
                0
            }
            className="btn-primary inline-flex items-center justify-center gap-1.5 px-4 text-sm"
          >
            {busy ? (
              <Loader2
                size={
                  15
                }
                className="animate-spin"
              />
            ) : (
              <UserPlus
                size={
                  15
                }
              />
            )}

            Add member
          </button>
        </div>

        {apiKeys.length ===
          0 && (
          <p
            className="text-[12px]"
            style={{
              color:
                "var(--danger-fg)",
            }}
          >
            No YouTube API
            keys are
            configured on
            the server.
          </p>
        )}

        {apiKeys.length >
          0 &&
          availableKeyCount ===
            0 && (
            <p
              className="text-[12px]"
              style={{
                color:
                  "var(--danger-fg)",
              }}
            >
              All configured
              YouTube API
              keys are
              currently
              allocated.
            </p>
          )}

        {message && (
          <p
            className="text-[12px]"
            style={{
              color:
                message.ok
                  ? "var(--success-fg)"
                  : "var(--danger-fg)",
            }}
          >
            {
              message.text
            }
          </p>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-[13px] min-w-[980px]">
          <thead className="border-b border-[var(--border)]">
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-[var(--muted-2)]">
              <th className="px-3 py-2.5">
                Member
              </th>

              <th className="px-3 py-2.5">
                Role
              </th>

              <th className="px-3 py-2.5">
                YouTube API key
              </th>

              <th className="px-3 py-2.5 text-right">
                Creators saved
              </th>

              <th className="px-3 py-2.5">
                Last sign-in
              </th>

              <th className="px-3 py-2.5">
                Access
              </th>

              <th className="px-3 py-2.5" />
            </tr>
          </thead>

          <tbody>
            {users.map(
              (user) => {
                const isMe =
                  user.id ===
                  meId;

                return (
                  <tr
                    key={
                      user.id
                    }
                    className="border-b border-[var(--border)] last:border-0"
                    style={
                      user.active
                        ? undefined
                        : {
                            opacity:
                              0.6,
                          }
                    }
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-[var(--ink)]">
                        {
                          user.name
                        }

                        {isMe && (
                          <span className="ml-1.5 text-[10.5px] text-[var(--muted-2)]">
                            (you)
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-[var(--muted-2)]">
                        {
                          user.email
                        }
                      </div>
                    </td>

                    <td className="px-3 py-2.5">
                      <select
                        className="input w-auto py-1 text-xs"
                        style={{
                          minHeight:
                            30,
                        }}
                        value={
                          user.role
                        }
                        disabled={
                          isMe
                        }
                        onChange={(
                          e
                        ) =>
                          void call(
                            `/api/admin/users/${user.id}`,
                            "PATCH",
                            {
                              role:
                                e
                                  .target
                                  .value,
                            }
                          )
                        }
                      >
                        <option value="MEMBER">
                          Member
                        </option>

                        <option value="ADMIN">
                          Admin
                        </option>
                      </select>
                    </td>

                    <td className="px-3 py-2.5">
                      <select
                        className="input w-full min-w-[190px] py-1 text-xs"
                        style={{
                          minHeight:
                            30,
                        }}
                        value={
                          user.youtubeApiKeyId ??
                          ""
                        }
                        onChange={(
                          e
                        ) =>
                          void call(
                            `/api/admin/users/${user.id}`,
                            "PATCH",
                            {
                              youtubeApiKeyId:
                                e
                                  .target
                                  .value ||
                                null,
                            }
                          )
                        }
                      >
                        <option value="">
                          Unassigned
                        </option>

                        {apiKeys.map(
                          (
                            key
                          ) => {
                            const allocatedToThisUser =
                              key.allocatedToId ===
                              user.id;

                            const allocatedElsewhere =
                              Boolean(
                                key.allocatedToId
                              ) &&
                              !allocatedToThisUser;

                            return (
                              <option
                                key={
                                  key.id
                                }
                                value={
                                  key.id
                                }
                                disabled={
                                  allocatedElsewhere
                                }
                              >
                                {
                                  key.label
                                }

                                {" — "}

                                {allocatedToThisUser
                                  ? "Assigned"
                                  : key.allocatedToName
                                    ? `Allocated to ${key.allocatedToName}`
                                    : "Available"}
                              </option>
                            );
                          }
                        )}
                      </select>
                    </td>

                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {
                        user.saved
                      }
                    </td>

                    <td className="px-3 py-2.5 text-[var(--muted-2)] whitespace-nowrap">
                      {dateTime(
                        user.lastLoginAt
                      )}
                    </td>

                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        disabled={
                          isMe
                        }
                        onClick={() =>
                          void call(
                            `/api/admin/users/${user.id}`,
                            "PATCH",
                            {
                              active:
                                !user.active,
                            }
                          )
                        }
                        className={`${
                          user.active
                            ? "btn-danger"
                            : "btn-secondary"
                        } px-3 py-1 text-xs`}
                      >
                        {user.active
                          ? "Deactivate"
                          : "Reactivate"}
                      </button>
                    </td>

                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          void resetPassword(
                            user
                          )
                        }
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-teal-dark)]"
                      >
                        <KeyRound
                          size={
                            12
                          }
                        />

                        Reset
                        password
                      </button>
                    </td>
                  </tr>
                );
              }
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}