(function (root) {
  'use strict';
  const DATABASE = 'superx-key-store';
  const DATABASE_VERSION = 1;
  const STORE = 'keys';
  const RECORD = 'api-key-aes-gcm-v1';
  const CONTEXT = 'SuperX API Key storage/v1 AES-256-GCM';
  const MAX_KEY_LENGTH = 500;
  const MAX_CIPHERTEXT_BYTES = MAX_KEY_LENGTH * 3 + 16;
  const DEFAULT_TIMEOUT = 10000;

  function unavailable() {
    const error = new Error('API Key storage is unavailable.');
    error.code = 'KEY_STORE_UNAVAILABLE';
    return error;
  }
  function invalidKey() {
    const error = new Error('Invalid API Key.');
    error.code = 'KEY_STORE_INVALID_KEY';
    return error;
  }
  function validRaw(value, maxLength = MAX_KEY_LENGTH) {
    return typeof value === 'string' && value.length <= maxLength && Boolean(value.trim()) && !/[\r\n]/.test(value);
  }
  function bytesToBase64(bytes) {
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return root.btoa(text);
  }
  function base64ToBytes(text, maxLength) {
    if (typeof text !== 'string' || !text.length || text.length > Math.ceil(maxLength / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw unavailable();
    const raw = root.atob(text);
    const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
    if (bytes.length > maxLength || bytesToBase64(bytes) !== text) throw unavailable();
    return bytes;
  }
  function isEnvelope(value, maxCiphertextBytes = MAX_CIPHERTEXT_BYTES) {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4 ||
        !['version', 'algorithm', 'iv', 'ciphertext'].every(key => Object.hasOwn(value, key)) ||
        value.version !== 1 || value.algorithm !== 'AES-GCM') return false;
      const iv = base64ToBytes(value.iv, 12);
      const ciphertext = base64ToBytes(value.ciphertext, maxCiphertextBytes);
      return iv.length === 12 && ciphertext.length >= 17;
    } catch { return false; }
  }
  function envelopePresent(value) { return value !== undefined; }
  function validCryptoKey(key) {
    return key && Object.prototype.toString.call(key) === '[object CryptoKey]' &&
      key.type === 'secret' && key.extractable === false && key.algorithm?.name === 'AES-GCM' && key.algorithm.length === 256 &&
      Array.isArray(key.usages) && key.usages.length === 2 && key.usages.includes('encrypt') && key.usages.includes('decrypt');
  }

  function create(options = {}) {
    const oauth = options.purpose === 'oauth-refresh';
    const record = oauth ? 'oauth-refresh-aes-gcm-v1' : options.purpose === 'build-connection' ? 'build-connection-aes-gcm-v1' : RECORD;
    const context = oauth ? 'SuperX OAuth refresh token storage/v1 AES-256-GCM' : options.purpose === 'build-connection' ? 'SuperX local connection storage/v1 AES-256-GCM' : CONTEXT;
    const maxLength = oauth ? 16384 : MAX_KEY_LENGTH, maxCiphertextBytes = maxLength * 3 + 16;
    const validEnvelope = value => isEnvelope(value, maxCiphertextBytes);
    const idb = options.indexedDB || root.indexedDB;
    const crypto = options.crypto || root.crypto;
    const setTimer = options.setTimeout || root.setTimeout.bind(root);
    const clearTimer = options.clearTimeout || root.clearTimeout.bind(root);
    const timeout = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT;
    let database = null, opening = null, operations = Promise.resolve();

    function serialize(work) {
      const operation = operations.then(work, work);
      operations = operation.then(() => undefined, () => undefined);
      return operation;
    }
    function getDatabase() {
      if (database) return Promise.resolve(database);
      if (opening) return opening;
      const operation = new Promise((resolve, reject) => {
        let request, settled = false;
        const timer = setTimer(() => finish(false), timeout);
        function finish(ok, value) {
          if (settled) return;
          settled = true;
          clearTimer(timer);
          if (ok) resolve(value); else reject(unavailable());
        }
        try {
          if (!idb || !crypto?.subtle || typeof crypto.getRandomValues !== 'function') throw unavailable();
          request = idb.open(DATABASE, DATABASE_VERSION);
          request.onupgradeneeded = () => {
            if (settled) {
              try { request.transaction.abort(); } catch { /* The obsolete open must not create a usable store. */ }
              return;
            }
            try {
              if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
            } catch {
              try { request.transaction.abort(); } catch { /* Reject below even if the upgrade already ended. */ }
              finish(false);
            }
          };
          request.onerror = () => finish(false);
          request.onblocked = () => finish(false);
          request.onsuccess = () => {
            const connection = request.result;
            if (settled) { connection.close(); return; }
            if (!connection.objectStoreNames.contains(STORE)) { connection.close(); finish(false); return; }
            database = connection;
            connection.onversionchange = () => { connection.close(); if (database === connection) database = null; };
            connection.onclose = () => { if (database === connection) database = null; };
            finish(true, connection);
          };
        } catch { finish(false); }
      });
      opening = operation;
      operation.then(() => { if (opening === operation) opening = null; }, () => { if (opening === operation) opening = null; });
      return operation;
    }
    async function transaction(mode, work) {
      const connection = await getDatabase();
      return new Promise((resolve, reject) => {
        let tx, result, settled = false;
        const timer = setTimer(() => fail(), timeout);
        function finish(ok) {
          if (settled) return;
          settled = true;
          clearTimer(timer);
          if (ok) resolve(result); else reject(unavailable());
        }
        function fail() {
          try { tx?.abort(); } catch { /* Abort may already have completed. */ }
          finish(false);
        }
        try {
          // Strict durability waits for the browser's backing-store commit.
          // Older implementations can omit this optional transaction hint.
          try { tx = mode === 'readwrite' ? connection.transaction(STORE, mode, { durability: 'strict' }) : connection.transaction(STORE, mode); }
          catch (error) { if (error?.name !== 'TypeError') throw error; tx = connection.transaction(STORE, mode); }
          tx.oncomplete = () => finish(true);
          tx.onabort = () => finish(false);
          tx.onerror = () => fail();
          const store = tx.objectStore(STORE);
          const request = (value, receive) => {
            value.onerror = () => fail();
            value.onsuccess = () => {
              if (settled) return;
              try { receive(value.result); } catch { fail(); }
            };
          };
          work(store, request, value => { result = value; });
        } catch { fail(); }
      });
    }
    async function readKey(allowRepair = false) {
      const key = await transaction('readonly', (store, request, result) => request(store.get(record), result));
      if (key === undefined) return null;
      if (!validCryptoKey(key)) { if (allowRepair) return null; throw unavailable(); }
      return key;
    }
    async function keyForSealing() {
      // Saving an explicitly supplied replacement can repair a corrupt key
      // record. Restoring a saved cipher never creates or replaces its Key.
      const existing = await readKey(true);
      if (existing) return existing;
      const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      if (!validCryptoKey(candidate)) throw unavailable();
      // Re-read inside the writer transaction: another worker may have stored a
      // Key between the first read and generation. Never overwrite that Key.
      const committed = await transaction('readwrite', (store, request, result) => {
        request(store.get(record), stored => {
          if (validCryptoKey(stored)) {
            result(stored);
          } else request(store.put(candidate, record), () => result(candidate));
        });
      });
      // Read the structured-cloned durable record, not merely the generated
      // object. Serialization/commit failures must not produce a saved cipher.
      const durable = await readKey();
      if (!durable || !committed) throw unavailable();
      return durable;
    }
    async function decrypt(envelope, key) {
      if (!validEnvelope(envelope) || !validCryptoKey(key)) throw unavailable();
      const iv = base64ToBytes(envelope.iv, 12);
      const ciphertext = base64ToBytes(envelope.ciphertext, maxCiphertextBytes);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context), tagLength: 128 }, key, ciphertext);
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
      if (!validRaw(raw, maxLength) || raw !== raw.trim()) throw unavailable();
      return raw;
    }
    function seal(apiKey) {
      if (!validRaw(apiKey, maxLength)) return Promise.reject(invalidKey());
      const raw = apiKey.trim();
      return serialize(async () => {
        try {
          const key = await keyForSealing();
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context), tagLength: 128 }, key, new TextEncoder().encode(raw));
          const envelope = { version: 1, algorithm: 'AES-GCM', iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
          if (await decrypt(envelope, key) !== raw) throw unavailable();
          return envelope;
        } catch { throw unavailable(); }
      });
    }
    function open(envelope) {
      return serialize(async () => {
        try {
          if (!validEnvelope(envelope)) throw unavailable();
          const key = await readKey();
          if (!key) throw unavailable();
          return await decrypt(envelope, key);
        } catch { throw unavailable(); }
      });
    }
    function clear() {
      return serialize(async () => {
        try { await transaction('readwrite', (store, request) => request(store.delete(record), () => {})); }
        catch { throw unavailable(); }
      });
    }
    return Object.freeze({ seal, open, clear, isEnvelope:validEnvelope, envelopePresent });
  }
  const api = Object.freeze({ ...create(), create });
  root.SuperXKeyStore = api;
  root.SuperXBuildConnectionStore = create({purpose:'build-connection'});
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
