#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import process from 'node:process';

const root = '/Users/lynn/Desktop/cursor-ws/skify';
const composeCwd = `${root}/deploy/docker`;
const baseUrl = 'http://localhost:8787';

function run(cmd, options = {}) {
  execSync(cmd, {
    cwd: composeCwd,
    stdio: 'inherit',
    ...options,
  });
}

function pickComposeCommand() {
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    return 'docker compose';
  } catch {
    return 'docker-compose';
  }
}

async function waitHealth(retries = 30) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('API health check timed out');
}

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { res, json };
}

async function assertStatus(path, expected, options = {}) {
  const { res, json } = await request(path, options);
  if (res.status !== expected) {
    throw new Error(`Expected ${expected} for ${path}, got ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

const composeCmd = pickComposeCommand();
const adminToken = `admin_${randomBytes(12).toString('hex')}`;

console.log('Starting Docker stack for e2e...');
run(`${composeCmd} down -v`, { env: { ...process.env, API_TOKEN: adminToken, ALLOW_ANONYMOUS_READ: 'false' } });
run(`${composeCmd} up -d --build`, { env: { ...process.env, API_TOKEN: adminToken, ALLOW_ANONYMOUS_READ: 'false' } });

try {
  await waitHealth();

  await assertStatus('/api/skills', 401);

  const publishTokenResp = await assertStatus('/api/admin/tokens', 200, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ name: 'e2e-publish', permissions: ['publish'] }),
  });
  const publishToken = publishTokenResp.token.value;

  const readTokenResp = await assertStatus('/api/admin/tokens', 200, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ name: 'e2e-read', permissions: ['read'] }),
  });
  const readToken = readTokenResp.token.value;
  const readTokenId = readTokenResp.token.id;

  await assertStatus('/api/admin/skills', 200, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${publishToken}`,
    },
    body: JSON.stringify({
      owner: 'e2e',
      repo: 'skills',
      name: 'sample-skill',
      description: 'e2e skill',
      tags: ['test'],
      content: '---\nname: sample-skill\ndescription: e2e\n---\n# hello',
    }),
  });

  const skills = await assertStatus('/api/skills', 200, {
    headers: { Authorization: `Bearer ${readToken}` },
  });
  if (!Array.isArray(skills.skills) || skills.skills.length === 0) {
    throw new Error('Expected at least one skill in read-token list');
  }

  await assertStatus('/api/admin/skills/e2e/skills/sample-skill', 401, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${readToken}` },
  });

  await assertStatus('/api/admin/tokens', 401, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${publishToken}`,
    },
    body: JSON.stringify({ name: 'should-fail', permissions: ['read'] }),
  });

  await assertStatus(`/api/admin/tokens/${readTokenId}/revoke`, 200, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  await assertStatus('/api/skills', 401, {
    headers: { Authorization: `Bearer ${readToken}` },
  });

  console.log('E2E passed');
} finally {
  console.log('Stopping Docker stack...');
  run(`${composeCmd} down -v`, { env: { ...process.env, API_TOKEN: adminToken, ALLOW_ANONYMOUS_READ: 'false' } });
}
