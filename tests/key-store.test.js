'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const KeyStore = require('../extension/key-store.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const clone = value => structuredClone(value);
const safeFailure = { code: 'KEY_STORE_UNAVAILABLE', message: 'API Key storage is unavailable.' };
const RECORD = 'api-key-aes-gcm-v1';
test('local connection encryption is independent of API Key encryption and deletion',async()=>{
  const indexedDB=memoryIDB(),api=KeyStore.create({indexedDB,crypto:webcrypto}),build=KeyStore.create({indexedDB,crypto:webcrypto,purpose:'build-connection'});
  const a=await api.seal('api-fixture-value'),b=await build.seal('local-connection-fixture-value');
  assert.equal(await api.open(a),'api-fixture-value');assert.equal(await build.open(b),'local-connection-fixture-value');
  await assert.rejects(api.open(b),safeFailure);await assert.rejects(build.open(a),safeFailure);
  await api.clear();assert.equal(await build.open(b),'local-connection-fixture-value');await build.clear();await assert.rejects(build.open(b),safeFailure);
});

async function until(predicate, label) {
  for (let i = 0; i < 100; i += 1) { if (predicate()) return; await tick(); }
  assert.fail(`Timed out waiting for ${label}`);
}

// A deliberately small transactional IndexedDB fixture. Request success and
// durable commit are separate events, with serialized writer transactions and
// structured-cloned CryptoKeys. Abort/blocked/error controls model the storage
// lifecycle failures the module must handle; cryptography itself is real.
function memoryIDB() {
  const state = {
    exists: false, records: new Map(), queue: [], active: null, connections: [],
    opens: 0, puts: 0, deletes: 0, aborted: 0, strictWrites: [],
    openModes: [], lateOpens: [], holdWrites: false, heldCommits: [],
    abortNextWrite: false, failNextPut: false, failNextGet: false,
    unsupportedDurability: false, throwTransaction: false
  };
  function dispatch(request, name) { if (typeof request[name] === 'function') request[name]({ target: request }); }
  function advance() {
    if (state.active || !state.queue.length) return;
    const tx = state.queue.shift(); state.active = tx;
    tx.view = new Map([...state.records].map(([key, value]) => [key, clone(value)]));
    tx.started = true;
    tx.pump();
  }
  function release(tx) {
    if (state.active === tx) state.active = null;
    queueMicrotask(advance);
  }
  function makeTransaction(mode, options) {
    const tx = {
      mode, requests: [], started: false, ended: false, processing: false, finishing: false,
      view: null,
      abort() {
        if (tx.ended) throw new DOMException('Transaction is finished.', 'InvalidStateError');
        tx.ended = true; state.aborted += 1;
        queueMicrotask(() => { dispatch(tx, 'onabort'); release(tx); });
      },
      objectStore() {
        function request(action) {
          if (tx.ended) throw new DOMException('Inactive transaction.', 'TransactionInactiveError');
          const request = {};
          tx.requests.push({ request, action });
          if (tx.started) queueMicrotask(tx.pump);
          return request;
        }
        return {
          get(key) { return request(() => {
            if (state.failNextGet) { state.failNextGet = false; throw new Error('Synthetic secret in underlying read failure.'); }
            return tx.view.has(key) ? clone(tx.view.get(key)) : undefined;
          }); },
          put(value, key) { return request(() => {
            if (state.failNextPut) { state.failNextPut = false; throw new Error('Synthetic secret in underlying write failure.'); }
            if (mode !== 'readwrite') throw new DOMException('Readonly transaction.', 'ReadOnlyError');
            tx.view.set(key, clone(value)); state.puts += 1; return key;
          }); },
          delete(key) { return request(() => { tx.view.delete(key); state.deletes += 1; }); }
        };
      },
      pump() {
        if (tx.ended || tx.processing || tx.finishing) return;
        if (!tx.requests.length) {
          tx.finishing = true;
          const commit = () => {
            if (tx.ended) return;
            if (mode === 'readwrite' && state.abortNextWrite) { state.abortNextWrite = false; tx.abort(); return; }
            if (mode === 'readwrite') state.records = tx.view;
            tx.ended = true;
            dispatch(tx, 'oncomplete'); release(tx);
          };
          if (mode === 'readwrite' && state.holdWrites) state.heldCommits.push(commit);
          else queueMicrotask(commit);
          return;
        }
        tx.processing = true;
        const { request, action } = tx.requests.shift();
        queueMicrotask(() => {
          if (tx.ended) return;
          try { request.result = action(); dispatch(request, 'onsuccess'); }
          catch (error) {
            request.error = error; dispatch(request, 'onerror');
            if (!tx.ended) tx.abort();
          }
          tx.processing = false;
          queueMicrotask(tx.pump);
        });
      }
    };
    if (mode === 'readwrite') state.strictWrites.push(options?.durability);
    state.queue.push(tx); queueMicrotask(advance);
    return tx;
  }
  function makeConnection() {
    const connection = {
      closed: false,
      objectStoreNames: { contains: name => name === 'keys' && state.exists },
      createObjectStore(name) { assert.equal(name, 'keys'); state.exists = true; return {}; },
      transaction(name, mode, options) {
        assert.equal(name, 'keys');
        if (connection.closed || state.throwTransaction) throw new DOMException('Closed database contains synthetic secret.', 'InvalidStateError');
        if (options && state.unsupportedDurability) throw new TypeError('Unsupported durability.');
        return makeTransaction(mode, options);
      },
      close() { connection.closed = true; }
    };
    state.connections.push(connection);
    return connection;
  }
  const indexedDB = {
    state,
    open(name, version) {
      assert.equal(name, 'superx-key-store'); assert.equal(version, 1); state.opens += 1;
      const request = {}, mode = state.openModes.shift();
      const succeed = () => {
        let aborted = false;
        const existed = state.exists;
        request.result = makeConnection();
        request.transaction = { abort() { aborted = true; state.exists = existed; } };
        if (!state.exists) dispatch(request, 'onupgradeneeded');
        if (aborted) { request.error = new Error('Aborted upgrade.'); dispatch(request, 'onerror'); request.result.close(); }
        else dispatch(request, 'onsuccess');
      };
      if (mode === 'hang') state.lateOpens.push(succeed);
      else queueMicrotask(() => {
        if (mode === 'error') { request.error = new Error('Synthetic secret in open failure.'); dispatch(request, 'onerror'); }
        else if (mode === 'blocked') { dispatch(request, 'onblocked'); state.lateOpens.push(succeed); }
        else succeed();
      });
      return request;
    }
  };
  return indexedDB;
}

function instrumentCrypto(overrides = {}) {
  const calls = { generate: 0, encrypt: 0, decrypt: 0, random: 0 };
  return {
    calls,
    getRandomValues(bytes) { calls.random += 1; return webcrypto.getRandomValues(bytes); },
    subtle: {
      async generateKey(...args) { calls.generate += 1; return overrides.generateKey ? overrides.generateKey(...args) : webcrypto.subtle.generateKey(...args); },
      async encrypt(...args) { calls.encrypt += 1; return overrides.encrypt ? overrides.encrypt(...args) : webcrypto.subtle.encrypt(...args); },
      async decrypt(...args) { calls.decrypt += 1; return overrides.decrypt ? overrides.decrypt(...args) : webcrypto.subtle.decrypt(...args); }
    }
  };
}
function fixture(options = {}) {
  const indexedDB = options.indexedDB || memoryIDB();
  const crypto = options.crypto || instrumentCrypto();
  return { indexedDB, crypto, store: KeyStore.create({ indexedDB, crypto, timeoutMs: options.timeoutMs || 1000 }) };
}
function alterBase64(value) { return (value[0] === 'A' ? 'B' : 'A') + value.slice(1); }

test('automatic encryption survives a new worker with a nonextractable durable CryptoKey and no plaintext IDB record', async () => {
  const { store, indexedDB, crypto } = fixture();
  const secret = 'synthetic-own-xai-api-key-123456';
  const envelope = await store.seal(`  ${secret}  `);
  assert.equal(store.isEnvelope(envelope), true);
  assert.equal(await store.open(envelope), secret);
  const restarted = KeyStore.create({ indexedDB, crypto });
  assert.equal(await restarted.open(clone(envelope)), secret);
  assert.equal(indexedDB.state.records.size, 1);
  const durable = indexedDB.state.records.get(RECORD);
  assert.equal(durable.extractable, false);
  assert.equal(durable.algorithm.length, 256);
  await assert.rejects(webcrypto.subtle.exportKey('raw', durable));
  assert.equal(JSON.stringify(envelope).includes(secret), false);
  assert.equal(JSON.stringify([...indexedDB.state.records]).includes(secret), false);
  assert.deepEqual(Object.keys(envelope).sort(), ['algorithm', 'ciphertext', 'iv', 'version']);
});

test('each saved cipher has a fresh 96-bit IV while replacements reuse the durable Key', async () => {
  const { store, indexedDB, crypto } = fixture();
  const first = await store.seal('synthetic-key-first');
  const repeated = await store.seal('synthetic-key-first');
  const replacement = await KeyStore.create({ indexedDB, crypto }).seal('synthetic-key-second');
  assert.equal(new Set([first.iv, repeated.iv, replacement.iv]).size, 3);
  assert.notEqual(first.ciphertext, repeated.ciphertext);
  assert.equal(Buffer.from(first.iv, 'base64').length, 12);
  assert.equal(crypto.calls.generate, 1);
  assert.equal(indexedDB.state.puts, 1);
  assert.equal(await store.open(first), 'synthetic-key-first');
  assert.equal(await store.open(replacement), 'synthetic-key-second');
});

test('invalid raw Keys never open storage or expose their input in an error', async () => {
  const { store, indexedDB, crypto } = fixture();
  for (const raw of ['', '  ', null, 123, 'synthetic\nsecret', 'synthetic\rsecret', 'x'.repeat(501)]) {
    await assert.rejects(store.seal(raw), { code: 'KEY_STORE_INVALID_KEY', message: 'Invalid API Key.' });
  }
  assert.equal(indexedDB.state.opens, 0);
  assert.equal(crypto.calls.generate, 0);
});

test('bounded canonical envelope validation rejects malformed encodings, shapes and versions before opening IDB', async () => {
  const { store, indexedDB } = fixture();
  const envelope = await store.seal('synthetic-secret');
  const malformed = [null, [], {}, { ...envelope, version: 2 }, { ...envelope, algorithm: 'AES-CBC' },
    { ...envelope, extra: 'anything' }, { ...envelope, iv: '' }, { ...envelope, iv: envelope.iv + '=' },
    { ...envelope, iv: Buffer.alloc(11).toString('base64') }, { ...envelope, ciphertext: Buffer.alloc(16).toString('base64') },
    { ...envelope, ciphertext: 'x'.repeat(10000) }, { ...envelope, ciphertext: 'AB==' },
    { ...envelope, ciphertext: envelope.ciphertext.replace(/.$/, '!') }];
  const opens = indexedDB.state.opens;
  for (const value of malformed) {
    assert.equal(store.isEnvelope(value), false);
    await assert.rejects(KeyStore.create({ indexedDB, crypto: webcrypto }).open(value), safeFailure);
  }
  assert.equal(indexedDB.state.opens, opens);
  assert.equal(store.envelopePresent(undefined), false);
  for (const value of [null, '', false, {}, envelope]) assert.equal(store.envelopePresent(value), true);
});

test('opening ciphertext with a missing durable Key fails without generating or writing a replacement', async () => {
  const original = fixture();
  const envelope = await original.store.seal('synthetic-secret');
  const missing = fixture();
  await assert.rejects(missing.store.open(envelope), safeFailure);
  assert.equal(missing.crypto.calls.generate, 0);
  assert.equal(missing.crypto.calls.encrypt, 0);
  assert.equal(missing.indexedDB.state.records.size, 0);
  assert.equal(missing.indexedDB.state.puts, 0);
});

test('ciphertext and IV tampering fail authentication without exposing decrypted text', async () => {
  const { store } = fixture();
  const envelope = await store.seal('synthetic-private-secret');
  for (const value of [{ ...envelope, ciphertext: alterBase64(envelope.ciphertext) }, { ...envelope, iv: alterBase64(envelope.iv) }]) {
    assert.equal(store.isEnvelope(value), true);
    await assert.rejects(store.open(value), safeFailure);
  }
});

test('authenticated purpose binds the cipher to SuperX Key storage', async () => {
  const { store, indexedDB } = fixture();
  const envelope = await store.seal('synthetic-secret');
  const key = indexedDB.state.records.get(RECORD), iv = Buffer.from(envelope.iv, 'base64');
  const cipher = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('a different purpose'), tagLength: 128 }, key, new TextEncoder().encode('synthetic-secret'));
  await assert.rejects(store.open({ ...envelope, ciphertext: Buffer.from(cipher).toString('base64') }), safeFailure);
});

test('invalid persisted CryptoKeys fail closed during restore and repair only after an explicit save', async () => {
  const original = fixture(), oldEnvelope = await original.store.seal('synthetic-old-key');
  for (const invalid of [null, {}, await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']),
    await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']),
    await webcrypto.subtle.generateKey({ name: 'AES-CBC', length: 256 }, false, ['encrypt', 'decrypt'])]) {
    const { store, indexedDB, crypto } = fixture();
    indexedDB.state.exists = true; indexedDB.state.records.set(RECORD, invalid);
    await assert.rejects(store.open(oldEnvelope), safeFailure);
    assert.equal(crypto.calls.generate, 0);
    assert.equal(indexedDB.state.puts, 0);
    assert.equal(indexedDB.state.records.has(RECORD), true);
    const replacement = await store.seal('synthetic-reentered-key');
    assert.equal(await store.open(replacement), 'synthetic-reentered-key');
    assert.equal(crypto.calls.generate, 1);
    assert.equal(indexedDB.state.puts, 1);
    assert.equal(indexedDB.state.records.get(RECORD).extractable, false);
    await assert.rejects(store.open(oldEnvelope), safeFailure);
  }
});

test('seal awaits durable writer completion rather than resolving after put request success', async () => {
  const { store, indexedDB } = fixture();
  indexedDB.state.holdWrites = true;
  let settled = false;
  const sealing = store.seal('synthetic-secret').finally(() => { settled = true; });
  await until(() => indexedDB.state.heldCommits.length === 1, 'held writer commit');
  assert.equal(indexedDB.state.puts, 1);
  assert.equal(indexedDB.state.records.size, 0);
  assert.equal(settled, false);
  indexedDB.state.heldCommits.shift()();
  const envelope = await sealing;
  assert.equal(await store.open(envelope), 'synthetic-secret');
  assert.deepEqual(indexedDB.state.strictWrites, ['strict']);
});

test('transaction abort after successful put produces no usable envelope or persisted Key', async () => {
  const { store, indexedDB } = fixture();
  indexedDB.state.abortNextWrite = true;
  await assert.rejects(store.seal('synthetic-secret'), safeFailure);
  assert.equal(indexedDB.state.puts, 1);
  assert.equal(indexedDB.state.records.size, 0);
  assert.equal(indexedDB.state.aborted, 1);
});

test('request failure is sanitized and a later storage retry succeeds', async () => {
  const { store, indexedDB } = fixture();
  indexedDB.state.failNextPut = true;
  await assert.rejects(store.seal('synthetic-secret'), safeFailure);
  assert.equal(indexedDB.state.records.size, 0);
  const envelope = await store.seal('synthetic-retry');
  indexedDB.state.failNextGet = true;
  await assert.rejects(store.open(envelope), safeFailure);
  assert.equal(await store.open(envelope), 'synthetic-retry');
});

test('blocked database opening fails promptly, closes any later connection, and can retry', async () => {
  const { store, indexedDB } = fixture();
  indexedDB.state.exists = true;
  indexedDB.state.openModes.push('blocked');
  await assert.rejects(store.seal('synthetic-secret'), safeFailure);
  indexedDB.state.lateOpens.shift()();
  assert.equal(indexedDB.state.connections[0].closed, true);
  assert.equal(indexedDB.state.records.size, 0);
  const envelope = await store.seal('synthetic-retry');
  assert.equal(await store.open(envelope), 'synthetic-retry');
});

test('database open errors and timeouts contain no underlying storage details or Key', async () => {
  for (const mode of ['error', 'hang']) {
    const { store, indexedDB } = fixture({ timeoutMs: 10 });
    indexedDB.state.openModes.push(mode);
    await assert.rejects(store.seal('synthetic-private-secret'), safeFailure);
    if (mode === 'hang') {
      indexedDB.state.lateOpens.shift()();
      assert.equal(indexedDB.state.connections[0].closed, true);
      assert.equal(indexedDB.state.records.size, 0);
    }
  }
});

test('stalled commit times out, aborts its writer, and cannot persist later', async () => {
  const { store, indexedDB } = fixture({ timeoutMs: 10 });
  indexedDB.state.holdWrites = true;
  await assert.rejects(store.seal('synthetic-private-secret'), safeFailure);
  assert.equal(indexedDB.state.aborted, 1);
  for (const commit of indexedDB.state.heldCommits.splice(0)) commit();
  assert.equal(indexedDB.state.records.size, 0);
});

test('clear waits for its durable deletion and old ciphertext no longer opens', async () => {
  const { store, indexedDB, crypto } = fixture();
  const old = await store.seal('synthetic-old-key');
  indexedDB.state.holdWrites = true;
  let settled = false;
  const clearing = store.clear().finally(() => { settled = true; });
  await until(() => indexedDB.state.heldCommits.length === 1, 'held delete commit');
  assert.equal(settled, false);
  assert.equal(indexedDB.state.records.size, 1);
  indexedDB.state.heldCommits.shift()();
  await clearing;
  indexedDB.state.holdWrites = false;
  assert.equal(indexedDB.state.records.size, 0);
  await assert.rejects(store.open(old), safeFailure);
  assert.equal(crypto.calls.generate, 1);
  const replacement = await store.seal('synthetic-new-key');
  assert.equal(crypto.calls.generate, 2);
  await assert.rejects(store.open(old), safeFailure);
  assert.equal(await store.open(replacement), 'synthetic-new-key');
});

test('failed clear preserves the previously committed Key and reports safe failure', async () => {
  const { store, indexedDB } = fixture();
  const envelope = await store.seal('synthetic-secret');
  indexedDB.state.abortNextWrite = true;
  await assert.rejects(store.clear(), safeFailure);
  assert.equal(indexedDB.state.records.size, 1);
  assert.equal(await store.open(envelope), 'synthetic-secret');
});

test('clear on fresh storage deletes no secret and never generates a Key', async () => {
  const { store, indexedDB, crypto } = fixture();
  await store.clear();
  assert.equal(crypto.calls.generate, 0);
  assert.equal(indexedDB.state.records.size, 0);
});

test('simultaneous workers cannot overwrite each other when creating the first durable Key', async () => {
  const indexedDB = memoryIDB(), crypto = instrumentCrypto();
  const first = KeyStore.create({ indexedDB, crypto }), second = KeyStore.create({ indexedDB, crypto });
  const [a, b] = await Promise.all([first.seal('synthetic-first-key'), second.seal('synthetic-second-key')]);
  assert.equal(indexedDB.state.records.size, 1);
  assert.equal(indexedDB.state.puts, 1);
  assert.equal(await first.open(a), 'synthetic-first-key');
  assert.equal(await first.open(b), 'synthetic-second-key');
  assert.equal(await second.open(a), 'synthetic-first-key');
});

test('browser versionchange closes stale connection and reopens without discarding durable encryption', async () => {
  const { store, indexedDB, crypto } = fixture();
  const envelope = await store.seal('synthetic-secret');
  indexedDB.state.connections[0].onversionchange();
  assert.equal(indexedDB.state.connections[0].closed, true);
  assert.equal(await store.open(envelope), 'synthetic-secret');
  assert.equal(indexedDB.state.opens, 2);
  assert.equal(crypto.calls.generate, 1);
});

test('durability option falls back only for unsupported option and closed transactions stay fail-closed', async () => {
  const { store, indexedDB } = fixture();
  indexedDB.state.unsupportedDurability = true;
  const envelope = await store.seal('synthetic-secret');
  assert.deepEqual(indexedDB.state.strictWrites, [undefined]);
  indexedDB.state.throwTransaction = true;
  await assert.rejects(store.open(envelope), safeFailure);
});

test('seal checks a decrypt roundtrip before returning a cipher', async () => {
  const crypto = instrumentCrypto({ decrypt: async () => new TextEncoder().encode('synthetic-wrong-key').buffer });
  const { store } = fixture({ crypto });
  await assert.rejects(store.seal('synthetic-expected-key'), safeFailure);
  assert.equal(crypto.calls.encrypt, 1);
  assert.equal(crypto.calls.decrypt, 1);
});

test('missing cryptography support fails safely before attempting persistence', async () => {
  const indexedDB = memoryIDB();
  const store = KeyStore.create({ indexedDB, crypto: {} });
  await assert.rejects(store.seal('synthetic-private-key'), safeFailure);
  assert.equal(indexedDB.state.opens, 0);
  assert.equal(indexedDB.state.records.size, 0);
});

test('browser global and CommonJS API expose the same password-free operations', () => {
  assert.equal(globalThis.SuperXKeyStore, KeyStore);
  assert.equal(typeof KeyStore.create, 'function');
  assert.deepEqual(Object.keys(KeyStore.create({ indexedDB: memoryIDB(), crypto: webcrypto })).sort(), ['clear', 'envelopePresent', 'isEnvelope', 'open', 'seal']);
  assert.equal('lock' in KeyStore, false);
  assert.equal('unlock' in KeyStore, false);
});
