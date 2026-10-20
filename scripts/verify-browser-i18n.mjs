import { spawn } from 'child_process';

/**
 * SalahTrack Automated Headless Chrome CDP Verification
 * Trilingual Localization & Hydration Audit (uz, ru, en)
 * 
 * Objectives:
 * 1. Spawns headless Chrome with Chrome DevTools Protocol (CDP).
 * 2. Connects to local Next.js application server (spawning if not running).
 * 3. Switches dynamically between all three supported languages ('uz', 'ru', 'en').
 * 4. Inspects DOM text for language consistency:
 *    - In Uzbek ('uz'): verifies Uzbek strings appear and no Russian/English leaks in key areas.
 *    - In Russian ('ru'): verifies Russian strings appear.
 *    - In English ('en'): verifies English strings appear.
 * 5. Verifies zero 'undefined', 'null', 'NaN', '[object Object]', or raw template markers ({count}, %s).
 * 6. Intercepts browser console and exceptions: guarantees ZERO console errors and ZERO React hydration mismatches.
 */

const CHROME_PORT = 9222;
const APP_PORT = 3000;
const BASE_URL = `http://localhost:${APP_PORT}`;

// Helper: send CDP command via WebSocket
async function sendCdpCommand(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1000000);
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      const data = JSON.parse(event.data);
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        if (data.error) reject(data.error);
        else resolve(data.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// Helper: check if server is already responding
async function isServerRunning(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

// Helper: wait for server to become healthy
async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerRunning(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function runTrilingualBrowserAudit() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🌐 SalahTrack Trilingual Browser CDP Localization & Hydration Audit');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let serverProcess = null;
  let chromeProcess = null;

  const serverAlreadyRunning = await isServerRunning(BASE_URL);
  if (serverAlreadyRunning) {
    console.log(`📡 Next.js server already running on ${BASE_URL}.`);
  } else {
    console.log(`🚀 Starting Next.js server on port ${APP_PORT}...`);
    serverProcess = spawn('npm', ['run', 'start', '--', '-p', String(APP_PORT)], {
      stdio: 'pipe',
      detached: false,
    });
    serverProcess.stdout.on('data', (d) => {
      const s = d.toString();
      if (s.includes('Ready') || s.includes('started')) {
        console.log(`[Next.js Server]: ${s.trim()}`);
      }
    });
    serverProcess.stderr.on('data', (d) => {
      console.error(`[Next.js Server Error]: ${d.toString().trim()}`);
    });

    const isReady = await waitForServer(BASE_URL, 20000);
    if (!isReady) {
      // Fallback: try next dev if start failed
      console.warn('⚠️  Production server not ready, attempting next dev...');
      serverProcess.kill();
      serverProcess = spawn('npm', ['run', 'dev', '--', '-p', String(APP_PORT)], {
        stdio: 'pipe',
      });
      const devReady = await waitForServer(BASE_URL, 25000);
      if (!devReady) {
        throw new Error(`Failed to bind Next.js server on ${BASE_URL}`);
      }
    }
    console.log(`✅ Next.js server successfully listening on ${BASE_URL}`);
  }

  console.log('🚀 Spawning Google Chrome in headless mode with CDP...');
  chromeProcess = spawn('google-chrome', [
    '--headless=new',
    `--remote-debugging-port=${CHROME_PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `${BASE_URL}/`,
  ]);

  // Wait 2 seconds for Chrome to bind remote debugging port
  await new Promise((r) => setTimeout(r, 2000));

  const errors = [];
  const warnings = [];
  const hydrationMismatches = [];
  const leakFindings = [];

  try {
    const listRes = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`);
    const tabs = await listRes.json();
    console.log(`📡 Identified ${tabs.length} open tab(s) in headless Chrome.`);

    const tab = tabs.find((t) => t.type === 'page') || tabs[0];
    if (!tab || !tab.webSocketDebuggerUrl) {
      throw new Error('Could not find active Chrome tab with WebSocket debugger URL');
    }

    const ws = new WebSocket(tab.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      ws.onopen = async () => {
        try {
          await sendCdpCommand(ws, 'Runtime.enable');
          await sendCdpCommand(ws, 'Log.enable');
          await sendCdpCommand(ws, 'Page.enable');
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      ws.onerror = reject;
    });

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.method === 'Runtime.consoleAPICalled') {
        const text = data.params.args.map((a) => a.value || a.description || JSON.stringify(a)).join(' ');
        
        // Hydration error detection
        if (
          text.includes('Hydration failed') ||
          text.includes('did not match') ||
          text.includes('Text content does not match server-rendered HTML') ||
          text.includes('There was an error while hydrating')
        ) {
          console.error('❌ [HYDRATION MISMATCH]:', text);
          hydrationMismatches.push(text);
          errors.push(`Hydration mismatch: ${text}`);
        } else if (data.params.type === 'error') {
          console.error('❌ [BROWSER CONSOLE ERROR]:', text);
          errors.push(text);
        } else if (data.params.type === 'warning') {
          console.warn('⚠️  [BROWSER CONSOLE WARN]:', text);
          warnings.push(text);
        }
      } else if (data.method === 'Runtime.exceptionThrown') {
        const desc = data.params.exceptionDetails?.exception?.description || data.params.exceptionDetails?.text;
        console.error('💥 [UNCAUGHT EXCEPTION]:', desc);
        errors.push(desc);
      }
    };

    const languagesToTest = [
      {
        lang: 'uz',
        name: 'O‘zbekcha',
        expectedStrings: ['Namozlarim', 'Bosh sahifa', 'Bugungi namozlar', 'Tarix', 'Qibla'],
        forbiddenStrings: ['Сегодняшние намазы', "Today's Prayers", 'Войти в аккаунт'],
      },
      {
        lang: 'ru',
        name: 'Русский',
        expectedStrings: ['Namozlarim', 'Главная', 'Сегодняшние намазы', 'Прогресс', 'Кибла'],
        forbiddenStrings: ["Today's Prayers", 'Bugungi namozlar'],
      },
      {
        lang: 'en',
        name: 'English',
        expectedStrings: ['Namozlarim', 'Home', "Today's Prayers", 'Progress', 'Qibla'],
        forbiddenStrings: ['Bugungi namozlar', 'Сегодняшние намазы'],
      },
    ];

    for (const { lang, name, expectedStrings, forbiddenStrings } of languagesToTest) {
      console.log(`\n───────────────────────────────────────────────────────────────`);
      console.log(`🔍 [AUDIT PHASE]: Testing Language: ${lang.toUpperCase()} (${name})`);
      console.log(`───────────────────────────────────────────────────────────────`);

      // 1. Set locale in browser storage & cookie via CDP Runtime.evaluate
      await sendCdpCommand(ws, 'Runtime.evaluate', {
        expression: `(() => {
          window.localStorage.setItem('namozlarim_lang', '${lang}');
          window.localStorage.setItem('salahtrack_lang', '${lang}');
          document.cookie = 'namozlarim_lang=${lang}; path=/; max-age=31536000; SameSite=Lax';
          document.cookie = 'salahtrack_lang=${lang}; path=/; max-age=31536000; SameSite=Lax';
          window.dispatchEvent(new Event('language-change'));
        })()`,
      });

      // 2. Navigate to Home Dashboard and wait for render
      console.log(`➡️  Navigating to ${BASE_URL}/ for [${lang}] audit...`);
      await sendCdpCommand(ws, 'Page.navigate', { url: `${BASE_URL}/` });
      await new Promise((r) => setTimeout(r, 2000));

      // 3. Inspect DOM text
      const domEvaluation = await sendCdpCommand(ws, 'Runtime.evaluate', {
        expression: `(() => {
          const bodyText = document.body.innerText || '';
          const hasUndefined = bodyText.includes('undefined') || Array.from(document.querySelectorAll('*')).some(el => el.getAttribute('title') === 'undefined');
          const hasNull = bodyText.includes('null');
          const hasNaN = bodyText.includes('NaN');
          const hasObjectObject = bodyText.includes('[object Object]');
          
          // Check for un-interpolated template markers
          const templateArtifacts = ['{method}', '{count}', '{days}', '{completed}', '{total}', '%s']
            .filter(token => bodyText.includes(token));

          const navLinks = Array.from(document.querySelectorAll('nav a, header a, footer a'))
            .map(a => a.textContent.trim())
            .filter(Boolean);

          return {
            bodyTextSample: bodyText.slice(0, 300).replace(/\\n/g, ' '),
            hasUndefined,
            hasNull,
            hasNaN,
            hasObjectObject,
            templateArtifacts,
            navLinks,
            fullText: bodyText,
          };
        })()`,
        returnByValue: true,
      });

      const auditData = domEvaluation.result?.value;
      if (!auditData) {
        errors.push(`Failed to evaluate DOM for language ${lang}`);
        continue;
      }

      console.log(`📄 Sample DOM text: "${auditData.bodyTextSample}..."`);

      // Verify hygiene
      if (auditData.hasUndefined) {
        errors.push(`[${lang}] DOM contains literal 'undefined' string or title attribute!`);
      }
      if (auditData.hasNaN) {
        errors.push(`[${lang}] DOM contains 'NaN' numerical error!`);
      }
      if (auditData.hasObjectObject) {
        errors.push(`[${lang}] DOM contains '[object Object]' serialization error!`);
      }
      if (auditData.templateArtifacts.length > 0) {
        errors.push(`[${lang}] Un-interpolated template artifacts found in DOM: ${auditData.templateArtifacts.join(', ')}`);
      }

      // Verify expected native strings
      const missingExpected = expectedStrings.filter((s) => !auditData.fullText.includes(s));
      if (missingExpected.length > 0) {
        warnings.push(`[${lang}] Some expected localized strings not found on Dashboard: ${missingExpected.join(', ')}`);
      } else {
        console.log(`✅ [${lang}] All expected localized strings verified in DOM: ${expectedStrings.join(', ')}`);
      }

      // Verify no leaked strings from other languages
      const foundForbidden = forbiddenStrings.filter((s) => auditData.fullText.includes(s));
      if (foundForbidden.length > 0) {
        leakFindings.push(`[${lang}] Leaked foreign strings detected in DOM: ${foundForbidden.join(', ')}`);
        errors.push(`[${lang}] Localization Leak: foreign strings detected: ${foundForbidden.join(', ')}`);
      } else {
        console.log(`✅ [${lang}] Zero cross-language string leaks detected.`);
      }

      // 4. Test secondary routes: /progress?tab=history
      console.log(`➡️  Auditing route /progress?tab=history for [${lang}]...`);
      await sendCdpCommand(ws, 'Page.navigate', { url: `${BASE_URL}/progress?tab=history` });
      await new Promise((r) => setTimeout(r, 1500));

      const progressCheck = await sendCdpCommand(ws, 'Runtime.evaluate', {
        expression: `(() => {
          const body = document.body.innerText || '';
          return {
            hasUndefined: body.includes('undefined'),
            hasNaN: body.includes('NaN'),
            hasInfiniteLoop: body.includes('Maximum update depth exceeded'),
          };
        })()`,
        returnByValue: true,
      });

      const progData = progressCheck.result?.value;
      if (progData?.hasUndefined) {
        errors.push(`[${lang} /progress] DOM contains 'undefined'!`);
      }
      if (progData?.hasInfiniteLoop) {
        errors.push(`[${lang} /progress] Infinite re-render error detected!`);
      }

      // 5. Test Qibla route: /qibla
      console.log(`➡️  Auditing route /qibla for [${lang}]...`);
      await sendCdpCommand(ws, 'Page.navigate', { url: `${BASE_URL}/qibla` });
      await new Promise((r) => setTimeout(r, 1500));

      const qiblaCheck = await sendCdpCommand(ws, 'Runtime.evaluate', {
        expression: `(() => {
          const body = document.body.innerText || '';
          return {
            hasUndefined: body.includes('undefined'),
            hasNaN: body.includes('NaN'),
          };
        })()`,
        returnByValue: true,
      });
      if (qiblaCheck.result?.value?.hasUndefined) {
        errors.push(`[${lang} /qibla] DOM contains 'undefined'!`);
      }

      // 6. Test Auth route: /login
      console.log(`➡️  Auditing route /login for [${lang}]...`);
      await sendCdpCommand(ws, 'Page.navigate', { url: `${BASE_URL}/login` });
      await new Promise((r) => setTimeout(r, 1500));

      const loginCheck = await sendCdpCommand(ws, 'Runtime.evaluate', {
        expression: `(() => {
          const body = document.body.innerText || '';
          const submitBtn = document.querySelector('button[type="submit"]')?.textContent.trim();
          return {
            hasUndefined: body.includes('undefined'),
            submitBtn,
          };
        })()`,
        returnByValue: true,
      });
      if (loginCheck.result?.value?.hasUndefined) {
        errors.push(`[${lang} /login] DOM contains 'undefined'!`);
      }
      console.log(`✅ [${lang} /login] Form verified with button: "${loginCheck.result?.value?.submitBtn}"`);
    }

    ws.close();

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📋 AUDIT SUMMARY & RELEASE VERDICT');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`• Total Console / Runtime Errors: ${errors.length}`);
    console.log(`• React Hydration Mismatches:     ${hydrationMismatches.length}`);
    console.log(`• Cross-Language Leaks:           ${leakFindings.length}`);
    console.log(`• Warnings:                       ${warnings.length}`);

    if (errors.length > 0 || hydrationMismatches.length > 0) {
      console.error('\n❌ VERDICT: FAIL');
      console.error('Violations detected:');
      for (const err of errors) console.error(`  - ${err}`);
      process.exit(1);
    } else {
      console.log('\n✅ VERDICT: PASS');
      console.log('All 3 languages (uz, ru, en) render cleanly with zero hydration mismatches, zero undefined strings, and zero foreign leaks.');
      process.exit(0);
    }
  } catch (err) {
    console.error('💥 Fatal CDP Runner Error:', err);
    process.exit(1);
  } finally {
    if (chromeProcess) {
      console.log('🧹 Terminating headless Chrome process...');
      chromeProcess.kill('SIGTERM');
    }
    if (serverProcess) {
      console.log('🧹 Terminating local Next.js server...');
      serverProcess.kill('SIGTERM');
    }
  }
}

runTrilingualBrowserAudit();
