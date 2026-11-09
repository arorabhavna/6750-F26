(function (global) {
  'use strict';

  const STORAGE_KEY = 'hci-information-center:interactive:v1';
  const CATALOG_REVISION = 'cs6750-public-2026-11-09';
  const ARCHIVE_KEY = STORAGE_KEY + ':before-course-catalog';
  const ARCHIVE_PREFIX = 'Archived from the earlier design. ';
  const LEGACY_RESOURCE_IDS = new Set([
    'recognition-video', 'recognition-reading', 'evaluation-overview', 'walkthrough-checklist',
    'evaluation-plan', 'evaluation-plan-v1', 'walkthrough-discussion', 'needfinding-reading',
    'atlas-reference', 'nng-reference'
  ]);
  const LEGACY_COLLECTIONS = new Map([
    ['course-recognition', {
      title: 'Recognition and Memory',
      resourceIds: ['nng-reference', 'recognition-reading', 'atlas-reference', 'recognition-video']
    }],
    ['course-evaluation', {
      title: 'Evaluation Methods',
      resourceIds: ['evaluation-plan', 'evaluation-overview', 'walkthrough-checklist', 'walkthrough-discussion', 'atlas-reference']
    }],
    ['course-needfinding', {
      title: 'Needfinding',
      resourceIds: ['needfinding-reading', 'recognition-reading', 'evaluation-overview']
    }]
  ]);
  const TYPES = ['Video', 'Reading', 'Assignment', 'Discussion', 'Reference'];
  const REQUIREMENTS = ['Required', 'Optional', 'Unspecified'];
  const MAX_FILE_BYTES = 1024 * 1024;
  const MAX_STATE_CHARS = 24 * 1024 * 1024;
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const supplied = (object, key) => has(object, key) && object[key] !== undefined;
  let sequence = 0;

  function fail(message) { throw new Error(message); }
  function check(condition, message) { if (!condition) fail(message); }
  function object(value, label) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value),
      label + ' must be an object.');
    const prototype = Object.getPrototypeOf(value);
    check(prototype === Object.prototype || prototype === null, label + ' must be a plain object.');
  }
  function keys(value, allowed, label) {
    object(value, label);
    Object.keys(value).forEach(key => check(allowed.includes(key), label + ': unknown field "' + key + '".'));
  }
  function text(value, label, max, nonblank) {
    check(typeof value === 'string', label + ' must be text.');
    check(value.length <= max, label + ' must be at most ' + max + ' characters.');
    if (nonblank) check(value.trim().length > 0, label + ' cannot be blank.');
    return value;
  }
  function clean(value, label, max, nonblank) {
    return text(value, label, max, nonblank).trim();
  }
  function array(value, label, max) {
    check(Array.isArray(value) && value.length <= max, label + ' must be an array of at most ' + max + ' entries.');
  }
  function id(value, label) {
    check(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value) &&
      !['constructor', 'prototype'].includes(value), label + ' is not a valid ID.');
  }
  function timestamp(value, label) {
    check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    label + ' must be an ISO timestamp.');
  }
  function unique(values, label) {
    check(new Set(values).size === values.length, label + ' contains duplicate IDs or values.');
  }
  function https(value) {
    text(value, 'URL', 4096, true);
    let parsed;
    try { parsed = new URL(value); }
    catch (error) { fail('URL is invalid: enter a complete HTTPS address.'); }
    check(parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password,
      'Only HTTPS URLs without embedded credentials are allowed.');
    check(value === value.trim() && !/[\u0000-\u0020\u007f]/.test(value), 'URL cannot contain whitespace or control characters.');
    return value;
  }
  function file(value) {
    keys(value, ['name', 'mime', 'dataUrl'], 'File');
    text(value.name, 'File name', 200, true);
    check(['application/pdf', 'text/plain'].includes(value.mime), 'Only PDF or plain-text files are supported.');
    text(value.dataUrl, 'File data URL', 4 * MAX_FILE_BYTES + 256, true);
    const match = /^data:(application\/pdf|text\/plain)((?:;charset=utf-8)?)(;base64)?,([\s\S]*)$/i.exec(value.dataUrl);
    check(match && match[1].toLowerCase() === value.mime,
      'File data URL must declare the same PDF or plain-text MIME type as the file.');
    check(!match[2] || value.mime === 'text/plain', 'A PDF data URL must not declare a text charset.');
    let bytes;
    if (match[3]) {
      const payload = match[4];
      check(payload.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload),
        'File data URL contains invalid base64 data.');
      const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
      bytes = payload.length / 4 * 3 - padding;
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      if (padding) {
        const finalValue = alphabet.indexOf(payload[payload.length - padding - 1]);
        check(padding === 2 ? (finalValue & 15) === 0 : (finalValue & 3) === 0,
          'File data URL contains invalid base64 padding.');
      }
    } else {
      check(!/%(?![0-9a-f]{2})/i.test(match[4]) && !/[^\x21-\x7e]/.test(match[4]),
        'Non-base64 file data must be ASCII with special characters percent-encoded.');
      bytes = match[4].replace(/%[0-9a-f]{2}/gi, 'x').length;
    }
    check(bytes <= MAX_FILE_BYTES, 'File exceeds the 1 MB decoded size limit.');
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  function newId(prefix, occupied) {
    let candidate;
    do {
      sequence += 1;
      const suffix = global.crypto && typeof global.crypto.randomUUID === 'function'
        ? global.crypto.randomUUID()
        : Date.now().toString(36) + '-' + sequence.toString(36) + '-' + Math.random().toString(36).slice(2, 12);
      candidate = prefix + '-' + suffix;
    } while (occupied && occupied.has(candidate));
    return candidate;
  }
  function allIds(state) {
    return new Set([...state.resources, ...state.collections, ...state.notes].map(item => item.id));
  }
  function resource(state, resourceId) {
    const found = state.resources.find(item => item.id === resourceId);
    check(found, 'Resource not found: ' + resourceId + '.');
    return found;
  }
  function collection(state, collectionId) {
    const found = state.collections.find(item => item.id === collectionId);
    check(found, 'Collection not found: ' + collectionId + '.');
    return found;
  }
  function instructor(state) {
    check(state.profile.role === 'instructor', 'Switch to the Instructor role to make this change.');
  }
  function editableCollection(state, collectionId) {
    const found = collection(state, collectionId);
    if (found.kind === 'course') instructor(state);
    return found;
  }
  function member(found, resourceId) {
    check(found.resourceIds.includes(resourceId), 'Resource is not in this collection.');
  }
  function anchor(found, sectionId, label) {
    check(typeof sectionId === 'string' &&
      (sectionId === '' || found.sections.some(section => section.id === sectionId)),
    label + ' refers to a missing section. Keep section IDs that have notes or saved progress.');
  }

  function validateState(state) {
    keys(state, ['schemaVersion', 'catalogRevision', 'profile', 'prefs', 'resources', 'collections', 'notes', 'progress'], 'Saved state');
    check(state.schemaVersion === 1, 'This saved-data version is not supported.');
    if (has(state, 'catalogRevision')) text(state.catalogRevision, 'Catalog revision', 120, true);
    keys(state.profile, ['name', 'role'], 'Profile');
    text(state.profile.name, 'Profile name', 80, true);
    check(['student', 'instructor'].includes(state.profile.role), 'Profile role must be student or instructor.');
    keys(state.prefs, ['layout', 'ratio'], 'Preferences');
    check(['split', 'continuous'].includes(state.prefs.layout), 'Layout must be split or continuous.');
    check(typeof state.prefs.ratio === 'number' && Number.isFinite(state.prefs.ratio) &&
      state.prefs.ratio >= 35 && state.prefs.ratio <= 60, 'Split ratio must be between 35 and 60.');
    array(state.resources, 'Resources', 200);
    array(state.collections, 'Collections', 100);
    array(state.notes, 'Notes', 1500);
    const entityIds = [...state.resources, ...state.collections, ...state.notes].map(item => {
      object(item, 'Saved entry');
      id(item.id, 'Entry ID');
      return item.id;
    });
    unique(entityIds, 'Saved entries');
    const resourceMap = new Map(state.resources.map(item => [item.id, item]));

    state.resources.forEach(item => {
      keys(item, ['id', 'title', 'type', 'source', 'version', 'status', 'concepts', 'lesson',
        'summary', 'sections', 'relatedIds', 'url', 'sourceUrl', 'sectionLinks', 'media', 'transcript', 'file'], 'Resource');
      text(item.title, 'Resource title', 120, true);
      check(TYPES.includes(item.type), 'Unknown resource type.');
      text(item.source, 'Resource source', 160, true);
      text(item.version, 'Resource version', 40, true);
      check(/^v[1-9]\d{0,8}$/.test(item.version), 'Resource version must use v1, v2, and so on.');
      check(['current', 'superseded', 'external'].includes(item.status), 'Unknown resource status.');
      array(item.concepts, 'Resource concepts', 16);
      item.concepts.forEach(value => text(value, 'Concept', 100, true));
      unique(item.concepts, 'Resource concepts');
      text(item.lesson, 'Lesson', 120, true);
      const archived = LEGACY_RESOURCE_IDS.has(item.id) && item.status === 'superseded' &&
        typeof item.summary === 'string' && item.summary.startsWith(ARCHIVE_PREFIX);
      text(item.summary, 'Resource summary', 2400 + (archived ? ARCHIVE_PREFIX.length : 0), false);
      array(item.sections, 'Resource sections', 100);
      const sectionIds = [];
      item.sections.forEach(section => {
        keys(section, ['id', 'title', 'text'], 'Section');
        id(section.id, 'Section ID');
        sectionIds.push(section.id);
        text(section.title, 'Section title', 180, true);
        text(section.text, 'Section text', 150000, false);
      });
      unique(sectionIds, 'Resource sections');
      if (has(item, 'sourceUrl')) https(item.sourceUrl);
      if (has(item, 'sectionLinks')) {
        object(item.sectionLinks, 'Section links');
        Object.keys(item.sectionLinks).forEach(sectionId => {
          check(sectionIds.includes(sectionId), 'A source link refers to a missing section.');
          https(item.sectionLinks[sectionId]);
        });
      }
      array(item.relatedIds, 'Related resources', 200);
      unique(item.relatedIds, 'Related resources');
      item.relatedIds.forEach(relatedId => {
        id(relatedId, 'Related resource ID');
        check(resourceMap.has(relatedId), 'Related resource does not exist: ' + relatedId + '.');
      });
      if (has(item, 'url')) https(item.url);
      if (item.status === 'external') check(has(item, 'url'), 'An external resource needs an HTTPS original link.');
      if (has(item, 'file')) file(item.file);
      if (has(item, 'media')) {
        check(item.media === 'recognition-demo' && item.type === 'Video', 'Unknown or incompatible local media.');
      }
      if (has(item, 'transcript')) {
        check(item.type === 'Video', 'Only a video can have a timed transcript.');
        array(item.transcript, 'Transcript', 200);
        let previousTime = -1;
        item.transcript.forEach(segment => {
          keys(segment, ['time', 'title', 'text'], 'Transcript segment');
          check(typeof segment.time === 'number' && Number.isFinite(segment.time) &&
            segment.time > previousTime && segment.time <= (item.media === 'recognition-demo' ? 24 : 86400),
          'Transcript times must be nonnegative, strictly increasing, and within the video time range.');
          check(segment.time >= 0, 'Transcript time cannot be negative.');
          previousTime = segment.time;
          text(segment.title, 'Transcript title', 120, true);
          text(segment.text, 'Transcript text', 10000, true);
        });
      }
    });

    state.collections.forEach(item => {
      keys(item, ['id', 'title', 'description', 'kind', 'owner', 'resourceIds', 'requirements', 'updatedAt'], 'Collection');
      text(item.title, 'Collection title', 120, true);
      text(item.description, 'Collection description', 600, false);
      check(['course', 'personal'].includes(item.kind), 'Unknown collection kind.');
      text(item.owner, 'Collection owner', 100, true);
      timestamp(item.updatedAt, 'Collection updated time');
      array(item.resourceIds, 'Collection resources', 200);
      unique(item.resourceIds, 'Collection resources');
      item.resourceIds.forEach(resourceId => {
        id(resourceId, 'Collection resource ID');
        check(resourceMap.has(resourceId), 'Collection refers to a missing resource: ' + resourceId + '.');
      });
      object(item.requirements, 'Collection requirements');
      Object.keys(item.requirements).forEach(resourceId => {
        check(item.resourceIds.includes(resourceId), 'A requirement refers to a resource outside its collection.');
        check(REQUIREMENTS.includes(item.requirements[resourceId]), 'Unknown requirement label.');
        if (item.kind === 'personal') {
          check(item.requirements[resourceId] === 'Unspecified', 'Required and Optional labels belong to course collections only.');
        }
      });
    });
    state.notes.forEach(item => {
      keys(item, ['id', 'resourceId', 'sectionId', 'text', 'createdAt', 'updatedAt'], 'Note');
      id(item.resourceId, 'Note resource ID');
      check(resourceMap.has(item.resourceId), 'A note refers to a missing resource.');
      anchor(resourceMap.get(item.resourceId), item.sectionId, 'Note');
      text(item.text, 'Note', 6000, true);
      timestamp(item.createdAt, 'Note created time');
      timestamp(item.updatedAt, 'Note updated time');
      check(item.updatedAt >= item.createdAt, 'Note update cannot precede creation.');
    });
    object(state.progress, 'Progress');
    Object.keys(state.progress).forEach(resourceId => {
      id(resourceId, 'Progress resource ID');
      check(resourceMap.has(resourceId), 'Progress refers to a missing resource.');
      const entry = state.progress[resourceId];
      keys(entry, ['status', 'sectionId', 'time', 'updatedAt'], 'Progress entry');
      check(['in-progress', 'reviewed'].includes(entry.status), 'Unknown progress status.');
      const found = resourceMap.get(resourceId);
      anchor(found, entry.sectionId, 'Saved progress');
      check(typeof entry.time === 'number' && Number.isFinite(entry.time) && entry.time >= 0 &&
        entry.time <= (found.media === 'recognition-demo' ? 24 : 86400),
      'Progress time must be a nonnegative number within the resource time range.');
      timestamp(entry.updatedAt, 'Progress updated time');
    });
  }

  function fixtures() {
    const catalog = global.CourseCatalog;
    keys(catalog, ['revision', 'resources', 'collections'], 'Course catalog');
    check(catalog.revision === CATALOG_REVISION, 'The course catalog revision is not supported.');
    array(catalog.resources, 'Catalog resources', 200);
    array(catalog.collections, 'Catalog collections', 99);
    const initial = {
      schemaVersion: 1,
      catalogRevision: catalog.revision,
      profile: { name: 'Student', role: 'student' },
      prefs: { layout: 'split', ratio: 45 },
      resources: catalog.resources,
      collections: [
        ...catalog.collections,
        {
          id: 'personal-evaluation-plan', title: 'Project Resources',
          description: 'An empty personal collection for resources you choose to gather.',
          kind: 'personal', owner: 'Student', resourceIds: [], requirements: {},
          updatedAt: '2026-11-09T00:00:00.000Z'
        }
      ],
      notes: [],
      progress: {}
    };
    validateState(initial);
    return clone(initial);
  }

  function migrateCatalog(previous) {
    const next = fixtures();
    const retained = clone(previous);
    const collections = retained.collections.filter(item => {
      const original = LEGACY_COLLECTIONS.get(item.id);
      if (!original || item.kind === 'personal') return true;
      if (item.title === original.title && JSON.stringify(item.resourceIds) === JSON.stringify(original.resourceIds)) return false;
      item.title = ('Earlier collection: ' + item.title).slice(0, 120);
      item.kind = 'personal';
      item.owner = retained.profile.name;
      item.requirements = Object.fromEntries(item.resourceIds.map(resourceId => [resourceId, 'Unspecified']));
      return true;
    });
    const resourceMap = new Map(retained.resources.map(item => [item.id, item]));
    const needed = new Set([
      ...retained.resources.filter(item => !LEGACY_RESOURCE_IDS.has(item.id)).map(item => item.id),
      ...collections.flatMap(item => item.resourceIds),
      ...retained.notes.map(item => item.resourceId),
      ...Object.keys(retained.progress)
    ]);
    // Include related-resource closure so old anchors and uploaded-resource relationships stay intact.
    for (const resourceId of needed) {
      resourceMap.get(resourceId).relatedIds.forEach(relatedId => needed.add(relatedId));
    }
    next.resources.push(...retained.resources.filter(item => needed.has(item.id)).map(item => {
      if (LEGACY_RESOURCE_IDS.has(item.id)) {
        item.status = 'superseded';
        if (!item.summary.startsWith(ARCHIVE_PREFIX)) item.summary = ARCHIVE_PREFIX + item.summary;
      }
      return item;
    }));
    next.collections = next.collections.filter(item =>
      item.id !== 'personal-evaluation-plan' || !collections.some(kept => kept.id === item.id));
    const personal = next.collections.find(item => item.id === 'personal-evaluation-plan');
    if (personal) personal.owner = retained.profile.name;
    next.collections.push(...collections);
    next.profile = retained.profile;
    next.prefs = retained.prefs;
    next.notes = retained.notes;
    next.progress = retained.progress;
    validateState(next);
    check(JSON.stringify(next).length <= MAX_STATE_CHARS, 'The merged catalog exceeds the 24 MB JSON size limit.');
    return next;
  }

  function normalizeSections(input, previous) {
    array(input, 'Resource sections', 100);
    previous = previous || [];
    const occupied = new Set(previous.map(section => section.id));
    const used = new Set();
    input.forEach(section => {
      keys(section, ['id', 'title', 'text'], 'Section');
      if (has(section, 'id')) {
        id(section.id, 'Section ID');
        check(!used.has(section.id), 'Resource sections contain duplicate IDs.');
        used.add(section.id);
        occupied.add(section.id);
      }
    });
    const result = input.map(section => ({
      id: section.id,
      title: clean(section.title, 'Section title', 180, true),
      text: text(section.text, 'Section text', 150000, false)
    }));
    // Reserve all title matches before positional fallback, so an inserted section cannot steal an old anchor.
    result.forEach(section => {
      if (section.id !== undefined) return;
      const match = previous.find(old => old.title === section.title && !used.has(old.id));
      if (match) {
        section.id = match.id;
        used.add(match.id);
      }
    });
    result.forEach((section, index) => {
      if (section.id !== undefined) return;
      const positional = previous[index];
      section.id = positional && !used.has(positional.id) ? positional.id : newId('section', occupied);
      used.add(section.id);
      occupied.add(section.id);
    });
    return result;
  }

  function contentSnapshot(item) {
    return JSON.stringify([
      item.title, item.summary, item.sections.map(section => [section.id, section.title, section.text]),
      has(item, 'url') ? item.url : null,
      has(item, 'sourceUrl') ? item.sourceUrl : null,
      has(item, 'sectionLinks') ? Object.keys(item.sectionLinks).sort().map(key => [key, item.sectionLinks[key]]) : null,
      has(item, 'file') ? [item.file.name, item.file.mime, item.file.dataUrl] : null
    ]);
  }

  function createStore(onWarning) {
    check(onWarning === undefined || typeof onWarning === 'function', 'onWarning must be a function.');
    const warn = message => {
      if (onWarning) onWarning(message);
      else if (global.console && typeof global.console.warn === 'function') global.console.warn(message);
    };
    let state = fixtures();
    validateState(state);
    let storage = null;
    let lastRaw = null;
    let storageStatus = 'session-only';
    let corruptBlocked = false;
    let catalogBlocked = false;
    let migrationPending = false;
    let loaded = false;

    try {
      storage = global.localStorage;
      check(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function',
        'Local storage is unavailable.');
      lastRaw = storage.getItem(STORAGE_KEY);
      loaded = true;
    } catch (error) {
      storage = null;
      warn('Local storage could not be read. Changes will remain in this session only. ' + error.message);
    }
    if (loaded && lastRaw !== null) {
      let parsed;
      try {
        check(typeof lastRaw === 'string' && lastRaw.length <= MAX_STATE_CHARS, 'Saved data exceeds the supported size limit.');
        parsed = JSON.parse(lastRaw);
      } catch (error) {
        corruptBlocked = true;
        warn('Saved data could not be parsed and has been preserved. Using the public course catalog in memory; only an explicit reset can replace the saved data. ' + error.message);
      }
      if (!corruptBlocked) {
        try { validateState(parsed); }
        catch (error) {
          corruptBlocked = true;
          warn('Saved data is invalid or unsupported and has been preserved. Using the public course catalog in memory; only an explicit reset can replace the saved data. ' + error.message);
        }
        if (!corruptBlocked) {
          state = parsed;
          if (!has(parsed, 'catalogRevision')) {
            try {
              state = migrateCatalog(parsed);
              migrationPending = true;
            } catch (error) {
              catalogBlocked = true;
              warn('The course catalog could not be merged safely. Your earlier saved data has been preserved and is open in memory. Export a JSON backup before closing; only an explicit reset can replace the saved data. ' + error.message);
            }
          } else if (parsed.catalogRevision !== CATALOG_REVISION) {
            catalogBlocked = true;
            warn('This saved catalog revision is not supported. Its existing content is open in memory and will not be overwritten. Export a JSON backup to keep any changes; only an explicit reset can replace the saved data.');
          } else {
            storageStatus = 'saved';
          }
        }
      }
    }
    state = freeze(state);

    function conflict() {
      storageStatus = 'conflict';
      const message = 'Another tab changed the saved data. Reload this page before making more changes; newer saved data has not been overwritten. Export this tab first if you need to keep its session-only work.';
      warn(message);
      fail(message);
    }
    function persist(next, resetRequested) {
      check(storageStatus !== 'conflict', 'Saved data changed in another tab. Export any unsaved work and reload before making changes.');
      const serialized = JSON.stringify(next);
      check(serialized.length <= MAX_STATE_CHARS, 'The information center exceeds its 24 MB JSON size limit.');
      if (!storage || ((corruptBlocked || catalogBlocked) && !resetRequested)) {
        return { status: 'session-only', serialized: null };
      }
      let currentRaw;
      try { currentRaw = storage.getItem(STORAGE_KEY); }
      catch (error) {
        return { status: 'session-only', serialized: null,
          warning: 'Local storage could not be checked. Your saved data has not been overwritten. This change is in memory only; export a JSON backup before closing. ' + error.message };
      }
      if (currentRaw !== lastRaw) conflict();
      if (migrationPending) {
        try {
          if (storage.getItem(ARCHIVE_KEY) === null) storage.setItem(ARCHIVE_KEY, lastRaw);
          currentRaw = storage.getItem(STORAGE_KEY);
        } catch (error) {
          return { status: 'session-only', serialized: null,
            warning: 'The pre-catalog backup could not be saved or checked (storage may be blocked or full). Your original saved data has not been overwritten. This catalog and your changes are session-only; export a JSON backup before closing. ' + error.message };
        }
        if (currentRaw !== lastRaw) conflict();
      }
      try { storage.setItem(STORAGE_KEY, serialized); }
      catch (error) {
        return { status: 'session-only', serialized: null,
          warning: 'Local storage could not save this change (storage may be blocked or full). Your changes remain in memory; export a JSON backup before closing. ' + error.message };
      }
      migrationPending = false;
      return { status: 'saved', serialized };
    }
    function mutate(operation, resetRequested) {
      check(storageStatus !== 'conflict', 'Saved data changed in another tab. Export any unsaved work and reload before making changes.');
      const draft = resetRequested ? fixtures() : clone(state);
      const result = operation(draft);
      validateState(draft);
      const outcome = persist(draft, resetRequested);
      state = freeze(draft);
      storageStatus = outcome.status;
      if (outcome.serialized !== null) lastRaw = outcome.serialized;
      if (resetRequested) {
        corruptBlocked = false;
        catalogBlocked = false;
      }
      if (outcome.warning) warn(outcome.warning);
      return result;
    }

    if (loaded && (lastRaw === null || migrationPending)) {
      // Save only after initialization; migration must archive the untouched raw state first.
      const outcome = persist(state, false);
      storageStatus = outcome.status;
      if (outcome.serialized !== null) lastRaw = outcome.serialized;
      if (outcome.warning) warn(outcome.warning);
    }

    return Object.freeze({
      get state() { return state; },
      get storageStatus() { return storageStatus; },
      createCollection(input) {
        keys(input, ['title', 'description', 'kind'], 'New collection');
        return mutate(draft => {
          const kind = input.kind === undefined ? 'personal' : input.kind;
          check(['course', 'personal'].includes(kind), 'Collection kind must be course or personal.');
          if (kind === 'course') instructor(draft);
          const collectionId = newId('collection', allIds(draft));
          draft.collections.push({
            id: collectionId, title: clean(input.title, 'Collection title', 120, true),
            description: clean(input.description === undefined ? '' : input.description, 'Collection description', 600, false),
            kind, owner: kind === 'course' ? 'Course team' : draft.profile.name,
            resourceIds: [], requirements: {}, updatedAt: new Date().toISOString()
          });
          return collectionId;
        });
      },
      updateCollection(collectionId, changes) {
        keys(changes, ['title', 'description'], 'Collection changes');
        return mutate(draft => {
          const found = editableCollection(draft, collectionId);
          const before = JSON.stringify(found);
          if (supplied(changes, 'title')) found.title = clean(changes.title, 'Collection title', 120, true);
          if (supplied(changes, 'description')) found.description = clean(changes.description, 'Collection description', 600, false);
          if (JSON.stringify(found) !== before) found.updatedAt = new Date().toISOString();
        });
      },
      deleteCollection(collectionId) {
        return mutate(draft => {
          editableCollection(draft, collectionId);
          draft.collections = draft.collections.filter(item => item.id !== collectionId);
        });
      },
      addToCollection(collectionId, resourceId) {
        return mutate(draft => {
          const found = editableCollection(draft, collectionId);
          resource(draft, resourceId);
          check(!found.resourceIds.includes(resourceId), 'Resource is already in this collection.');
          found.resourceIds.push(resourceId);
          found.requirements[resourceId] = 'Unspecified';
          found.updatedAt = new Date().toISOString();
        });
      },
      removeFromCollection(collectionId, resourceId) {
        return mutate(draft => {
          const found = editableCollection(draft, collectionId);
          member(found, resourceId);
          found.resourceIds = found.resourceIds.filter(value => value !== resourceId);
          delete found.requirements[resourceId];
          found.updatedAt = new Date().toISOString();
        });
      },
      moveResource(collectionId, resourceId, direction) {
        check(direction === -1 || direction === 1, 'Move direction must be -1 or 1.');
        return mutate(draft => {
          const found = editableCollection(draft, collectionId);
          member(found, resourceId);
          const from = found.resourceIds.indexOf(resourceId);
          const to = from + direction;
          if (to < 0 || to >= found.resourceIds.length) return;
          [found.resourceIds[from], found.resourceIds[to]] = [found.resourceIds[to], found.resourceIds[from]];
          found.updatedAt = new Date().toISOString();
        });
      },
      setRequirement(collectionId, resourceId, value) {
        return mutate(draft => {
          instructor(draft);
          const found = collection(draft, collectionId);
          check(found.kind === 'course', 'Requirement labels can only be edited in a course collection.');
          member(found, resourceId);
          check(REQUIREMENTS.includes(value), 'Requirement must be Required, Optional, or Unspecified.');
          found.requirements[resourceId] = value;
          found.updatedAt = new Date().toISOString();
        });
      },
      addNote(input) {
        keys(input, ['resourceId', 'sectionId', 'text'], 'New note');
        return mutate(draft => {
          const found = resource(draft, input.resourceId);
          const sectionId = input.sectionId === undefined ? '' : input.sectionId;
          anchor(found, sectionId, 'Note');
          const noteId = newId('note', allIds(draft));
          const now = new Date().toISOString();
          draft.notes.push({
            id: noteId, resourceId: found.id, sectionId,
            text: clean(input.text, 'Note', 6000, true), createdAt: now, updatedAt: now
          });
          return noteId;
        });
      },
      updateNote(noteId, value) {
        return mutate(draft => {
          const found = draft.notes.find(item => item.id === noteId);
          check(found, 'Note not found: ' + noteId + '.');
          found.text = clean(value, 'Note', 6000, true);
          found.updatedAt = new Date(Math.max(Date.now(), Date.parse(found.createdAt))).toISOString();
        });
      },
      deleteNote(noteId) {
        return mutate(draft => {
          check(draft.notes.some(item => item.id === noteId), 'Note not found: ' + noteId + '.');
          draft.notes = draft.notes.filter(item => item.id !== noteId);
        });
      },
      setProgress(resourceId, changes) {
        keys(changes, ['status', 'sectionId', 'time'], 'Progress changes');
        return mutate(draft => {
          const found = resource(draft, resourceId);
          const entry = has(draft.progress, resourceId) ? draft.progress[resourceId]
            : { status: 'in-progress', sectionId: found.sections.length ? found.sections[0].id : '', time: 0, updatedAt: new Date().toISOString() };
          ['status', 'sectionId', 'time'].forEach(key => {
            if (supplied(changes, key)) entry[key] = changes[key];
          });
          entry.updatedAt = new Date().toISOString();
          draft.progress[resourceId] = entry;
        });
      },
      setProfile(changes) {
        keys(changes, ['name', 'role'], 'Profile changes');
        return mutate(draft => {
          if (supplied(changes, 'name')) draft.profile.name = clean(changes.name, 'Profile name', 80, true);
          if (supplied(changes, 'role')) draft.profile.role = changes.role;
        });
      },
      setPrefs(changes) {
        keys(changes, ['layout', 'ratio'], 'Preference changes');
        return mutate(draft => {
          if (supplied(changes, 'layout')) draft.prefs.layout = changes.layout;
          if (supplied(changes, 'ratio')) draft.prefs.ratio = changes.ratio;
        });
      },
      addResource(input) {
        keys(input, ['title', 'type', 'source', 'concepts', 'lesson', 'summary', 'sections', 'url', 'sourceUrl', 'sectionLinks', 'file'], 'New resource');
        return mutate(draft => {
          instructor(draft);
          array(input.concepts, 'Resource concepts', 16);
          const resourceId = newId('resource', allIds(draft));
          const entry = {
            id: resourceId, title: clean(input.title, 'Resource title', 120, true),
            type: input.type, source: clean(input.source, 'Resource source', 160, true),
            version: 'v1', status: 'current',
            concepts: input.concepts.map(value => clean(value, 'Concept', 100, true)),
            lesson: clean(input.lesson, 'Lesson', 120, true),
            summary: clean(input.summary, 'Resource summary', 2400, false),
            sections: normalizeSections(input.sections), relatedIds: []
          };
          if (supplied(input, 'url') && input.url !== '') {
            entry.url = https(input.url);
            if (entry.type === 'Reference') entry.status = 'external';
          }
          if (supplied(input, 'sourceUrl') && input.sourceUrl !== '') entry.sourceUrl = https(input.sourceUrl);
          if (supplied(input, 'sectionLinks')) {
            object(input.sectionLinks, 'Section links');
            entry.sectionLinks = { ...input.sectionLinks };
          }
          if (supplied(input, 'file') && input.file !== null) {
            file(input.file);
            entry.file = clone(input.file);
          }
          draft.resources.push(entry);
          return resourceId;
        });
      },
      updateResource(resourceId, changes) {
        keys(changes, ['title', 'summary', 'sections', 'url', 'sourceUrl', 'sectionLinks', 'file'], 'Resource changes');
        return mutate(draft => {
          instructor(draft);
          const found = resource(draft, resourceId);
          const before = contentSnapshot(found);
          if (supplied(changes, 'title')) found.title = clean(changes.title, 'Resource title', 120, true);
          if (supplied(changes, 'summary')) {
            const max = 2400 + (LEGACY_RESOURCE_IDS.has(found.id) && found.status === 'superseded' ? ARCHIVE_PREFIX.length : 0);
            found.summary = clean(changes.summary, 'Resource summary', max, false);
          }
          if (supplied(changes, 'sections')) found.sections = normalizeSections(changes.sections, found.sections);
          if (supplied(changes, 'url')) {
            if (changes.url === '' || changes.url === null) delete found.url;
            else found.url = https(changes.url);
          }
          if (supplied(changes, 'sourceUrl')) {
            if (changes.sourceUrl === '' || changes.sourceUrl === null) delete found.sourceUrl;
            else found.sourceUrl = https(changes.sourceUrl);
          }
          if (supplied(changes, 'sectionLinks')) {
            if (changes.sectionLinks === null) delete found.sectionLinks;
            else {
              object(changes.sectionLinks, 'Section links');
              found.sectionLinks = { ...changes.sectionLinks };
            }
          }
          if (supplied(changes, 'file')) {
            if (changes.file === null) delete found.file;
            else {
              file(changes.file);
              found.file = clone(changes.file);
            }
          }
          // Removing a referenced anchor fails validation rather than discarding or retargeting a student's note.
          if (contentSnapshot(found) !== before) found.version = 'v' + (Number(found.version.slice(1)) + 1);
        });
      },
      reset() { return mutate(() => undefined, true); },
      exportData() { return JSON.stringify(state, null, 2); }
    });
  }

  global.CenterModel = Object.freeze({ createStore, STORAGE_KEY });
})(window);
