'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const Core = require('../personal.js');
const storage = () => ({ values: new Map(), getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }, setItem(key, value) { this.values.set(key, value); }, removeItem(key) { this.values.delete(key); } });
const record = () => ({ version: 2, entries: [{ id: 'entry-1', text: 'A private thought', t: 1700000000000 }], goals: [], reminders: [] });

test('Today goals sort before other timeframes and completed goals follow unfinished ones', () => {
  const sorted = Core.sortGoals([{ term: 'Long term', done: false }, { term: 'Today', done: true }, { term: 'This week', done: false }, { term: 'Today', done: false }]);
  assert.deepEqual(sorted.map(value => [value.term, value.done]), [['Today', false], ['This week', false], ['Long term', false], ['Today', true]]);
});
test('failed persistent write does not commit an in-memory record or destroy previous record', async () => {
  const disk = storage(), store = new Core.DataStore(disk, 'vault', webcrypto); store.load(); store.saveOnDevice();
  const before = disk.getItem('vault'); disk.setItem = () => { throw Error('QuotaExceeded'); };
  await assert.rejects(store.commit(record()));
  assert.deepEqual(store.model, Core.empty()); assert.equal(disk.getItem('vault'), before);
});
test('session-only mutations do not touch device storage', async () => {
  const disk = storage(), store = new Core.DataStore(disk, 'vault', webcrypto); store.load();
  await store.commit(record()); assert.equal(store.model.entries.length, 1); assert.equal(disk.values.size, 0);
});
test('a stale tab cannot overwrite records saved by another tab', async () => {
  const disk = storage(), first = new Core.DataStore(disk, 'vault', webcrypto); first.load(); first.saveOnDevice();
  const second = new Core.DataStore(disk, 'vault', webcrypto); second.load();
  await first.commit(record()); const current = disk.getItem('vault');
  const stale = Core.empty(); stale.goals.push({ id: 'goal-1', text: 'Stale tab draft', term: 'Today', done: false });
  await assert.rejects(second.commit(stale));
  assert.equal(disk.getItem('vault'), current); assert.equal(second.model, null); assert.equal(second.invalidated, true);
});
test('legacy records migrate without losing IDs or removing data before verified write', async () => {
  const disk = storage(); disk.setItem('imh_journal', JSON.stringify([{ text: 'Before update', t: 1700000000000 }]));
  const store = new Core.DataStore(disk, 'vault', webcrypto); assert.equal(store.load(), true);
  assert.equal(store.model.entries[0].text, 'Before update');
  const original = disk.getItem('imh_journal'); const write = disk.setItem.bind(disk); disk.setItem = () => { throw Error('QuotaExceeded'); };
  await assert.rejects(store.commit(store.model)); assert.equal(disk.getItem('imh_journal'), original);
  disk.setItem = write; await store.commit(store.model); assert.equal(disk.getItem('imh_journal'), null);
  assert.equal(JSON.parse(disk.getItem('vault')).data.entries[0].text, 'Before update');
});
test('encryption removes plaintext only after verified ciphertext, authenticates password and locks memory', async () => {
  const disk = storage(); disk.setItem('imh_journal', JSON.stringify([{ text: 'Secret example', t: 1700000000000 }]));
  const store = new Core.DataStore(disk, 'vault', webcrypto); store.load(); await store.encrypt('long unique phrase 123');
  const serialized = disk.getItem('vault'); assert.equal(serialized.includes('Secret example'), false); assert.equal(disk.getItem('imh_journal'), null);
  assert.equal(JSON.parse(serialized).mode, 'encrypted');
  store.lock(); assert.equal(store.model, null); assert.equal(store.key, null); assert.equal(store.locked, true);
  await assert.rejects(store.unlock('wrong phrase')); assert.equal(store.locked, true);
  await store.unlock('long unique phrase 123'); assert.equal(store.model.entries[0].text, 'Secret example');
  const next = structuredClone(store.model); next.entries[0].text = 'Changed secret'; await store.commit(next);
  assert.equal(disk.getItem('vault').includes('Changed secret'), false);
  store.lock(); await store.unlock('long unique phrase 123'); assert.equal(store.model.entries[0].text, 'Changed secret');
});
test('tampered ciphertext cannot be unlocked', async () => {
  const salt = webcrypto.getRandomValues(new Uint8Array(16)); const key = await Core.deriveKey('example long phrase', salt, Core.ITERATIONS, webcrypto);
  const envelope = await Core.seal(record(), key, salt, webcrypto);
  envelope.cipher = (envelope.cipher[0] === 'A' ? 'B' : 'A') + envelope.cipher.slice(1);
  await assert.rejects(Core.unseal(envelope, 'example long phrase', webcrypto));
});
test('encryption never deletes old records changed by another open app copy', async () => {
  const disk = storage(); disk.setItem('imh_journal', JSON.stringify([{ text: 'First version', t: 1700000000000 }]));
  const store = new Core.DataStore(disk, 'vault', webcrypto); store.load();
  const changed = JSON.stringify([{ text: 'Newer version from another tab', t: 1700000000001 }]); disk.setItem('imh_journal', changed);
  await assert.rejects(store.encrypt('long unique phrase 123'));
  assert.equal(disk.getItem('imh_journal'), changed);
  assert.equal(JSON.parse(disk.getItem('vault')).mode, 'encrypted');
});
test('invalid saved records are preserved and require explicit recovery action', () => {
  const disk = storage(); disk.setItem('vault', 'broken JSON'); const store = new Core.DataStore(disk, 'vault', webcrypto);
  assert.equal(store.load(), false); assert.equal(store.blocked, true); assert.equal(disk.getItem('vault'), 'broken JSON');
  store.useSession(); assert.equal(store.blocked, false); assert.deepEqual(store.model, Core.empty()); assert.equal(disk.getItem('vault'), 'broken JSON');
});
test('a stale writer cannot replace an encrypted vault or resurrect cleared records', async () => {
  const disk = storage(), first = new Core.DataStore(disk, 'vault', webcrypto); first.load(); await first.commit(record()); first.saveOnDevice();
  const staleBeforeEncryption = new Core.DataStore(disk, 'vault', webcrypto); staleBeforeEncryption.load();
  await first.encrypt('long unique phrase 123'); const encrypted = disk.getItem('vault');
  await assert.rejects(staleBeforeEncryption.commit(record())); assert.equal(disk.getItem('vault'), encrypted); assert.equal(staleBeforeEncryption.model, null);
  const staleBeforeClear = new Core.DataStore(disk, 'vault', webcrypto); staleBeforeClear.load(); await staleBeforeClear.unlock('long unique phrase 123');
  first.clear(); await assert.rejects(staleBeforeClear.commit(record())); assert.equal(disk.getItem('vault'), null); assert.equal(staleBeforeClear.key, null); assert.equal(staleBeforeClear.model, null);
});
test('external changes invalidate decrypted memory only for relevant storage keys', () => {
  const disk = storage(), store = new Core.DataStore(disk, 'vault', webcrypto); store.load(); store.model = record();
  assert.equal(store.externalChange('other-vault'), false); assert.equal(store.model.entries.length, 1);
  assert.equal(store.externalChange('vault'), true); assert.equal(store.model, null); assert.equal(store.blocked, true); assert.equal(store.key, null);
});
test('import validation strips unexpected fields and rejects duplicate IDs, malformed dates and oversized text', () => {
  const model = record(); model.entries[0].unexpected = '<script>'; assert.equal('unexpected' in Core.validateModel(model).entries[0], false);
  model.goals.push({ id: 'entry-1', text: 'duplicate', term: 'Today', done: false }); assert.throws(() => Core.validateModel(model));
  assert.equal(Core.validDate('2026-02-30'), false); assert.equal(Core.validDate('2028-02-29'), true);
  assert.throws(() => Core.validateModel({ ...record(), reminders: [{ id: 'r', text: 'bad date', date: '2026-11-31' }] }));
});
test('the shared UTF-8 model bound accepts restorable large backups and rejects over-limit mutations before writing', async () => {
  const model = Core.empty();
  for (let n = 0; n < 1000; n++) model.entries.push({ id: 'large-entry-' + n, text: 'x'.repeat(20000), t: 1700000000000 });
  const valid = Core.validateModel(model), bytes = Buffer.byteLength(JSON.stringify(valid), 'utf8');
  assert.ok(bytes > 5 * 1024 * 1024 && bytes <= Core.MAX_MODEL_BYTES);
  assert.deepEqual(Core.validateModel(JSON.parse(JSON.stringify(valid))), valid);
  for (let n = 1000; n < 1060; n++) model.entries.push({ id: 'large-entry-' + n, text: 'x'.repeat(20000), t: 1700000000000 });
  assert.throws(() => Core.validateModel(model), /backup size/);
  const disk = storage(), store = new Core.DataStore(disk, 'vault', webcrypto); store.load(); store.saveOnDevice(); const before = disk.getItem('vault');
  await assert.rejects(store.commit(model), /backup size/); assert.equal(disk.getItem('vault'), before); assert.deepEqual(store.model, Core.empty());
  const unicode = Core.empty();
  for (let n = 0; n < 600; n++) unicode.entries.push({ id: 'unicode-entry-' + n, text: 'é'.repeat(20000), t: 1700000000000 });
  assert.ok(JSON.stringify(unicode).length < Core.MAX_MODEL_BYTES); assert.throws(() => Core.validateModel(unicode), /backup size/);
});
test('upcoming reminders lead and past reminders are newest first', () => {
  const { upcoming, past } = Core.splitReminders([{ date: '2026-11-03' }, { date: '2026-12-01' }, { date: '2026-11-04' }, { date: '2026-11-05' }], '2026-11-05');
  assert.deepEqual(upcoming.map(value => value.date), ['2026-11-05', '2026-12-01']); assert.deepEqual(past.map(value => value.date), ['2026-11-04', '2026-11-03']);
});
test('calendar uses date-only boundaries, proper escaping, alarms and UTF-8 folding', () => {
  const text = 'Été, rendez-vous; ligne\\suite\n' + 'é'.repeat(70);
  const value = Core.calendar([{ id: 'rem-1', text, date: '2026-12-31' }], new Date('2026-11-05T13:00:00Z'));
  assert.match(value, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.match(value, /SUMMARY:Été\\, rendez-vous\\; ligne\\\\suite\\n/);
  assert.match(value, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-P1D/);
  for (const line of value.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
});
test('clearing personal records leaves unrelated site data alone', () => {
  const disk = storage(); disk.setItem('other-site-record', 'retain'); disk.setItem('vault', JSON.stringify({ version: 2, mode: 'plain', data: record() }));
  const store = new Core.DataStore(disk, 'vault', webcrypto); store.load(); store.clear();
  assert.equal(disk.getItem('vault'), null); assert.equal(disk.getItem('other-site-record'), 'retain'); assert.deepEqual(store.model, Core.empty());
});
test('clear discards decrypted memory and attempts remaining keys if one deletion fails', () => {
  const disk = storage(); disk.setItem('imh_journal', JSON.stringify([{ text: 'Private legacy data', t: 1700000000000 }])); disk.setItem('imh_goals', '[]');
  const store = new Core.DataStore(disk, 'vault', webcrypto); store.load();
  const remove = disk.removeItem.bind(disk); disk.removeItem = key => { if (key === 'imh_journal') throw Error('denied'); remove(key); };
  assert.throws(() => store.clear()); assert.deepEqual(store.model, Core.empty()); assert.equal(disk.getItem('imh_goals'), null); assert.equal(store.key, null);
});
test('clear preserves unknown legacy data and loaded legacy records changed by another copy', () => {
  const disk = storage(); disk.setItem('vault', JSON.stringify({ version: 2, mode: 'plain', data: record() })); disk.setItem('imh_journal', 'unknown legacy record');
  const store = new Core.DataStore(disk, 'vault', webcrypto); store.load(); store.clear();
  assert.equal(disk.getItem('imh_journal'), 'unknown legacy record'); assert.equal(disk.getItem('vault'), null);
  disk.removeItem('imh_journal'); disk.setItem('imh_goals', '[]');
  const legacy = new Core.DataStore(disk, 'vault', webcrypto); legacy.load();
  disk.setItem('imh_goals', JSON.stringify([{ text: 'Other copy changed it', term: 'Today', done: false }]));
  assert.throws(() => legacy.clear()); assert.ok(disk.getItem('imh_goals').includes('Other copy changed it'));
});
