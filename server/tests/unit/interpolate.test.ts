import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUserInfo = vi.hoisted(() => vi.fn().mockReturnValue({ username: "test-user" }));

vi.mock("node:os", () => ({
  default: { userInfo: mockUserInfo },
  userInfo: mockUserInfo,
}));

vi.mock("../../src/scope.js", () => ({
  isScopingEnabled: vi.fn().mockReturnValue(false),
  getActiveScope: vi.fn().mockReturnValue("unscoped"),
}));

const { isScopingEnabled, getActiveScope } = await import("../../src/scope.js");
const { resolveInterpolations, setClientName } = await import("../../src/interpolate.js");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isScopingEnabled).mockReturnValue(false);
  vi.mocked(getActiveScope).mockReturnValue("unscoped");
  mockUserInfo.mockReturnValue({ username: "test-user" });
  setClientName("unknown");
});

describe("resolveInterpolations — passthrough", () => {
  it("returns text unchanged when no placeholders are present", () => {
    expect(resolveInterpolations("Hello, world!")).toBe("Hello, world!");
  });

  it("returns empty string unchanged", () => {
    expect(resolveInterpolations("")).toBe("");
  });

  it("leaves unknown placeholders as-is so typos stay visible", () => {
    expect(resolveInterpolations("Hello {{foo}}!")).toBe("Hello {{foo}}!");
  });

  it("resolves known vars and leaves unknown vars unchanged in the same string", () => {
    setClientName("claude");
    const result = resolveInterpolations("client={{client}} and {{unknown}}");
    expect(result).toBe("client=claude and {{unknown}}");
  });
});

describe("resolveInterpolations — {{date}}", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves to YYYY-MM-DD (UTC)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    expect(resolveInterpolations("{{date}}")).toBe("2026-01-01");
  });

  it("replaces all occurrences in a string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    expect(resolveInterpolations("{{date}} and {{date}}")).toBe("2026-01-01 and 2026-01-01");
  });

  it("resolves to YYYY-MM-DD format without fake timers", () => {
    expect(resolveInterpolations("{{date}}")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("resolveInterpolations — {{time}}", () => {
  it("resolves to HH:MM format", () => {
    expect(resolveInterpolations("{{time}}")).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("resolveInterpolations — {{day}}", () => {
  it("resolves to an English day-of-week name", () => {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    expect(days).toContain(resolveInterpolations("{{day}}"));
  });
});

describe("resolveInterpolations — {{user}}", () => {
  it("resolves to the OS username", () => {
    expect(resolveInterpolations("{{user}}")).toBe("test-user");
  });

  it("falls back to process.env.USER when os.userInfo() throws", () => {
    mockUserInfo.mockImplementation(() => {
      throw new Error("restricted");
    });
    const original = process.env.USER;
    process.env.USER = "env-user";
    try {
      expect(resolveInterpolations("{{user}}")).toBe("env-user");
    } finally {
      if (original === undefined) {
        delete process.env.USER;
      } else {
        process.env.USER = original;
      }
    }
  });

  it("falls back to process.env.USERNAME when USER is unset", () => {
    mockUserInfo.mockImplementation(() => {
      throw new Error("restricted");
    });
    const origUser = process.env.USER;
    const origUsername = process.env.USERNAME;
    delete process.env.USER;
    process.env.USERNAME = "windows-user";
    try {
      expect(resolveInterpolations("{{user}}")).toBe("windows-user");
    } finally {
      if (origUser !== undefined) process.env.USER = origUser;
      else delete process.env.USER;
      if (origUsername !== undefined) process.env.USERNAME = origUsername;
      else delete process.env.USERNAME;
    }
  });

  it("falls back to 'unknown' when os.userInfo() throws and both env vars are unset", () => {
    mockUserInfo.mockImplementation(() => {
      throw new Error("restricted");
    });
    const origUser = process.env.USER;
    const origUsername = process.env.USERNAME;
    delete process.env.USER;
    delete process.env.USERNAME;
    try {
      expect(resolveInterpolations("{{user}}")).toBe("unknown");
    } finally {
      if (origUser !== undefined) process.env.USER = origUser;
      if (origUsername !== undefined) process.env.USERNAME = origUsername;
    }
  });
});

describe("resolveInterpolations — {{scope}}", () => {
  it("resolves to empty string when scoping is disabled", () => {
    vi.mocked(isScopingEnabled).mockReturnValue(false);
    expect(resolveInterpolations("scope:{{scope}}")).toBe("scope:");
  });

  it("resolves to the active scope name when scoping is enabled", () => {
    vi.mocked(isScopingEnabled).mockReturnValue(true);
    vi.mocked(getActiveScope).mockReturnValue("ai");
    expect(resolveInterpolations("scope:{{scope}}")).toBe("scope:ai");
  });

  it("uses 'unscoped' when scoping is enabled but no specific scope is active", () => {
    vi.mocked(isScopingEnabled).mockReturnValue(true);
    vi.mocked(getActiveScope).mockReturnValue("unscoped");
    expect(resolveInterpolations("{{scope}}")).toBe("unscoped");
  });
});

describe("resolveInterpolations — {{client}}", () => {
  it("resolves to 'unknown' before setClientName is called", () => {
    expect(resolveInterpolations("{{client}}")).toBe("unknown");
  });

  it("resolves to the name set by setClientName", () => {
    setClientName("claude-code");
    expect(resolveInterpolations("{{client}}")).toBe("claude-code");
  });

  it("reflects the most recent setClientName call", () => {
    setClientName("first-client");
    setClientName("second-client");
    expect(resolveInterpolations("{{client}}")).toBe("second-client");
  });
});

describe("resolveInterpolations — combined", () => {
  it("resolves multiple different placeholders in one string", () => {
    setClientName("test-client");
    vi.mocked(isScopingEnabled).mockReturnValue(true);
    vi.mocked(getActiveScope).mockReturnValue("work");
    const result = resolveInterpolations("user={{user}}, client={{client}}, scope={{scope}}");
    expect(result).toBe("user=test-user, client=test-client, scope=work");
  });
});

describe("setClientName", () => {
  it("updates the client name used by subsequent resolveInterpolations calls", () => {
    setClientName("joule-work-desktop");
    expect(resolveInterpolations("{{client}}")).toBe("joule-work-desktop");
  });
});
