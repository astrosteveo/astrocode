import { expect, test } from "bun:test";
import { hasSecret } from "./secrets";

// Each of claude 2.1.318's kinds of secret, and text that only looks like one.
test("finds the secrets claude finds", () => {
  for (const text of [
    "sk-ant-api03-AbCdEfGh1234567890abcdefXYZ",
    "OPENAI_API_KEY=sk-proj-abcdefghij1234567890abcd",
    "-H 'Authorization: Bearer abcdef0123456789abcdef'",
    "Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==",
    "aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE",
    "git clone https://ghp_abcdefghij1234567890ABCD@github.com/me/repo",
    "glpat-abcdefghij1234567890",
    "curl https://hooks.slack.com/services/T000/B000/XXXX",
    `key=AIza${"a".repeat(35)}`,
    `STRIPE=sk_live_${"a1".repeat(12)}`,
    `eyJ${"a".repeat(256)}`,
    // Past the first piece of a long text, as in a long paste.
    `${"x ".repeat(40000)}sk-ant-api03-AbCdEfGh1234567890abcdefXYZ`,
  ])
    expect(hasSecret(text)).toBe(true);
});

test("lets through what only looks like a secret", () => {
  for (const text of ["git status", "sk-ant-short", "Bearer token", "ghp_short", "AKIAIOSFODNN7EXAMPL", "eyJabc"]) expect(hasSecret(text)).toBe(false);
});
