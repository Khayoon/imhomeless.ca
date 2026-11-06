/* Browser-local personal tools. No network requests, analytics, or dependencies. */
(function (host) {
  'use strict';
  const VERSION = 2;
  const ITERATIONS = 600000;
  const MAX_MODEL_BYTES = 20 * 1024 * 1024;
  // Base64 expands the largest accepted model by approximately one third.
  const MAX_ENCRYPTED_BASE64 = 32 * 1024 * 1024;
  const LEGACY_KEYS = ['imh_journal', 'imh_goals', 'imh_rems'];
  const TERMS = ['Today', 'This week', 'This month', 'Long term'];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const copy = value => JSON.parse(JSON.stringify(value));
  const empty = () => ({ version: VERSION, entries: [], goals: [], reminders: [] });
  const id = () => host.crypto && host.crypto.randomUUID ? host.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) < '1900') return false;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }
  function validateModel(value) {
    if (!isObject(value) || value.version !== VERSION) throw Error('Invalid file format');
    const result = empty();
    const seen = new Set();
    for (const group of ['entries', 'goals', 'reminders']) {
      if (!Array.isArray(value[group]) || value[group].length > 10000) throw Error('Invalid records');
      result[group] = value[group].map(item => {
        if (!isObject(item) || typeof item.id !== 'string' || !item.id || item.id.length > 120 || seen.has(item.id)) throw Error('Invalid or duplicate record ID');
        seen.add(item.id);
        if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > (group === 'entries' ? 20000 : 2000)) throw Error('Invalid record text');
        const record = { id: item.id, text: item.text };
        if (group === 'entries') {
          if (!Number.isSafeInteger(item.t) || item.t < 0 || item.t > 8640000000000000) throw Error('Invalid entry date');
          record.t = item.t;
        } else if (group === 'goals') {
          if (!TERMS.includes(item.term) || typeof item.done !== 'boolean') throw Error('Invalid goal');
          record.term = item.term; record.done = item.done;
        } else {
          if (!validDate(item.date)) throw Error('Invalid reminder date');
          record.date = item.date;
        }
        return record;
      });
    }
    if (encoder.encode(JSON.stringify(result)).byteLength > MAX_MODEL_BYTES) throw Error('Personal records exceed the supported backup size');
    return result;
  }
  function legacyModel(storage) {
    const model = empty();
    let found = false;
    const snapshots = {};
    LEGACY_KEYS.forEach((key, index) => {
      const raw = storage.getItem(key);
      if (raw === null) return;
      found = true;
      snapshots[key] = raw;
      const values = JSON.parse(raw);
      if (!Array.isArray(values)) throw Error('Invalid old records');
      const group = ['entries', 'goals', 'reminders'][index];
      model[group] = values.map((value, n) => ({ ...value, id: 'legacy-' + group + '-' + n }));
    });
    return { found, model: validateModel(model), snapshots };
  }
  function sortGoals(goals) {
    return goals.slice().sort((a, b) => Number(a.done) - Number(b.done) || (TERMS.indexOf(a.term) < 0 ? 9 : TERMS.indexOf(a.term)) - (TERMS.indexOf(b.term) < 0 ? 9 : TERMS.indexOf(b.term)));
  }
  function localDate(now = new Date()) {
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  function splitReminders(reminders, today = localDate()) {
    const upcoming = [], past = [];
    reminders.forEach(value => (value.date < today ? past : upcoming).push(value));
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
    past.sort((a, b) => b.date.localeCompare(a.date));
    return { upcoming, past };
  }
  function escapeICS(value) {
    return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  }
  function foldICS(line) {
    let output = '', current = '', bytes = 0;
    for (const char of line) {
      const size = encoder.encode(char).length;
      if (bytes + size > 75) { output += current + '\r\n'; current = ' '; bytes = 1; }
      current += char; bytes += size;
    }
    return output + current;
  }
  function calendar(reminders, now = new Date()) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//imhomeless.ca//Personal reminders//EN', 'CALSCALE:GREGORIAN'];
    reminders.forEach(reminder => {
      if (!validDate(reminder.date)) throw Error('Invalid date');
      const end = new Date(reminder.date + 'T00:00:00Z');
      end.setUTCDate(end.getUTCDate() + 1);
      const uid = toBase64(encoder.encode(reminder.id)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      lines.push('BEGIN:VEVENT', 'UID:' + uid + '@imhomeless.ca', 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + reminder.date.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + end.toISOString().slice(0, 10).replace(/-/g, ''),
        'SUMMARY:' + escapeICS(reminder.text), 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1D', 'DESCRIPTION:' + escapeICS(reminder.text), 'END:VALARM', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(foldICS).join('\r\n') + '\r\n';
  }
  function toBase64(bytes) {
    let binary = '';
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  function fromBase64(text) {
    if (typeof text !== 'string' || text.length > MAX_ENCRYPTED_BASE64) throw Error('Invalid encrypted file');
    return Uint8Array.from(atob(text), char => char.charCodeAt(0));
  }
  async function deriveKey(passphrase, salt, iterations = ITERATIONS, cryptoAPI = host.crypto) {
    if (!cryptoAPI || !cryptoAPI.subtle) throw Error('Encryption unavailable');
    const material = await cryptoAPI.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return cryptoAPI.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(model, key, salt, cryptoAPI = host.crypto) {
    const iv = cryptoAPI.getRandomValues(new Uint8Array(12));
    const cipher = await cryptoAPI.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('imh-personal-v2') }, key, encoder.encode(JSON.stringify(validateModel(model))));
    return validateEnvelope({ version: VERSION, mode: 'encrypted', iterations: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), cipher: toBase64(cipher) });
  }
  function validateEnvelope(envelope) {
    if (!isObject(envelope) || envelope.version !== VERSION || envelope.mode !== 'encrypted' || envelope.iterations !== ITERATIONS || fromBase64(envelope.salt).length !== 16 || fromBase64(envelope.iv).length !== 12 || fromBase64(envelope.cipher).length < 16) throw Error('Invalid encrypted records');
    return envelope;
  }
  async function unseal(envelope, passphrase, cryptoAPI = host.crypto) {
    validateEnvelope(envelope);
    const salt = fromBase64(envelope.salt);
    const key = await deriveKey(passphrase, salt, envelope.iterations, cryptoAPI);
    const plain = await cryptoAPI.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv), additionalData: encoder.encode('imh-personal-v2') }, key, fromBase64(envelope.cipher));
    return { model: validateModel(JSON.parse(decoder.decode(plain))), key, salt };
  }
  class DataStore {
    constructor(storage, key, cryptoAPI = host.crypto) {
      this.storage = storage; this.storageKey = key; this.crypto = cryptoAPI;
      this.model = empty(); this.mode = 'session'; this.key = null; this.salt = null;
      this.envelope = null; this.locked = false; this.blocked = false; this.epoch = 0; this.legacy = false; this.legacySnapshots = {}; this.lastRaw = null; this.invalidated = false;
    }
    load() {
      try {
        const raw = this.storage.getItem(this.storageKey);
        this.lastRaw = raw;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.mode === 'encrypted') {
            this.envelope = validateEnvelope(parsed); this.mode = 'encrypted'; this.locked = true; this.model = null;
          } else if (parsed.mode === 'plain' && parsed.version === VERSION) {
            this.model = validateModel(parsed.data); this.mode = 'plain';
          } else throw Error('Invalid saved records');
        } else {
          const legacy = legacyModel(this.storage);
          this.model = legacy.model; this.legacy = legacy.found; this.legacySnapshots = legacy.snapshots; this.mode = legacy.found ? 'plain' : 'session';
        }
        return true;
      } catch (error) { this.blocked = true; this.mode = 'unavailable'; this.model = null; return false; }
    }
    writeVerified(value) {
      const raw = JSON.stringify(value);
      if (this.storage.getItem(this.storageKey) !== this.lastRaw) {
        this.invalidate(); const error = Error('Records changed in another tab; reload before saving'); error.code = 'STALE'; throw error;
      }
      this.storage.setItem(this.storageKey, raw);
      if (this.storage.getItem(this.storageKey) !== raw) throw Error('Could not verify saved records');
      this.lastRaw = raw;
    }
    cleanupLegacy() {
      // Do not erase an old record that another open copy changed since we read it.
      for (const key of Object.keys(this.legacySnapshots)) {
        const current = this.storage.getItem(key);
        if (current !== null && current !== this.legacySnapshots[key]) throw Error('Old records changed; retained for recovery');
      }
      for (const key of Object.keys(this.legacySnapshots)) this.storage.removeItem(key);
      for (const key of Object.keys(this.legacySnapshots)) if (this.storage.getItem(key) !== null) throw Error('Old copies remain');
      this.legacy = false;
      this.legacySnapshots = {};
    }
    async commit(next) {
      if (this.locked || this.blocked || !this.model) throw Error('Locked');
      const model = validateModel(next), epoch = this.epoch;
      if (this.mode === 'encrypted') {
        const envelope = await seal(model, this.key, this.salt, this.crypto);
        this.writeVerified(envelope); this.envelope = envelope;
      } else if (this.mode === 'plain') this.writeVerified({ version: VERSION, mode: 'plain', data: model });
      if (epoch === this.epoch && !this.locked) this.model = model;
      // Once the complete new record is safely stored, old keys can be removed.
      if (this.mode !== 'session' && this.legacy) this.cleanupLegacy();
      return true;
    }
    useSession() {
      if (this.locked) throw Error('Locked');
      this.model = this.model || empty(); this.mode = 'session'; this.blocked = false; this.invalidated = false; this.key = null; this.salt = null;
    }
    saveOnDevice() {
      if (this.locked || this.blocked || !this.model) throw Error('Locked');
      this.writeVerified({ version: VERSION, mode: 'plain', data: this.model });
      this.mode = 'plain'; this.key = null; this.salt = null; this.envelope = null;
      if (this.legacy) this.cleanupLegacy();
    }
    async encrypt(passphrase) {
      if (this.locked || this.blocked || !this.model || passphrase.length < 8) throw Error('Passphrase must contain at least 8 characters');
      const epoch = this.epoch;
      const salt = this.crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(passphrase, salt, ITERATIONS, this.crypto);
      const envelope = await seal(this.model, key, salt, this.crypto);
      // Authenticate a round trip before replacing any plaintext records.
      await unseal(envelope, passphrase, this.crypto);
      if (epoch !== this.epoch || this.locked) throw Error('Locked');
      this.writeVerified(envelope);
      this.key = key; this.salt = salt; this.envelope = envelope; this.mode = 'encrypted';
      if (this.legacy) this.cleanupLegacy();
      // Unmigrated old records belong to an earlier copy. Never delete them silently.
      for (const legacyKey of LEGACY_KEYS) if (this.storage.getItem(legacyKey) !== null) throw Error('Unmigrated old records remain');
    }
    async unlock(passphrase) {
      const epoch = this.epoch;
      const result = await unseal(this.envelope, passphrase, this.crypto);
      if (epoch !== this.epoch) throw Error('Locked');
      this.key = result.key; this.salt = result.salt; this.model = result.model; this.locked = false; this.blocked = false;
    }
    lock() {
      this.epoch++;
      if (this.mode === 'encrypted') { this.key = null; this.salt = null; this.model = null; this.locked = true; }
    }
    invalidate() {
      this.epoch++; this.model = null; this.key = null; this.salt = null; this.envelope = null;
      this.mode = 'unavailable'; this.locked = false; this.blocked = true; this.invalidated = true;
    }
    externalChange(changedKey) {
      if (changedKey !== null && changedKey !== this.storageKey && !Object.prototype.hasOwnProperty.call(this.legacySnapshots, changedKey)) return false;
      this.invalidate(); return true;
    }
    clear() {
      // Try every owned key, and discard decrypted memory even if disk deletion fails.
      let failed = false;
      for (const key of [this.storageKey, ...Object.keys(this.legacySnapshots)]) {
        try {
          const expected = key === this.storageKey ? this.lastRaw : this.legacySnapshots[key];
          const current = this.storage.getItem(key);
          if (current === null) continue;
          // A different tab may have saved data after this copy last read it.
          if (current !== expected) { failed = true; continue; }
          this.storage.removeItem(key); if (this.storage.getItem(key) !== null) failed = true;
        }
        catch (error) { failed = true; }
      }
      this.epoch++; this.model = empty(); this.mode = 'session'; this.key = null; this.salt = null; this.envelope = null;
      this.locked = false; this.blocked = false; this.legacy = false; this.legacySnapshots = {}; this.lastRaw = null; this.invalidated = false;
      if (failed) throw Error('Could not verify deletion');
    }
  }
  const Core = { validateModel, legacyModel, sortGoals, validDate, localDate, splitReminders, calendar, escapeICS, foldICS, deriveKey, seal, unseal, DataStore, empty, ITERATIONS, MAX_MODEL_BYTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  if (!host.document) return;

  const words = {
    en: {
      journal: 'Journal', goals: 'Goals', reminders: 'Reminders', data: 'Data & privacy',
      journalLead: 'Write a thought, a plan, or something you want to remember.', goalsLead: 'Small steps count. Choose one thing to work toward.', remindersLead: 'Keep appointments and deadlines together. This site does not send notifications.',
      privacy: 'Anyone using this browser may be able to read unencrypted records. Avoid sensitive details on a shared device.', privacyLink: 'Choose how your records are saved',
      session: 'Only for this visit: changes are kept in memory and disappear when this page is closed or reloaded. Existing device copies remain until cleared.', plain: 'Saved on this device without encryption. Anyone using this browser can read these records.', encrypted: 'Saved on this device with encryption. Keep your passphrase safe; there is no password recovery.', locked: 'Your encrypted records are locked.', unavailable: 'Saved records could not be read. They have not been overwritten. Try again in your usual browser, or use this visit only.',
      saveFail: 'Could not confirm this change was saved. Your draft is still here. Device storage may be full or unavailable. Try again or choose “Use only this visit” in Data & privacy.', saved: 'Saved on this device.', sessionSaved: 'Kept only for this visit. It will disappear on reload.', deleteSaved: 'Deleted. You can undo below.', invalid: 'Check the fields and try again.',
      externalChange: 'Saved records changed in another tab. Personal records and unsaved drafts have been hidden and cleared from this page to protect your privacy. Reload to load the current saved records. This page cannot overwrite the other tab’s changes.',
      entry: 'New entry', saveEntry: 'Save entry', editEntry: 'Save changes', cancelEdit: 'Cancel editing', yourEntries: 'Your entries', noEntries: 'No entries yet. One line is enough to start.',
      goal: 'What do you want to work toward?', timeframe: 'Timeframe', addGoal: 'Add goal', noGoals: 'No goals yet. Try one small step for today.', done: 'done', markDone: 'Mark done', markUndone: 'Mark not done',
      reminder: 'What do you need to remember?', date: 'Date', addReminder: 'Add reminder', upcoming: 'Upcoming', past: 'Past reminders', noReminders: 'No upcoming reminders.', noPast: 'No past reminders.', calendar: 'Add to calendar', exportCalendar: 'Download all reminders as calendar', calendarNote: 'The download adds all-day events with a reminder one day before. Open the .ics file in your calendar and check its alert settings. Your calendar app handles alerts; this site cannot guarantee them.',
      edit: 'Edit', delete: 'Delete', undo: 'Undo last delete', undoNote: 'Undo is available during this visit, until records are locked or cleared.',
      dataLead: 'Your journal, goals, and reminders stay in this browser. They are not sent to a server. Resource websites and phone or text apps have their own privacy policies.',
      chooseStorage: 'Choose where to keep records', useSession: 'Use only this visit', saveDevice: 'Save current records on this device', sessionNote: 'Changing to “only this visit” does not erase existing saved copies. Use Clear personal records if this is a shared device.',
      encryption: 'Protect saved records', passphrase: 'Passphrase or PIN (at least 8 characters)', confirmPassphrase: 'Repeat passphrase or PIN', encrypt: 'Encrypt current records', encryptionNote: 'Use a long, unique passphrase. An 8-digit PIN is allowed but easier to guess. Encryption protects saved records, not an unlocked screen, a monitored device, downloads, or browser extensions. Records lock when this tab is hidden. Unsaved drafts are discarded when locking.', encryptUnavailable: 'Encryption is unavailable in this browser. Use only this visit on a shared device.', encryptFail: 'Encryption could not be completed. Do not assume your records are protected. Existing copies may remain. Export a backup if safe, then clear personal records on a shared device.', encryptedSaved: 'Records encrypted. Old unencrypted app records were removed.', passMismatch: 'The passphrases do not match.', lock: 'Lock records now', unlock: 'Unlock records', unlockFail: 'Could not unlock these records. Check your passphrase. Nothing has been changed.', unlockLink: 'Unlock in Data & privacy', unlocked: 'Records unlocked.',
      backup: 'Back up or print', backupNote: 'Exports and printouts contain readable personal information. Save them only somewhere safe. Browser data may be cleared by the browser, the device owner, or storage pressure. A backup can help if a phone is lost.', export: 'Download personal records (.json)', print: 'Print personal records', import: 'Restore a backup', importLabel: 'Choose a .json backup (up to 20 MiB)', importNote: 'Restoring replaces the current journal, goals, and reminders. Export your current records first if you need to keep them.', restore: 'Replace current records with this backup', importReady: 'Backup ready to restore:', importFail: 'This file is not a supported backup. Current records have not been changed.', restored: 'Backup restored.',
      clear: 'Clear personal records', clearNote: 'Permanently removes this copy’s saved journal, goals, reminders, and encrypted vault, including older app records loaded by this copy. It does not erase downloads, printouts, browser history, or records belonging to another copy.', clearConfirm: 'I understand this permanently deletes the personal records saved by this copy.', clearButton: 'Delete personal records from this browser', clearSuccess: 'This copy’s personal records were removed from this browser. Check other copies, downloads, and printouts separately.', clearFail: 'Could not confirm that every saved record was deleted. Another tab may have changed them. Reload to check, or use your browser’s site-data controls before leaving a shared device.',
      lockedForm: 'Unlock saved records to read or change them.', sessionFromError: 'Start an empty session for this visit', currentCounts: 'entries / goals / reminders', newEntryLabel: 'Write an entry', newGoalLabel: 'Add a goal', newReminderLabel: 'Add a reminder'
    },
    fr: {
      journal: 'Journal', goals: 'Objectifs', reminders: 'Rappels', data: 'Données et confidentialité',
      journalLead: 'Notez une pensée, un projet ou une chose à retenir.', goalsLead: 'Chaque petit pas compte. Choisissez un objectif.', remindersLead: 'Gardez vos rendez-vous et vos échéances ensemble. Ce site n’envoie pas de notifications.',
      privacy: 'Toute personne utilisant ce navigateur peut lire les données non chiffrées. Évitez les renseignements sensibles sur un appareil partagé.', privacyLink: 'Choisir comment conserver vos données',
      session: 'Pour cette visite seulement : les changements restent en mémoire et disparaissent si vous fermez ou rechargez la page. Les copies déjà enregistrées restent jusqu’à leur suppression.', plain: 'Enregistré sur cet appareil sans chiffrement. Toute personne utilisant ce navigateur peut lire ces données.', encrypted: 'Enregistré sur cet appareil avec chiffrement. Gardez votre phrase secrète : il n’y a pas de récupération du mot de passe.', locked: 'Vos données chiffrées sont verrouillées.', unavailable: 'Impossible de lire les données enregistrées. Elles n’ont pas été remplacées. Réessayez dans votre navigateur habituel ou utilisez cette visite seulement.',
      saveFail: 'Impossible de confirmer l’enregistrement. Votre brouillon est toujours ici. Le stockage est peut-être plein ou inaccessible. Réessayez ou choisissez « Pour cette visite seulement » dans Données et confidentialité.', saved: 'Enregistré sur cet appareil.', sessionSaved: 'Conservé pour cette visite seulement. Disparaîtra au rechargement.', deleteSaved: 'Supprimé. Vous pouvez annuler ci-dessous.', invalid: 'Vérifiez les champs et réessayez.',
      externalChange: 'Les données enregistrées ont changé dans un autre onglet. Les données personnelles et les brouillons ont été masqués et effacés de cette page pour protéger votre confidentialité. Rechargez la page pour lire les données actuelles. Cette page ne peut pas remplacer les changements de l’autre onglet.',
      entry: 'Nouvelle note', saveEntry: 'Enregistrer la note', editEntry: 'Enregistrer les changements', cancelEdit: 'Annuler la modification', yourEntries: 'Vos notes', noEntries: 'Aucune note. Une seule ligne suffit pour commencer.',
      goal: 'Quel est votre objectif?', timeframe: 'Délai', addGoal: 'Ajouter l’objectif', noGoals: 'Aucun objectif. Essayez un petit pas pour aujourd’hui.', done: 'terminés', markDone: 'Marquer comme terminé', markUndone: 'Marquer comme non terminé',
      reminder: 'Que devez-vous retenir?', date: 'Date', addReminder: 'Ajouter le rappel', upcoming: 'À venir', past: 'Rappels passés', noReminders: 'Aucun rappel à venir.', noPast: 'Aucun rappel passé.', calendar: 'Ajouter au calendrier', exportCalendar: 'Télécharger tous les rappels pour le calendrier', calendarNote: 'Le fichier ajoute des événements d’une journée avec un rappel la veille. Ouvrez le fichier .ics dans votre calendrier et vérifiez ses alertes. Votre calendrier gère les alertes; ce site ne peut pas les garantir.',
      edit: 'Modifier', delete: 'Supprimer', undo: 'Annuler la dernière suppression', undoNote: 'L’annulation reste disponible pendant cette visite, jusqu’au verrouillage ou à l’effacement des données.',
      dataLead: 'Votre journal, vos objectifs et vos rappels restent dans ce navigateur. Ils ne sont pas envoyés à un serveur. Les sites de ressources et les applications de téléphone ou de texto ont leurs propres politiques de confidentialité.',
      chooseStorage: 'Choisir où conserver les données', useSession: 'Pour cette visite seulement', saveDevice: 'Enregistrer les données actuelles sur cet appareil', sessionNote: 'Choisir « Pour cette visite seulement » n’efface pas les copies déjà enregistrées. Utilisez Effacer les données personnelles sur un appareil partagé.',
      encryption: 'Protéger les données enregistrées', passphrase: 'Phrase secrète ou NIP (au moins 8 caractères)', confirmPassphrase: 'Répéter la phrase secrète ou le NIP', encrypt: 'Chiffrer les données actuelles', encryptionNote: 'Utilisez une longue phrase secrète unique. Un NIP de 8 chiffres est permis, mais plus facile à deviner. Le chiffrement ne protège pas un écran déverrouillé, un appareil surveillé, les fichiers téléchargés ou les extensions du navigateur. Les données se verrouillent quand cet onglet est masqué. Les brouillons non enregistrés sont alors effacés.', encryptUnavailable: 'Le chiffrement n’est pas disponible dans ce navigateur. Sur un appareil partagé, utilisez cette visite seulement.', encryptFail: 'Le chiffrement n’a pas pu être terminé. Ne supposez pas que vos données sont protégées. Des copies peuvent rester. Exportez une sauvegarde si cela est sûr, puis effacez les données personnelles sur un appareil partagé.', encryptedSaved: 'Données chiffrées. Les anciennes données non chiffrées de l’application ont été supprimées.', passMismatch: 'Les phrases secrètes ne correspondent pas.', lock: 'Verrouiller les données', unlock: 'Déverrouiller les données', unlockFail: 'Impossible de déverrouiller. Vérifiez votre phrase secrète. Rien n’a été modifié.', unlockLink: 'Déverrouiller dans Données et confidentialité', unlocked: 'Données déverrouillées.',
      backup: 'Sauvegarder ou imprimer', backupNote: 'Les fichiers exportés et les impressions contiennent des renseignements lisibles. Gardez-les en lieu sûr. Le navigateur, le propriétaire de l’appareil ou un manque d’espace peuvent effacer les données. Une sauvegarde peut aider si vous perdez votre téléphone.', export: 'Télécharger les données personnelles (.json)', print: 'Imprimer les données personnelles', import: 'Restaurer une sauvegarde', importLabel: 'Choisir un fichier .json (20 Mio maximum)', importNote: 'La restauration remplace le journal, les objectifs et les rappels actuels. Exportez-les d’abord si vous voulez les conserver.', restore: 'Remplacer les données actuelles par cette sauvegarde', importReady: 'Sauvegarde prête à restaurer :', importFail: 'Ce fichier n’est pas une sauvegarde compatible. Les données actuelles n’ont pas changé.', restored: 'Sauvegarde restaurée.',
      clear: 'Effacer les données personnelles', clearNote: 'Supprime définitivement le journal, les objectifs, les rappels et le coffre chiffré de cette copie, ainsi que les anciennes données chargées par cette copie. N’efface pas les téléchargements, les impressions, l’historique du navigateur ou les données d’une autre copie.', clearConfirm: 'Je comprends que les données personnelles enregistrées par cette copie seront supprimées définitivement.', clearButton: 'Supprimer les données personnelles de ce navigateur', clearSuccess: 'Les données personnelles de cette copie ont été supprimées de ce navigateur. Vérifiez les autres copies, les téléchargements et les impressions.', clearFail: 'Impossible de confirmer la suppression complète. Un autre onglet a peut-être modifié les données. Rechargez la page pour vérifier ou effacez les données du site dans les réglages du navigateur avant de quitter un appareil partagé.',
      lockedForm: 'Déverrouillez les données pour les lire ou les modifier.', sessionFromError: 'Commencer une session vide pour cette visite', currentCounts: 'notes / objectifs / rappels', newEntryLabel: 'Écrire une note', newGoalLabel: 'Ajouter un objectif', newReminderLabel: 'Ajouter un rappel'
    }
  };
  const termWords = { en: TERMS, fr: ['Aujourd’hui', 'Cette semaine', 'Ce mois-ci', 'À long terme'] };
  let language = 'en', store, busy = false, undo = [], editId = null, pendingImport = null, statusKey = '', statusError = false, initialized = false;
  const $ = identifier => document.getElementById(identifier);
  const text = key => words[language][key] || key;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const button = (action, label, extra = '') => '<button type="button" class="btn btn-ghost" data-personal-action="' + action + '" ' + extra + '>' + escape(label) + '</button>';
  const count = model => model.entries.length + ' / ' + model.goals.length + ' / ' + model.reminders.length;
  function message(key, error = false) { statusKey = key; statusError = error; updateStatus(); }
  function updateStatus() {
    document.querySelectorAll('[data-personal-status]').forEach(node => {
      node.hidden = !statusKey;
      node.textContent = text(statusKey || (store.invalidated ? 'externalChange' : store.blocked ? 'unavailable' : store.locked ? 'locked' : store.mode));
      node.classList.toggle('field-error', statusError || store.blocked);
    });
    document.querySelectorAll('[data-personal-mode]').forEach(node => { node.textContent = text(store.invalidated ? 'externalChange' : store.blocked ? 'unavailable' : store.locked ? 'locked' : store.mode); });
  }
  function common() {
    return '<div class="personal-controls"><p>' + escape(text('privacy')) + ' <a href="#data">' + escape(text('privacyLink')) + '</a></p><p data-personal-mode></p><p class="personal-status" data-personal-status role="status" aria-live="polite"></p></div>';
  }
  function lockedContent() { return '<div class="card personal-locked"><p>' + escape(text('lockedForm')) + '</p><a class="btn btn-primary" href="#data">' + escape(text('unlockLink')) + '</a></div>'; }
  function drafts() {
    const values = {};
    ['jText', 'gText', 'gTerm', 'rText', 'rDate'].forEach(key => { if ($(key)) values[key] = $(key).value; });
    return values;
  }
  function restoreDrafts(values) { Object.keys(values).forEach(key => { if ($(key)) $(key).value = values[key]; }); }
  function undoHTML() {
    return undo.length ? '<div class="personal-actions mt">' + button('undo', text('undo')) + '<p>' + escape(text('undoNote')) + '</p></div>' : '';
  }
  function render() {
    if (!store) return;
    const previous = drafts(), available = !store.locked && !store.blocked && !!store.model;
    const journal = $('p-journal'), goals = $('p-goals'), reminders = $('p-reminders'), data = $('p-data');
    if (!journal || !goals || !reminders || !data) return;
    journal.innerHTML = '<h2 id="journal-heading">' + text('journal') + '</h2><p class="lead">' + text('journalLead') + '</p>' + common() + (available ?
      '<form class="card" id="personal-journal-form"><label class="fl" for="jText">' + text('entry') + '</label><textarea id="jText" required maxlength="20000" rows="5"></textarea><div class="personal-actions mt"><button class="btn btn-primary" type="submit">' + text(editId ? 'editEntry' : 'saveEntry') + '</button>' + (editId ? button('cancel-edit', text('cancelEdit')) : '') + '</div></form><h3 class="section-h">' + text('yourEntries') + '</h3><div class="stack" id="entries"></div>' + undoHTML() : lockedContent());
    goals.innerHTML = '<h2 id="goals-heading">' + text('goals') + '</h2><p class="lead">' + text('goalsLead') + '</p>' + common() + (available ?
      '<form class="card" id="personal-goal-form"><label class="fl" for="gText">' + text('goal') + '</label><input type="text" id="gText" required maxlength="2000"><div class="row mt"><div><label class="fl" for="gTerm">' + text('timeframe') + '</label><select id="gTerm">' + TERMS.map((term, index) => '<option value="' + term + '">' + termWords[language][index] + '</option>').join('') + '</select></div><div class="personal-actions"><button class="btn btn-primary" type="submit">' + text('addGoal') + '</button></div></div></form><p id="goalProgress"></p><div class="stack" id="goals"></div>' + undoHTML() : lockedContent());
    reminders.innerHTML = '<h2 id="reminders-heading">' + text('reminders') + '</h2><p class="lead">' + text('remindersLead') + '</p>' + common() + (available ?
      '<form class="card" id="personal-reminder-form"><label class="fl" for="rText">' + text('reminder') + '</label><input type="text" id="rText" required maxlength="2000"><div class="row mt"><div><label class="fl" for="rDate">' + text('date') + '</label><input type="date" id="rDate" required min="1900-01-01" max="9999-12-31"></div><div class="personal-actions"><button class="btn btn-primary" type="submit">' + text('addReminder') + '</button></div></div></form><p class="note mt">' + text('calendarNote') + '</p><div class="personal-actions mt">' + button('calendar-all', text('exportCalendar')) + '</div><h3 class="section-h">' + text('upcoming') + '</h3><div class="stack" id="reminders"></div><details class="mt"><summary>' + text('past') + '</summary><div class="stack mt" id="pastReminders"></div></details>' + undoHTML() : lockedContent());
    let dataContent = '';
    if (store.locked) dataContent = '<form class="card" id="personal-unlock-form"><label class="fl" for="personal-unlock">' + text('passphrase') + '</label><input type="password" id="personal-unlock" required autocomplete="current-password"><button class="btn btn-primary mt" type="submit">' + text('unlock') + '</button></form>';
    else if (store.blocked) dataContent = button('session', text('sessionFromError'));
    else {
      dataContent = '<section class="card mt"><h3>' + text('chooseStorage') + '</h3><p>' + text('sessionNote') + '</p><div class="personal-actions">' + button('session', text('useSession')) + (store.mode !== 'encrypted' ? button('device', text('saveDevice')) : button('lock', text('lock'))) + '</div></section>';
      dataContent += '<section class="card mt"><h3>' + text('encryption') + '</h3><p>' + text('encryptionNote') + '</p>' + (host.crypto && host.crypto.subtle ? '<form id="personal-encrypt-form"><label class="fl" for="personal-passphrase">' + text('passphrase') + '</label><input type="password" id="personal-passphrase" minlength="8" required autocomplete="new-password"><label class="fl mt" for="personal-confirm-passphrase">' + text('confirmPassphrase') + '</label><input type="password" id="personal-confirm-passphrase" minlength="8" required autocomplete="new-password"><button class="btn btn-primary mt" type="submit">' + text('encrypt') + '</button></form>' : '<p>' + text('encryptUnavailable') + '</p>') + '</section>';
      dataContent += '<section class="card mt"><h3>' + text('backup') + '</h3><p>' + text('backupNote') + '</p><div class="personal-actions">' + button('export', text('export')) + button('print', text('print')) + '</div><h3 class="mt">' + text('import') + '</h3><p>' + text('importNote') + '</p><label class="fl" for="personal-import">' + text('importLabel') + '</label><input type="file" id="personal-import" accept=".json,application/json"><div id="personal-import-preview"></div></section>';
    }
    data.innerHTML = '<h2 id="data-heading">' + text('data') + '</h2><p class="lead">' + text('dataLead') + '</p>' + common() + dataContent + '<section class="card mt personal-confirm"><h3>' + text('clear') + '</h3><p>' + text('clearNote') + '</p><label><input type="checkbox" id="personal-clear-check"> ' + text('clearConfirm') + '</label><div class="mt">' + button('clear', text('clearButton'), 'id="personal-clear-button" disabled') + '</div></section>';
    if (available) { renderRecords(); restoreDrafts(previous); }
    updateStatus();
    setBusy(busy);
  }
  function renderRecords() {
    if (!store.model || store.locked || store.blocked) return;
    const locale = language === 'fr' ? 'fr-CA' : 'en-CA';
    $('entries').innerHTML = store.model.entries.slice().sort((a, b) => b.t - a.t).map(entry => {
      const when = new Date(entry.t).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
      return '<article class="entry"><div class="meta"><time datetime="' + new Date(entry.t).toISOString() + '">' + escape(when) + '</time><div class="entry-actions">' + button('edit-entry', text('edit'), 'data-record="' + escape(entry.id) + '" aria-label="' + escape(text('edit') + ': ' + entry.text.slice(0, 80)) + '"') + button('delete-entry', text('delete'), 'data-record="' + escape(entry.id) + '" aria-label="' + escape(text('delete') + ': ' + entry.text.slice(0, 80)) + '"') + '</div></div><p>' + escape(entry.text) + '</p></article>';
    }).join('') || '<p class="empty">' + text('noEntries') + '</p>';
    $('goalProgress').textContent = store.model.goals.filter(value => value.done).length + ' / ' + store.model.goals.length + ' ' + text('done');
    $('goals').innerHTML = sortGoals(store.model.goals).map(goal => '<article class="goal' + (goal.done ? ' done' : '') + '"><button type="button" class="btn btn-ghost" role="checkbox" aria-checked="' + goal.done + '" aria-label="' + escape(text(goal.done ? 'markUndone' : 'markDone') + ': ' + goal.text) + '" data-personal-action="toggle-goal" data-record="' + escape(goal.id) + '">' + (goal.done ? '✓' : '○') + '</button><div class="g-txt"><span>' + termWords[language][TERMS.indexOf(goal.term)] + '</span><b>' + escape(goal.text) + '</b></div>' + button('delete-goal', text('delete'), 'data-record="' + escape(goal.id) + '" aria-label="' + escape(text('delete') + ': ' + goal.text) + '"') + '</article>').join('') || '<p class="empty">' + text('noGoals') + '</p>';
    const groups = splitReminders(store.model.reminders);
    const reminderHTML = reminder => '<article class="rem"><div class="r-txt"><b>' + escape(reminder.text) + '</b><time datetime="' + reminder.date + '">' + new Date(reminder.date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + '</time></div><div class="entry-actions">' + button('calendar-one', text('calendar'), 'data-record="' + escape(reminder.id) + '" aria-label="' + escape(text('calendar') + ': ' + reminder.text) + '"') + button('delete-reminder', text('delete'), 'data-record="' + escape(reminder.id) + '" aria-label="' + escape(text('delete') + ': ' + reminder.text) + '"') + '</div></article>';
    $('reminders').innerHTML = groups.upcoming.map(reminderHTML).join('') || '<p class="empty">' + text('noReminders') + '</p>';
    $('pastReminders').innerHTML = groups.past.map(reminderHTML).join('') || '<p class="empty">' + text('noPast') + '</p>';
  }
  function setBusy(value) {
    busy = value;
    ['p-journal', 'p-goals', 'p-reminders', 'p-data'].forEach(key => {
      const panel = $(key); if (!panel) return;
      panel.setAttribute('aria-busy', String(value));
      panel.querySelectorAll('button,input,textarea,select').forEach(node => { node.disabled = value || node.id === 'personal-clear-button' && !$('personal-clear-check').checked; });
    });
  }
  async function perform(operation, success = 'saved', failure = 'saveFail', after) {
    if (busy) return false;
    setBusy(true);
    try {
      await operation();
      if (after) after();
      if (document.hidden && store.mode === 'encrypted') lock();
      if (success === 'saved' && store.mode === 'session') success = 'sessionSaved';
      message(success); render(); return true;
    } catch (error) {
      if (error.code === 'STALE') { clearEphemeral(); message('externalChange', true); }
      else message(failure, true);
      render(); return false;
    }
    finally { setBusy(false); }
  }
  function download(contents, type, name) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function clearEphemeral() {
    undo = []; editId = null; pendingImport = null;
    // Clear drafts and decrypted DOM before handing the screen to another app.
    ['jText', 'gText', 'rText', 'rDate', 'personal-passphrase', 'personal-confirm-passphrase', 'personal-unlock'].forEach(key => { if ($(key)) $(key).value = ''; });
    const print = $('personal-print'); if (print) print.remove();
  }
  function lock() {
    if (!store) return;
    store.lock(); clearEphemeral(); statusKey = '';
    render();
  }
  function printRecords() {
    const old = $('personal-print'); if (old) old.remove();
    const node = document.createElement('div'); node.id = 'personal-print'; node.hidden = true;
    node.innerHTML = '<h1>' + text('data') + '</h1>' + ['entries', 'goals', 'reminders'].map((group, n) => '<h2>' + text(['journal', 'goals', 'reminders'][n]) + '</h2>' + store.model[group].map(record => '<p>' + escape(record.date || (record.t ? new Date(record.t).toLocaleString(language === 'fr' ? 'fr-CA' : 'en-CA') : termWords[language][TERMS.indexOf(record.term)])) + ': ' + escape(record.text) + '</p>').join('')).join('');
    document.body.appendChild(node); host.print();
    setTimeout(() => node.remove(), 1000);
  }
  async function onSubmit(event) {
    const form = event.target;
    if (!form.id || !form.id.startsWith('personal-')) return;
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    if (form.id === 'personal-encrypt-form') {
      const phrase = $('personal-passphrase').value;
      if (phrase !== $('personal-confirm-passphrase').value) { message('passMismatch', true); return; }
      await perform(() => store.encrypt(phrase), 'encryptedSaved', 'encryptFail', () => { $('personal-passphrase').value = ''; $('personal-confirm-passphrase').value = ''; });
      return;
    }
    if (form.id === 'personal-unlock-form') {
      const phrase = $('personal-unlock').value; $('personal-unlock').value = '';
      await perform(() => store.unlock(phrase), 'unlocked', 'unlockFail'); return;
    }
    if (!store.model || store.locked || store.blocked) return;
    const next = copy(store.model);
    if (form.id === 'personal-journal-form') {
      const value = $('jText').value.trim(); if (!value) { message('invalid', true); return; }
      if (editId) { const item = next.entries.find(entry => entry.id === editId); if (!item) return; item.text = value; }
      else next.entries.unshift({ id: id(), text: value, t: Date.now() });
      await perform(() => store.commit(next), 'saved', 'saveFail', () => { if ($('jText')) $('jText').value = ''; editId = null; });
    } else if (form.id === 'personal-goal-form') {
      const value = $('gText').value.trim(); if (!value) { message('invalid', true); return; }
      next.goals.push({ id: id(), text: value, term: $('gTerm').value, done: false });
      await perform(() => store.commit(next), 'saved', 'saveFail', () => { if ($('gText')) $('gText').value = ''; });
    } else if (form.id === 'personal-reminder-form') {
      const value = $('rText').value.trim(), date = $('rDate').value;
      if (!value || !validDate(date)) { message('invalid', true); return; }
      next.reminders.push({ id: id(), text: value, date });
      await perform(() => store.commit(next), 'saved', 'saveFail', () => { if ($('rText')) $('rText').value = ''; if ($('rDate')) $('rDate').value = ''; });
    }
  }
  async function onClick(event) {
    const node = event.target.closest('[data-personal-action]');
    if (!node || busy) return;
    const action = node.dataset.personalAction, recordId = node.dataset.record;
    if (action === 'lock') { lock(); return; }
    if (action === 'clear') {
      if (!$('personal-clear-check').checked) return;
      undo = []; editId = null; pendingImport = null;
      ['jText', 'gText', 'rText', 'rDate', 'personal-passphrase', 'personal-confirm-passphrase', 'personal-unlock'].forEach(key => { if ($(key)) $(key).value = ''; });
      await perform(() => store.clear(), 'clearSuccess', 'clearFail'); return;
    }
    if (action === 'session') { store.useSession(); statusKey = ''; statusError = false; render(); return; }
    if (store.locked || store.blocked || !store.model) return;
    if (action === 'device') { await perform(() => store.saveOnDevice()); return; }
    if (action === 'export') { download(JSON.stringify(store.model), 'application/json;charset=utf-8', 'personal-records-' + localDate() + '.json'); return; }
    if (action === 'print') { printRecords(); return; }
    if (action === 'calendar-all' || action === 'calendar-one') {
      const values = action === 'calendar-one' ? store.model.reminders.filter(value => value.id === recordId) : store.model.reminders;
      if (values.length) download(calendar(values), 'text/calendar;charset=utf-8', 'reminders.ics'); return;
    }
    if (action === 'restore') {
      if (!pendingImport) return;
      await perform(() => store.commit(pendingImport), 'restored', 'saveFail', () => { undo = []; pendingImport = null; editId = null; }); return;
    }
    if (action === 'cancel-edit') { editId = null; $('jText').value = ''; render(); return; }
    if (action === 'edit-entry') {
      const entry = store.model.entries.find(value => value.id === recordId); if (!entry) return;
      editId = recordId; render(); $('jText').value = entry.text; $('jText').focus(); return;
    }
    const next = copy(store.model);
    if (action === 'toggle-goal') {
      const goal = next.goals.find(value => value.id === recordId); if (!goal) return;
      goal.done = !goal.done; await perform(() => store.commit(next)); return;
    }
    if (action.startsWith('delete-')) {
      const group = ({ 'delete-entry': 'entries', 'delete-goal': 'goals', 'delete-reminder': 'reminders' })[action];
      if (!group) return;
      const index = next[group].findIndex(value => value.id === recordId); if (index < 0) return;
      const item = next[group].splice(index, 1)[0];
      await perform(() => store.commit(next), store.mode === 'session' ? 'sessionSaved' : 'deleteSaved', 'saveFail', () => { undo.push({ group, index, item }); if (editId === item.id) { editId = null; if ($('jText')) $('jText').value = ''; } }); return;
    }
    if (action === 'undo' && undo.length) {
      const latest = undo[undo.length - 1];
      next[latest.group].splice(latest.index, 0, latest.item);
      await perform(() => store.commit(next), 'saved', 'saveFail', () => undo.pop());
    }
  }
  async function onChange(event) {
    if (event.target.id === 'personal-clear-check') { $('personal-clear-button').disabled = busy || !event.target.checked; return; }
    if (event.target.id !== 'personal-import') return;
    pendingImport = null;
    const file = event.target.files[0]; if (!file) return;
    if (file.size > MAX_MODEL_BYTES) { message('importFail', true); return; }
    const epoch = store.epoch;
    try {
      const result = validateModel(JSON.parse(await file.text()));
      if (epoch !== store.epoch || store.locked || store.blocked) return;
      pendingImport = result;
      $('personal-import-preview').innerHTML = '<p>' + escape(text('importReady')) + ' ' + count(result) + ' (' + text('currentCounts') + ')</p>' + button('restore', text('restore'));
    } catch (error) { message('importFail', true); }
  }
  function init(options = {}) {
    if (initialized) { setLanguage(options.lang || language); return; }
    initialized = true; language = options.lang === 'fr' ? 'fr' : 'en';
    let storage;
    try { storage = host.localStorage; } catch (error) { storage = { getItem() { throw error; }, setItem() { throw error; }, removeItem() { throw error; } }; }
    const base = new URL('.', host.location.href).pathname;
    store = new DataStore(storage, 'imh_v2_data:' + base); store.load();
    document.addEventListener('submit', onSubmit); document.addEventListener('click', onClick); document.addEventListener('change', onChange);
    document.addEventListener('visibilitychange', () => { if (document.hidden && store.mode === 'encrypted') lock(); });
    host.addEventListener('pagehide', () => { if (store.mode === 'encrypted') lock(); });
    host.addEventListener('storage', event => {
      if (event.storageArea && event.storageArea !== store.storage) return;
      if (!store.externalChange(event.key)) return;
      clearEphemeral(); message('externalChange', true); render();
    });
    const style = document.createElement('style');
    style.textContent = '@media print{body>*{display:none!important}body>#personal-print{display:block!important;white-space:pre-wrap;color:#111;background:#fff}#personal-print h1,#personal-print h2{color:#111}}';
    document.head.appendChild(style);
    render();
  }
  function setLanguage(lang) { language = lang === 'fr' ? 'fr' : 'en'; render(); }
  host.Personal = { init, setLanguage, lock, Core };
})(typeof window !== 'undefined' ? window : globalThis);
