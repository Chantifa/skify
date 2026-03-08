import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSkillContent } from './github.js';

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockTextResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}

describe('getSkillContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses repository default branch when fetching SKILL.md', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.github.com/repos/acme/repo') {
        return mockJsonResponse({ default_branch: 'develop' });
      }
      if (url === 'https://raw.githubusercontent.com/acme/repo/develop/skills/test-skill/SKILL.md') {
        return mockTextResponse('---\nname: test-skill\ndescription: hello\n---\n# body');
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const skill = await getSkillContent('acme/repo', 'test-skill', 'skills');

    expect(skill.name).toBe('test-skill');
    expect(skill.description).toBe('hello');
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/repos/acme/repo', expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/acme/repo/develop/skills/test-skill/SKILL.md',
      expect.anything()
    );
  });

  it('falls back to main/master when default branch lookup or fetch misses', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.github.com/repos/acme/repo') {
        return new Response('error', { status: 500 });
      }
      if (url === 'https://raw.githubusercontent.com/acme/repo/main/skills/test-skill/SKILL.md') {
        return new Response('missing', { status: 404 });
      }
      if (url === 'https://raw.githubusercontent.com/acme/repo/master/skills/test-skill/SKILL.md') {
        return mockTextResponse('---\nname: test-skill\ndescription: from master\n---\nBody');
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const skill = await getSkillContent('acme/repo', 'test-skill', 'skills');

    expect(skill.description).toBe('from master');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/acme/repo/master/skills/test-skill/SKILL.md',
      expect.anything()
    );
  });
});
