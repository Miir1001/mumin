import { validateEnv } from "./env.validation";

describe("validateEnv", () => {
  const validEnv = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    REDIS_URL: "redis://localhost:6379",
    JWT_ACCESS_SECRET: "a".repeat(32),
    JWT_REFRESH_SECRET: "b".repeat(32),
  };

  it("accepts a valid configuration and applies defaults", () => {
    const result = validateEnv(validEnv);

    expect(result.NODE_ENV).toBe("development");
    expect(result.API_PORT).toBe(4000);
    expect(result.JWT_ACCESS_TTL).toBe("15m");
  });

  it("throws when a required variable is missing", () => {
    const rest: Record<string, string> = { ...validEnv };
    delete rest.DATABASE_URL;

    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it("throws when a JWT secret is too short", () => {
    expect(() => validateEnv({ ...validEnv, JWT_ACCESS_SECRET: "short" })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("coerces API_PORT from a string", () => {
    const result = validateEnv({ ...validEnv, API_PORT: "5050" });

    expect(result.API_PORT).toBe(5050);
  });
});
