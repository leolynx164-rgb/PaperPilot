'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseActionBlocks, stripForDisplay } = require('../src/shared/protocol');

test('extrait les blocs d’action et nettoie le texte', () => {
  const t = 'Je cherche.\n```paperpilot-action\n{"type":"search_files","args":{"query":"facture"}}\n```\n';
  const { clean, blocks } = parseActionBlocks(t);
  assert.equal(clean, 'Je cherche.');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].value.type, 'search_files');
});

test('un JSON invalide produit une erreur, jamais une action', () => {
  const { blocks } = parseActionBlocks('```paperpilot-action\n{type: oups}\n```');
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].error);
  assert.equal(blocks[0].value, undefined);
});

test('accepte un tableau d’actions dans un seul bloc', () => {
  const { blocks } = parseActionBlocks('```paperpilot-action\n[{"type":"a"},{"type":"b"}]\n```');
  assert.deepEqual(blocks.map((b) => b.value.type), ['a', 'b']);
});

test('masque un bloc encore en cours d’écriture pendant le flux', () => {
  assert.equal(stripForDisplay('Je cherche.\n```paperpilot-action\n{"type":"sea'), 'Je cherche.');
  assert.equal(stripForDisplay('Je cherche.\n```paperp'), 'Je cherche.');
  assert.equal(stripForDisplay('Du code : `x` et ```js\nlet a\n```'), 'Du code : `x` et ```js\nlet a\n```');
});
