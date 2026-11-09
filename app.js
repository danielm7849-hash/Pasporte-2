(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const STORAGE_KEY = 'isla-id-studio-v2';
  const TEMPLATES = {
    grenada: { country: 'GRENADA', region: 'CARIBE', cover: 'GRENADA · CARIBE', nationality: 'Granadina', emblem: '✦', subtitle: 'Explorador de las islas' },
    colombia: { country: 'COLOMBIA', region: 'TRÓPICO', cover: 'COLOMBIA · TRÓPICO', nationality: 'Colombiana', emblem: '◈', subtitle: 'Viajero de nuevos caminos' },
    japan: { country: 'JAPÓN', region: 'ESTILO MINIMAL', cover: 'JAPÓN · ESTILO MINIMAL', nationality: 'Japonesa', emblem: '◉', subtitle: 'En busca de nuevos horizontes' },
    canada: { country: 'CANADÁ', region: 'TIERRAS DEL NORTE', cover: 'CANADÁ · TIERRAS DEL NORTE', nationality: 'Canadiense', emblem: '✦', subtitle: 'Explorador del norte' },
    barbados: { country: 'BARBADOS', region: 'ISLAS DEL ATLÁNTICO', cover: 'BARBADOS · ATLÁNTICO', nationality: 'Barbadense', emblem: '⌁', subtitle: 'Donde el mar me lleve' },
    forest: { country: 'WILDERNESS', region: 'COLECCIÓN NATURAL', cover: 'WILDERNESS · NATURAL', nationality: 'Personalizada', emblem: '❋', subtitle: 'Conectado con la naturaleza' }
  };
  const DEFAULT_ACCENT = '#e5bd69';
  const state = {
    template: 'grenada', accent: DEFAULT_ACCENT, reference: '', photo: '', cameraStream: null,
    cameraActive: false, detector: null, syncAvailable: false, pollTimer: null,
    scanTimer: null, scanEventHandled: false, qrPayload: '', toastTimer: null, syncTimer: null
  };

  const form = $('#passport-form');
  const cover = $('#passport-cover');
  const page = $('#passport-page');
  const qrBox = $('#qrcode');
  const qrStatus = $('#qr-state');
  const video = $('#camera-video');
  const cameraBox = $('#camera-box');

  function newReference() {
    const bytes = new Uint8Array(8);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return 'ISL-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // FNV-1a is used as a format check, not as a cryptographic signature.
  function checksum(value) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  function makePayload(reference) {
    const core = `ISLA-ID|1|${reference}`;
    return `${core}|${checksum(core)}`;
  }

  function validatePayload(payload) {
    if (typeof payload !== 'string') return null;
    const parts = payload.trim().split('|');
    if (parts.length !== 4 || parts[0] !== 'ISLA-ID' || parts[1] !== '1') return null;
    const reference = parts[2];
    if (!/^ISL-[0-9A-F]{16}$/.test(reference)) return null;
    const core = `ISLA-ID|1|${reference}`;
    if (checksum(core) !== parts[3].toUpperCase()) return null;
    return { reference, payload: payload.trim() };
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function setQRStatus(message, error = false, scanned = false) {
    qrStatus.querySelector('span').textContent = message;
    qrStatus.classList.toggle('error', error);
    qrStatus.classList.toggle('scanned', scanned);
  }

  function setScannerStatus(message, error = false) {
    const status = $('#scanner-status');
    status.querySelector('span').textContent = message;
    status.classList.toggle('error', error);
  }

  function setAccent(color) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) color = DEFAULT_ACCENT;
    state.accent = color.toLowerCase();
    const rgb = [1, 3, 5].map((i) => parseInt(state.accent.slice(i, i + 2), 16)).join(',');
    document.documentElement.style.setProperty('--accent', state.accent);
    document.documentElement.style.setProperty('--accent-rgb', rgb);
    [cover, page].forEach((el) => el.style.setProperty('--cover-accent', state.accent));
    $$('.color-dot').forEach((button) => button.classList.toggle('active', button.dataset.color.toLowerCase() === state.accent));
  }

  function applyTemplate(name, setDefaultNationality = true) {
    if (!Object.prototype.hasOwnProperty.call(TEMPLATES, name)) name = 'grenada';
    const previous = TEMPLATES[state.template];
    state.template = name;
    const config = TEMPLATES[name];
    cover.dataset.template = name;
    page.dataset.template = name;
    $('#cover-country').textContent = config.cover;
    $('#cover-emblem').textContent = config.emblem;
    $('#page-country').textContent = config.country;
    $('#page-eyebrow').textContent = `CREDENCIAL PERSONAL · ${config.region}`;
    $('#page-emblem').firstChild.textContent = config.emblem;
    $$('.template-choice').forEach((button) => button.classList.toggle('selected', button.dataset.template === name));
    if (setDefaultNationality) {
      const nationalityField = $('#nationality');
      if (!nationalityField.value.trim() || (previous && nationalityField.value.trim() === previous.nationality)) {
        nationalityField.value = config.nationality;
      }
      if (!$('#subtitle').value.trim() || (previous && $('#subtitle').value.trim() === previous.subtitle)) {
        $('#subtitle').value = config.subtitle;
      }
    }
    setAccent(state.accent);
    updatePreview();
    saveLocal();
  }

  function currentRecord() {
    const config = TEMPLATES[state.template];
    const fullName = $('#full-name').value.trim();
    const nationality = $('#nationality').value.trim() || config.nationality;
    const pronouns = $('#pronouns').value.trim();
    return {
      name: fullName || 'Tu nombre aquí',
      displayName: pronouns && fullName ? `${pronouns} ${fullName}` : (fullName || 'TU NOMBRE'),
      nationality,
      birth: $('#birth-date').value,
      expiry: $('#expiry').value,
      subtitle: $('#subtitle').value.trim() || config.subtitle,
      template: state.template,
      reference: state.reference,
      accent: state.accent,
      photo: state.photo
    };
  }

  function displayDate(isoDate) {
    if (!isoDate) return '—';
    const parts = isoDate.split('-').map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return '—';
    return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12))).replace('.', '').toUpperCase();
  }

  function updatePortrait() {
    const portrait = $('#portrait');
    portrait.replaceChildren();
    if (state.photo) {
      const image = document.createElement('img');
      image.src = state.photo;
      image.alt = 'Retrato seleccionado';
      portrait.appendChild(image);
    } else {
      const icon = document.createElement('span');
      icon.textContent = TEMPLATES[state.template].emblem;
      const label = document.createElement('small');
      label.textContent = 'RETRATO';
      portrait.append(icon, label);
    }
  }

  function updatePreview() {
    const record = currentRecord();
    $('#cover-subtitle').textContent = record.subtitle;
    $('#cover-ref').textContent = record.reference;
    $('#preview-person-name').textContent = record.name;
    $('#preview-nationality').textContent = record.nationality;
    $('#display-name').textContent = record.displayName;
    $('#display-nationality').textContent = record.nationality;
    $('#display-birth').textContent = displayDate(record.birth);
    $('#display-expiry').textContent = displayDate(record.expiry);
    $('#display-id').textContent = record.reference;
    $('#display-subtitle').textContent = record.subtitle;
    $('#qr-reference-text').textContent = record.reference;
    $('#cover-emblem').textContent = TEMPLATES[state.template].emblem;
    $('#page-emblem').firstChild.textContent = TEMPLATES[state.template].emblem;
    updatePortrait();
  }

  function saveLocal(showErrors = false) {
    const saved = {
      version: 2, template: state.template, accent: state.accent, reference: state.reference,
      photo: state.photo, fullName: $('#full-name').value, nationality: $('#nationality').value,
      birth: $('#birth-date').value, pronouns: $('#pronouns').value, expiry: $('#expiry').value,
      subtitle: $('#subtitle').value
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      return true;
    } catch (error) {
      if (showErrors) showToast('No se pudo guardar en el dispositivo. Prueba con una foto más pequeña.');
      return false;
    }
  }

  function loadLocal() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { saved = null; }
    if (!saved || typeof saved !== 'object') {
      state.reference = newReference();
      $('#nationality').value = TEMPLATES.grenada.nationality;
      $('#subtitle').value = TEMPLATES.grenada.subtitle;
      return;
    }
    state.template = Object.prototype.hasOwnProperty.call(TEMPLATES, saved.template) ? saved.template : 'grenada';
    state.accent = /^#[0-9a-fA-F]{6}$/.test(saved.accent || '') ? saved.accent : DEFAULT_ACCENT;
    state.reference = /^ISL-[0-9A-F]{16}$/.test(saved.reference || '') ? saved.reference : newReference();
    state.photo = typeof saved.photo === 'string' && saved.photo.startsWith('data:image/') ? saved.photo : '';
    if (state.photo) $('#portrait-file-name').textContent = 'Retrato guardado en este dispositivo';
    $('#full-name').value = typeof saved.fullName === 'string' ? saved.fullName : '';
    $('#nationality').value = typeof saved.nationality === 'string' ? saved.nationality : TEMPLATES[state.template].nationality;
    $('#birth-date').value = typeof saved.birth === 'string' ? saved.birth : '';
    $('#pronouns').value = typeof saved.pronouns === 'string' ? saved.pronouns : '';
    $('#expiry').value = typeof saved.expiry === 'string' ? saved.expiry : '';
    $('#subtitle').value = typeof saved.subtitle === 'string' ? saved.subtitle : TEMPLATES[state.template].subtitle;
  }

  async function registerServerSession(reference) {
    try {
      const response = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, credential: currentRecord() })
      });
      if (!response.ok) {
        state.syncAvailable = false;
        stopPoll();
        return false;
      }
      const data = await response.json();
      if (data && data.ok) {
        state.syncAvailable = true;
        state.scanEventHandled = false;
        startPoll(reference);
        return true;
      }
    } catch (_) {
      // The site remains usable without the optional cross-device server.
    }
    state.syncAvailable = false;
    stopPoll();
    return false;
  }

  function stopPoll() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function scheduleServerSync() {
    if (state.syncTimer) clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(() => {
      state.syncTimer = null;
      registerServerSession(state.reference);
    }, 350);
  }

  function startPoll(reference) {
    stopPoll();
    state.pollTimer = setInterval(async () => {
      if (!state.syncAvailable || state.scanEventHandled || reference !== state.reference) return;
      try {
        const response = await fetch(`/api/session?reference=${encodeURIComponent(reference)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (data && data.scanned && !state.scanEventHandled) {
          state.scanEventHandled = true;
          stopPoll();
          setQRStatus('Escaneo completado · otro dispositivo leyó tu QR', false, true);
          updatePreview();
          showTab('passport');
          showToast('¡Escaneo completado! Tu pasaporte está listo.');
        }
      } catch (_) { /* La lectura local sigue disponible si falla la red. */ }
    }, 1300);
  }

  function generateQR() {
    updatePreview();
    if (!window.LocalQR || typeof window.LocalQR.toSvg !== 'function') {
      setQRStatus('No se pudo iniciar el generador local', true);
      showToast('Falta qr-engine.js. Comprueba que todos los archivos estén en la misma carpeta.');
      return;
    }
    try {
      state.qrPayload = makePayload(state.reference);
      qrBox.innerHTML = window.LocalQR.toSvg(state.qrPayload, 256);
      setQRStatus('QR generado · referencia personal lista');
      saveLocal(true);
      // If deployed with the included Node server, this enables the owner's live scan notice.
      registerServerSession(state.reference);
    } catch (error) {
      qrBox.replaceChildren();
      setQRStatus(error.message || 'No se pudo generar el QR', true);
      showToast(error.message || 'No se pudo generar el código.');
    }
  }

  function showTab(name) {
    if (!$('#view-' + name)) name = 'create';
    $$('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
    $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
    if (name !== 'scanner') stopCamera();
    if (name === 'passport' && !qrBox.querySelector('svg')) generateQR();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderScannedPassport(record) {
    const container = $('#scanned-passport');
    container.replaceChildren();

    const card = page.cloneNode(true);
    card.removeAttribute('id');
    const template = Object.prototype.hasOwnProperty.call(TEMPLATES, record.template) ? record.template : 'grenada';
    const config = TEMPLATES[template];
    card.dataset.template = template;
    card.style.setProperty('--cover-accent', /^#[0-9a-fA-F]{6}$/.test(record.accent || '') ? record.accent : DEFAULT_ACCENT);

    const setText = (selector, value) => {
      const element = card.querySelector(selector);
      if (element) element.textContent = value || '—';
    };

    setText('#page-country', config.country);
    setText('#page-eyebrow', `CREDENCIAL PERSONAL · ${config.region}`);
    const emblem = card.querySelector('#page-emblem');
    if (emblem && emblem.firstChild) emblem.firstChild.textContent = config.emblem;
    setText('#display-name', record.displayName || record.name);
    setText('#display-nationality', record.nationality);
    setText('#display-birth', displayDate(record.birth));
    setText('#display-expiry', displayDate(record.expiry));
    setText('#display-id', record.reference);
    setText('#display-subtitle', record.subtitle || config.subtitle);

    const portrait = card.querySelector('#portrait');
    if (portrait) {
      portrait.replaceChildren();
      if (typeof record.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(record.photo)) {
        const image = document.createElement('img');
        image.src = record.photo;
        image.alt = 'Retrato de la persona titular';
        portrait.appendChild(image);
      } else {
        const icon = document.createElement('span');
        icon.textContent = config.emblem;
        const label = document.createElement('small');
        label.textContent = 'RETRATO';
        portrait.append(icon, label);
      }
    }

    // The preview is a clone, so remove duplicate IDs from the original passport page.
    card.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
    container.appendChild(card);
    container.classList.remove('hidden');
  }

  function showScanResult(reference, serverResult) {
    $('#scan-empty').classList.add('hidden');
    $('#scan-error').classList.add('hidden');
    $('#scan-result').classList.remove('hidden');
    $('#scan-reference').textContent = reference;

    const credential = serverResult && serverResult.credential && serverResult.credential.reference === reference
      ? serverResult.credential
      : (reference === state.reference ? currentRecord() : null);

    if (credential) {
      renderScannedPassport(credential);
      $('#scan-message').textContent = 'Credencial recuperada. Este es el pasaporte asociado al código QR.';
    } else {
      $('#scanned-passport').replaceChildren();
      $('#scanned-passport').classList.add('hidden');
      $('#scan-message').textContent = 'QR reconocido, pero no pudimos recuperar el pasaporte. La persona que generó el código debe tener abierto Isla ID y conexión a internet.';
    }

    setScannerStatus('QR reconocido. Lectura completada.');
    showToast(credential ? '¡Pasaporte recuperado correctamente!' : 'QR leído, pero la credencial no está disponible.');
  }

  function showScanError(message) {
    $('#scan-empty').classList.add('hidden');
    $('#scan-result').classList.add('hidden');
    $('#scan-error').classList.remove('hidden');
    $('#scan-error-text').textContent = message || 'Prueba con el QR generado por tu diseño.';
    setScannerStatus('El código no se reconoce', true);
  }

  async function sendScanSignal(payload) {
    try {
      const response = await fetch('/api/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload })
      });
      if (!response.ok) return { online: false, notified: false };
      const result = await response.json();
      return { online: true, notified: !!result.notified, credential: result.credential || null };
    } catch (_) {
      return { online: false, notified: false };
    }
  }

  async function handlePayload(payload) {
    const checked = validatePayload(payload);
    if (!checked) {
      stopCamera();
      showScanError('Este código no corresponde al formato de Isla ID. Intenta con el QR generado en Mi pasaporte.');
      return false;
    }
    stopCamera();
    const serverResult = await sendScanSignal(checked.payload);
    showScanResult(checked.reference, serverResult);
    return true;
  }

  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  async function startCamera() {
    if (!window.isSecureContext) {
      setScannerStatus('La cámara requiere HTTPS o un contexto local seguro.', true);
      showToast('Abre la página publicada con HTTPS para usar la cámara.');
      return;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setScannerStatus('Este navegador no permite acceso a cámara desde esta página.', true);
      showToast('Prueba con Chrome actualizado y permiso de cámara.');
      return;
    }
    if (!('BarcodeDetector' in window)) {
      setScannerStatus('El lector de cámara QR no está disponible en este navegador.', true);
      showToast('Usa Chrome actualizado en Android para leer QR con cámara.');
      return;
    }
    try {
      const formats = typeof BarcodeDetector.getSupportedFormats === 'function' ? await BarcodeDetector.getSupportedFormats() : ['qr_code'];
      if (!formats.includes('qr_code')) throw new Error('El navegador no admite lectura de códigos QR.');
      state.detector = new BarcodeDetector({ formats: ['qr_code'] });
      state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = state.cameraStream;
      await video.play();
      state.cameraActive = true;
      cameraBox.classList.add('running');
      $('#camera-placeholder').hidden = true;
      $('#start-camera').disabled = true;
      $('#stop-camera').disabled = false;
      setScannerStatus('Cámara activa. Centra el QR dentro del marco.');
      scanLoop();
    } catch (error) {
      const message = error && error.name === 'NotAllowedError'
        ? 'Permite el acceso a la cámara en los ajustes del navegador.'
        : (error && error.message ? error.message : 'No se pudo activar la cámara. Comprueba permisos y HTTPS.');
      setScannerStatus(message, true);
      showToast(message);
      stopCamera();
    }
  }

  async function scanLoop() {
    while (state.cameraActive && state.detector && video.readyState >= 2) {
      try {
        const results = await state.detector.detect(video);
        if (!state.cameraActive) return;
        if (results && results.length && results[0].rawValue) {
          await handlePayload(results[0].rawValue);
          return;
        }
      } catch (_) {
        // Keep scanning while the camera is active; individual blurry frames may fail.
      }
      await delay(220);
    }
    if (state.cameraActive) setTimeout(scanLoop, 180);
  }

  function stopCamera() {
    state.cameraActive = false;
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach((track) => track.stop());
      state.cameraStream = null;
    }
    if (video) video.srcObject = null;
    cameraBox.classList.remove('running');
    $('#camera-placeholder').hidden = false;
    $('#start-camera').disabled = false;
    $('#stop-camera').disabled = true;
  }

  async function readQRImage(file) {
    if (!file) return;
    if (!window.isSecureContext) {
      showScanError('Para leer imágenes con este navegador, abre el estudio desde una página HTTPS.');
      return;
    }
    if (!('BarcodeDetector' in window)) {
      showScanError('La lectura de imágenes no está disponible en este navegador. Prueba con Chrome actualizado en Android.');
      return;
    }
    try {
      const formats = typeof BarcodeDetector.getSupportedFormats === 'function' ? await BarcodeDetector.getSupportedFormats() : ['qr_code'];
      if (!formats.includes('qr_code')) throw new Error('El navegador no admite códigos QR.');
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const bitmap = await createImageBitmap(file);
      let results;
      try { results = await detector.detect(bitmap); } finally { if (bitmap.close) bitmap.close(); }
      if (!results || !results.length || !results[0].rawValue) {
        showScanError('No encontramos un QR en esa imagen. Prueba con una foto más nítida y bien encuadrada.');
        return;
      }
      await handlePayload(results[0].rawValue);
    } catch (error) {
      showScanError(error && error.message ? error.message : 'No se pudo analizar esa imagen.');
    }
  }

  async function processPortrait(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) { showToast('Selecciona un archivo de imagen.'); return; }
    if (file.size > 8 * 1024 * 1024) { showToast('La imagen pesa más de 8 MB. Elige una foto más ligera.'); return; }
    try {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.src = url;
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      const maxW = 360, maxH = 460;
      const ratio = Math.min(1, maxW / image.naturalWidth, maxH / image.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      state.photo = canvas.toDataURL('image/jpeg', 0.78);
      $('#portrait-file-name').textContent = file.name;
      updatePreview();
      saveLocal(true);
      scheduleServerSync();
      showToast('Retrato añadido al diseño.');
    } catch (_) {
      showToast('No pudimos abrir esa imagen. Prueba con JPG o PNG.');
    }
  }

  function downloadQR() {
    const svg = qrBox.querySelector('svg');
    if (!svg) { showToast('Genera el QR antes de descargarlo.'); return; }
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `isla-id-${state.reference.toLowerCase()}.svg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('QR descargado en SVG.');
  }

  function resetDesign() {
    form.reset();
    state.template = 'grenada';
    state.accent = DEFAULT_ACCENT;
    state.reference = newReference();
    state.photo = '';
    $('#portrait-file-name').textContent = 'Sin foto seleccionada';
    $('#nationality').value = TEMPLATES.grenada.nationality;
    $('#subtitle').value = TEMPLATES.grenada.subtitle;
    setAccent(DEFAULT_ACCENT);
    applyTemplate('grenada');
    updatePreview();
    generateQR();
    saveLocal(true);
    showToast('Diseño restablecido.');
  }

  function init() {
    loadLocal();
    setAccent(state.accent);
    const loadedTemplate = state.template;
    state.template = 'grenada';
    applyTemplate(loadedTemplate, false);
    updatePreview();
    generateQR();

    $$('.tab').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));
    $$('.template-choice').forEach((button) => button.addEventListener('click', () => { applyTemplate(button.dataset.template); scheduleServerSync(); }));
    $$('.color-dot').forEach((button) => button.addEventListener('click', () => {
      setAccent(button.dataset.color);
      updatePreview();
      saveLocal();
      scheduleServerSync();
    }));
    form.addEventListener('input', () => { updatePreview(); saveLocal(); scheduleServerSync(); });
    form.addEventListener('change', () => { updatePreview(); saveLocal(); scheduleServerSync(); });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      updatePreview();
      saveLocal(true);
      generateQR();
      showTab('passport');
      showToast('Tu diseño está guardado.');
    });
    $('#go-passport').addEventListener('click', () => { updatePreview(); generateQR(); showTab('passport'); });
    $('#generate-qr').addEventListener('click', () => { generateQR(); showToast('QR actualizado y listo para escanear.'); });
    $('#download-qr').addEventListener('click', downloadQR);
    $('#print-card').addEventListener('click', () => window.print());
    $('#start-camera').addEventListener('click', startCamera);
    $('#stop-camera').addEventListener('click', stopCamera);
    $('#scan-again').addEventListener('click', () => {
      $('#scan-result').classList.add('hidden');
      $('#scanned-passport').replaceChildren();
      $('#scanned-passport').classList.add('hidden');
      $('#scan-empty').classList.remove('hidden');
      setScannerStatus('Listo para un nuevo escaneo.');
    });
    $('#dismiss-error').addEventListener('click', () => {
      $('#scan-error').classList.add('hidden');
      $('#scan-empty').classList.remove('hidden');
      setScannerStatus('Listo para volver a intentarlo.');
    });
    $('#qr-image-upload').addEventListener('change', (event) => {
      readQRImage(event.target.files && event.target.files[0]);
      event.target.value = '';
    });
    $('#portrait-upload').addEventListener('change', (event) => processPortrait(event.target.files && event.target.files[0]));
    $('#reset-btn').addEventListener('click', resetDesign);
    $('#top-home').addEventListener('click', () => showTab('create'));
    $('#back-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    $$('[data-apply-template]').forEach((button) => button.addEventListener('click', () => {
      applyTemplate(button.dataset.applyTemplate);
      scheduleServerSync();
      showTab('create');
      showToast('Paleta aplicada a tu diseño.');
    }));
    $$('[data-switch-tab]').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.switchTab)));
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
    window.addEventListener('beforeunload', () => { stopCamera(); stopPoll(); });
  }

  init();
})();
