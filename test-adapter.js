// Harness: verify the NativeRecognizer adapter extracted from app/www/index.html
// - native path: partialResults -> interim onresult; stop/abort -> onend; late events ignored
// - permission denied -> onerror 'not-allowed'
// - browser fallback: no Capacitor -> createRecognizer() returns web SR
const fs = require('fs');
const html = fs.readFileSync((process.env.APP || __dirname) + '/www/index.html', 'utf-8');
const start = html.indexOf('/* ---------- native speech recognition (installed App) ----------');
const endMarker = 'function createRecognizer(){';
const endIdx = html.indexOf(endMarker, start);
const closeIdx = html.indexOf('\n        }\n', endIdx) + '\n        }\n'.length;
const adapterSrc = html.slice(start, closeIdx);
if (!adapterSrc.includes('NativeRecognizer') || !adapterSrc.includes('registerPlugin')) {
  console.error('FAIL: adapter block not found'); process.exit(1);
}

function makeEnv(capacitorObj, SRClass) {
  const listeners = {};
  const emit = (event, data) => { (listeners[event] || []).forEach(cb => cb(data)); };
  const mockPlugin = {
    _opts: null,
    addListener: (event, cb) => { (listeners[event] = listeners[event] || []).push(cb); return Promise.resolve({ remove: async () => {} }); },
    checkPermissions: () => Promise.resolve({ speechRecognition: 'granted' }),
    requestPermissions: () => Promise.resolve({ speechRecognition: 'granted' }),
    start: (opts) => { mockPlugin._opts = opts; return Promise.resolve(); },
    stop: () => {
      emit('partialResults', { matches: ['你好'] });
      emit('listeningState', { status: 'stopped' });
      return Promise.resolve();
    },
  };
  const cap = capacitorObj ? capacitorObj(mockPlugin) : undefined;
  const prelude = 'var window = __win; var recognition = null; var SR = __SR;';
  const fn = new Function('__win', '__SR', prelude + '\n' + adapterSrc +
    '\nreturn { createRecognizer: createRecognizer, NativeRecognizer: NativeRecognizer, ' +
    'getCAPSR: function(){ return CAP_SR; }, ' +
    'setRecognition: function(r){ recognition = r; } };');
  const api = fn(cap ? { Capacitor: cap } : {}, SRClass || undefined);
  return { api, emit, mockPlugin };
}

const tick = (ms) => new Promise(r => setTimeout(r, ms || 50));

(async () => {
  let pass = 0, fail = 0;
  const ok = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); cond ? pass++ : fail++; };

  // ---- Test 1: native path ----
  const capObj = (mockPlugin) => ({
    isNativePlatform: () => true,
    registerPlugin: (name) => { if (name !== 'SpeechRecognition') throw new Error('bad name'); return mockPlugin; },
  });
  const { api, emit, mockPlugin } = makeEnv(capObj, undefined);
  ok('native: CAP_SR detected', !!api.getCAPSR());
  const rec = api.createRecognizer();
  ok('native: createRecognizer returns NativeRecognizer', rec instanceof api.NativeRecognizer);
  const events = [];
  rec.lang = 'zh-CN';
  // NOTE: page code reads res[0].transcript where res = ev.results[i]
  rec.onresult = (ev) => events.push(['result', ev.results[0][0].transcript, ev.results[0].isFinal, ev.results.length]);
  rec.onerror = (ev) => events.push(['error', ev.error]);
  rec.onend = () => events.push(['end']);
  api.setRecognition(rec); // emulates cycle code: recognition = rec
  rec.start();
  await tick(80);
  ok('native: start called plugin with zh-CN + partialResults', mockPlugin._opts && mockPlugin._opts.language === 'zh-CN' && mockPlugin._opts.partialResults === true && mockPlugin._opts.maxResults === 1);
  emit('partialResults', { matches: ['你好吗'] });
  await tick(20);
  ok('native: interim partial -> onresult interim', events.length === 1 && events[0][0] === 'result' && events[0][1] === '你好吗' && events[0][2] === false);
  rec.abort();
  await tick(80);
  ok('native: abort -> onend fired', events.some(e => e[0] === 'end'));
  ok('native: final partial arrived as interim before end', events.some(e => e[0] === 'result' && e[1] === '你好'));
  const nAfterEnd = events.length;
  emit('partialResults', { matches: ['迟到'] });
  await tick(20);
  ok('native: late partial after end is ignored', events.length === nAfterEnd);

  // ---- Test 2: permission denied ----
  const env2 = makeEnv(capObj, undefined);
  env2.mockPlugin.checkPermissions = () => Promise.resolve({ speechRecognition: 'denied' });
  const rec2 = env2.api.createRecognizer();
  const ev2 = [];
  rec2.onerror = (e) => ev2.push(['error', e.error]);
  rec2.onend = () => ev2.push(['end']);
  env2.api.setRecognition(rec2);
  rec2.start();
  await tick(80);
  ok('native: denied permission -> onerror not-allowed + onend', ev2.length === 2 && ev2[0][1] === 'not-allowed' && ev2[1][0] === 'end');

  // ---- Test 3: browser fallback ----
  class FakeWebSR { constructor() { this.started = false; } start() { this.started = true; } abort() {} }
  const env3 = makeEnv(null, FakeWebSR);
  ok('browser: CAP_SR null without Capacitor', !env3.api.getCAPSR());
  const rec3 = env3.api.createRecognizer();
  ok('browser: createRecognizer returns web SR instance', rec3 instanceof FakeWebSR);

  // ---- Test 4: vi-VN language passed through ----
  const env4 = makeEnv(capObj, undefined);
  const rec4 = env4.api.createRecognizer();
  rec4.lang = 'vi-VN';
  rec4.onresult = () => {}; rec4.onerror = () => {}; rec4.onend = () => {};
  env4.api.setRecognition(rec4);
  rec4.start();
  await tick(80);
  ok('native: vi-VN passed to plugin', env4.mockPlugin._opts && env4.mockPlugin._opts.language === 'vi-VN');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
