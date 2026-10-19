import { afterEach, describe, expect, it } from "vitest";
import { configuredOrigins, isAllowedOrigin } from "../../apps/api/src/http/origins";

const configured = ["http://localhost:3000"];

describe("CORS origins", () => {
  const previous = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = previous;
  });

  it("splits and trims WEB_APP_URL", () => {
    expect(configuredOrigins("http://localhost:3000/, https://app.example.com")).toEqual([
      "http://localhost:3000",
      "https://app.example.com",
    ]);
  });

  it("allows the configured origin and non-browser requests", () => {
    process.env.NODE_ENV = "production";
    expect(isAllowedOrigin(undefined, configured)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000", configured)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000/", configured)).toBe(true);
  });

  it("allows Next's fallback port on loopback outside production", () => {
    process.env.NODE_ENV = "development";
    expect(isAllowedOrigin("http://localhost:3001", configured)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3001", configured)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", configured)).toBe(false);
  });

  it("refuses other loopback ports in production", () => {
    process.env.NODE_ENV = "production";
    expect(isAllowedOrigin("http://localhost:3001", configured)).toBe(false);
    expect(isAllowedOrigin("https://evil.example", configured)).toBe(false);
  });
});
