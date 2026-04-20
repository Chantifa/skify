import { describe, expect, it, vi } from 'vitest';
import app from './index';

type TestEnv = {
  API_TOKEN?: string;
  ALLOW_INSECURE_ADMIN?: string;
  GITHUB_API: string;
  SKILLS?: object;
  DB?: object;
};

function createEnv(overrides: Partial<TestEnv> = {}): TestEnv {
  return {
    GITHUB_API: 'https://api.github.com',
    ...overrides,
  };
}

function makeSkillsKv() {
  const store = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    _store: store,
  };
}

function makeDb() {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        run: vi.fn(async () => ({ success: true })),
        first: vi.fn(async () => null),
      })),
    })),
  };
}

function publishBody(overrides: object = {}) {
  return JSON.stringify({
    owner: 'acme',
    repo: 'skills',
    name: 'my-skill',
    content: '# SKILL.md\nname: my-skill\ndescription: test\ntags: []\n',
    ...overrides,
  });
}

describe('admin auth middleware', () => {
  it('returns 401 when no token is provided and insecure mode is disabled', async () => {
    const res = await app.request('/api/admin/ping', { method: 'POST' }, createEnv() as never);

    expect(res.status).toBe(401);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain('Unauthorized');
  });

  it('allows admin route without token when insecure mode is explicitly enabled', async () => {
    const res = await app.request(
      '/api/admin/ping',
      { method: 'POST' },
      createEnv({ ALLOW_INSECURE_ADMIN: 'true' }) as never
    );

    // Auth middleware passes, then falls through to framework 404.
    expect(res.status).toBe(404);
  });

  it('returns 401 when API_TOKEN exists but auth header is missing', async () => {
    const res = await app.request(
      '/api/admin/ping',
      { method: 'POST' },
      createEnv({ API_TOKEN: 'secret-token' }) as never
    );

    expect(res.status).toBe(401);
  });

  it('returns 401 when API_TOKEN exists but auth header is invalid', async () => {
    const res = await app.request(
      '/api/admin/ping',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
      },
      createEnv({ API_TOKEN: 'secret-token' }) as never
    );

    expect(res.status).toBe(401);
  });

  it('accepts request when bearer token is valid', async () => {
    const res = await app.request(
      '/api/admin/ping',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer secret-token' },
      },
      createEnv({ API_TOKEN: 'secret-token' }) as never
    );

    // Auth middleware passes, then falls through to framework 404.
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/skills', () => {
  it('stores each file individually when files field is provided', async () => {
    const skills = makeSkillsKv();
    const db = makeDb();

    const res = await app.request(
      '/api/admin/skills',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: publishBody({
          files: {
            'SKILL.md': '# SKILL.md\nname: my-skill\ndescription: test\ntags: []\n',
            'prompt.md': '# Prompt',
          },
        }),
      },
      createEnv({ ALLOW_INSECURE_ADMIN: 'true', SKILLS: skills, DB: db }) as never
    );

    expect(res.status).toBe(200);
    expect(skills.put).toHaveBeenCalledWith('acme/skills/my-skill/SKILL.md', expect.any(String));
    expect(skills.put).toHaveBeenCalledWith('acme/skills/my-skill/prompt.md', '# Prompt');
    expect(skills.put).toHaveBeenCalledTimes(2);
  });

  it('falls back to storing only SKILL.md when files field is absent', async () => {
    const skills = makeSkillsKv();
    const db = makeDb();

    const res = await app.request(
      '/api/admin/skills',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: publishBody(),
      },
      createEnv({ ALLOW_INSECURE_ADMIN: 'true', SKILLS: skills, DB: db }) as never
    );

    expect(res.status).toBe(200);
    expect(skills.put).toHaveBeenCalledTimes(1);
    expect(skills.put).toHaveBeenCalledWith('acme/skills/my-skill/SKILL.md', expect.any(String));
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await app.request(
      '/api/admin/skills',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: 'acme' }),
      },
      createEnv({ ALLOW_INSECURE_ADMIN: 'true', SKILLS: makeSkillsKv(), DB: makeDb() }) as never
    );

    expect(res.status).toBe(400);
  });
});
