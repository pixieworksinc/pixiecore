/**
 * Tests the Drupal demo's fixture host across the actual runtime/HTTP boundary.
 * No Drupal installation, credentials, or paid provider is required here.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import { startMockSpecificationHost } from '../../examples/integrations/drupal/executable-specification/runtime/mock-server.js';

const template = parse(readFileSync(new URL('../../examples/integrations/drupal/pixiecore_specification/blueprints/customer-discount/customer-discount.yaml', import.meta.url), 'utf8')) as { prompt: string };

test('Drupal LF and HTML-form CRLF revisions execute without changing the Blueprint prompt', async () => {
  const host = await startMockSpecificationHost();
  const endpoint = `http://127.0.0.1:${(host.server.address() as AddressInfo).port}/execute`;
  try {
    for (const newline of ['\n', '\r\n']) {
      for (const [threshold, finalPrice] of [['1000', 960], ['2000', 1200]] as const) {
        const prompt = template.prompt.split('strictly greater than 1000').join(`strictly greater than ${threshold}`).replace(/\n/g, newline);
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blueprint: stringify({ ...template, prompt }), inputs: { customer_tier: 'Gold', purchase_amount: 1200 } }),
        });
        assert.equal(response.status, 200);
        const result = await response.json() as { status: string; data: { final_price: number }; metadata: { provider: string } };
        assert.equal(result.status, 'success');
        assert.equal(result.data.final_price, finalPrice);
        assert.equal(result.metadata.provider, 'fixture-mock');
        const delivered = host.calls.at(-1)?.messages.filter(message => message.role === 'user').at(-1)?.content;
        assert.equal(delivered, prompt.replace('{{ customer_tier }}', 'Gold').replace('{{ purchase_amount }}', '1200'));
      }
    }
    assert.equal(host.calls.length, 4);
  } finally {
    await Promise.all([host.close(), host.close()]);
  }
});

test('Drupal mock rejects unknown instructions and rejects invalid inputs before provider dispatch', async () => {
  const host = await startMockSpecificationHost();
  const endpoint = `http://127.0.0.1:${(host.server.address() as AddressInfo).port}/execute`;
  try {
    const unknown = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint: stringify({ ...template, prompt: 'Unknown business rule' }), inputs: { customer_tier: 'Gold', purchase_amount: 1200 } }),
    });
    const result = await unknown.json() as { status: string };
    assert.equal(result.status, 'error');
    assert.equal(host.calls.length, 1);
    const invalid = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint: stringify(template), inputs: { customer_tier: 'Gold', purchase_amount: -1 } }),
    });
    assert.equal((await invalid.json() as { status: string }).status, 'error');
    assert.equal(host.calls.length, 1);
  } finally {
    await host.close();
  }
});

test('Drupal demo Blueprint accepts server-injected caller context without relaxing business inputs', async () => {
  const host = await startMockSpecificationHost(0, () => ({ role: 'demo-user', userId: 'synthetic-user' }));
  const endpoint = `http://127.0.0.1:${(host.server.address() as AddressInfo).port}/execute`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint: stringify(template), inputs: { customer_tier: 'Gold', purchase_amount: 1200 } }),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as { status: string; data: { final_price: number } };
    assert.equal(result.status, 'success');
    assert.equal(result.data.final_price, 960);
    assert.equal(host.calls.length, 1);
  } finally {
    await host.close();
  }
});
