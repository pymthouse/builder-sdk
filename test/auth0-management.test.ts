import { describe, expect, it, vi } from "vitest";
import {
  ensureAuth0User,
  findAuth0UserByEmail,
} from "../src/auth0/management.js";
import type { ManagementClient } from "auth0";

function mockManagement(overrides: {
  usersByEmail?: ManagementClient["usersByEmail"];
  users?: ManagementClient["users"];
}): ManagementClient {
  return {
    usersByEmail: overrides.usersByEmail ?? {
      getByEmail: vi.fn().mockResolvedValue({ data: [] }),
    },
    users: overrides.users ?? {
      create: vi.fn(),
    },
  } as unknown as ManagementClient;
}

describe("findAuth0UserByEmail", () => {
  it("returns null when no user matches", async () => {
    const management = mockManagement({});
    await expect(findAuth0UserByEmail(management, "a@b.com")).resolves.toBeNull();
  });

  it("returns existing user sub", async () => {
    const management = mockManagement({
      usersByEmail: {
        getByEmail: vi.fn().mockResolvedValue({
          data: [{ user_id: "auth0|1", email: "a@b.com" }],
        }),
      } as ManagementClient["usersByEmail"],
    });

    await expect(findAuth0UserByEmail(management, "a@b.com")).resolves.toEqual({
      userId: "auth0|1",
      sub: "auth0|1",
      email: "a@b.com",
    });
  });
});

describe("ensureAuth0User", () => {
  it("returns existing user without creating", async () => {
    const management = mockManagement({
      usersByEmail: {
        getByEmail: vi.fn().mockResolvedValue({
          data: [{ user_id: "auth0|existing", email: "user@example.com" }],
        }),
      } as ManagementClient["usersByEmail"],
      users: {
        create: vi.fn(),
      } as ManagementClient["users"],
    });

    const result = await ensureAuth0User(management, {
      email: "user@example.com",
      password: "secret",
    });

    expect(result.created).toBe(false);
    expect(result.user.sub).toBe("auth0|existing");
    expect(management.users.create).not.toHaveBeenCalled();
  });

  it("creates user when missing", async () => {
    const create = vi.fn().mockResolvedValue({
      data: { user_id: "auth0|new", email: "new@example.com" },
    });
    const management = mockManagement({
      usersByEmail: {
        getByEmail: vi.fn().mockResolvedValue({ data: [] }),
      } as ManagementClient["usersByEmail"],
      users: { create } as ManagementClient["users"],
    });

    const result = await ensureAuth0User(management, {
      email: "new@example.com",
      password: "secret123",
    });

    expect(result.created).toBe(true);
    expect(result.user.sub).toBe("auth0|new");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@example.com",
        connection: "Username-Password-Authentication",
        password: "secret123",
      }),
    );
  });
});
