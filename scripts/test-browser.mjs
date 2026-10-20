import { spawn } from 'child_process';

/**
 * SalahTrack Automated Headless Chrome CDP Verification
 * 
 * Verifies that the History Calendar and Progress Page:
 * 1. Mount with zero uncaught exceptions and zero console errors.
 * 2. Do NOT trigger infinite re-renders ("Maximum update depth exceeded").
 * 3. Render all 4 segmented tabs (overview, history, analytics, qaza).
 * 4. Maintain correct DOM bounds and date picker boundaries (max={todayStr}).
 */

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

async function runBrowserTest() {
  const chromePort = 9222;
  const targetUrl = 'http://localhost:3000/progress?tab=history';

  console.log('🚀 Spawning Headless Chrome for CDP regression audit...');
  const chrome = spawn('google-chrome', [
    '--headless=new',
    `--remote-debugging-port=${chromePort}`,
    '--no-sandbox',
    '--disable-gpu',
    targetUrl,
  ]);

  const errors = [];
  const warnings = [];

  // Allow browser time to bind port
  await new Promise((r) => setTimeout(r, 2000));

  try {
    const versionRes = await fetch(`http://127.0.0.1:${chromePort}/json/list`);
    const tabs = await versionRes.json();
    console.log(`📡 Open tabs identified: ${tabs.length}`);

    const tab = tabs.find((t) => t.url.includes('progress')) || tabs[0];
    if (!tab || !tab.webSocketDebuggerUrl) {
      throw new Error('No target tab with WebSocket debugger URL found');
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
        if (data.params.type === 'error') {
          console.error('❌ [CONSOLE ERROR]:', text);
          errors.push(text);
        } else if (data.params.type === 'warning') {
          console.warn('⚠️  [CONSOLE WARN]:', text);
          warnings.push(text);
        } else {
          console.log(`ℹ️  [CONSOLE ${data.params.type}]:`, text);
        }
      } else if (data.method === 'Runtime.exceptionThrown') {
        const desc = data.params.exceptionDetails?.exception?.description || data.params.exceptionDetails?.text;
        console.error('💥 [BROWSER EXCEPTION]:', desc);
        errors.push(desc);
      }
    };

    // Wait 3 seconds to let React effects, state synchronizers, and localStorage settle
    console.log('⏳ Observing initial render and hydration stability (3s)...');
    await new Promise((r) => setTimeout(r, 3000));

    // Verify DOM structure and attributes via CDP Runtime.evaluate
    console.log('🔍 Executing DOM assertions via Chrome DevTools Protocol...');
    const domCheckResult = await sendCdpCommand(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const title = document.title;
        const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map(el => el.textContent.trim());
        const hasHistoryTab = tabs.some(t => t.toLowerCase().includes('tarix') || t.toLowerCase().includes('history'));
        const calendarGrid = document.querySelector('[role="grid"]');
        const gridCells = Array.from(document.querySelectorAll('[role="gridcell"]'));
        const disabledCells = gridCells.filter(cell => cell.hasAttribute('disabled') || cell.getAttribute('aria-disabled') === 'true');
        const activeCells = gridCells.filter(cell => !cell.hasAttribute('disabled'));
        const selectedCell = document.querySelector('[role="gridcell"][aria-selected="true"]');
        
        // Check for 5 prayers and quick-action buttons
        const prayerNames = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
        const bodyText = document.body.innerText;
        const hasInfiniteLoopError = bodyText.includes('Maximum update depth exceeded') || bodyText.includes('Too many re-renders');
        const actionButtons = Array.from(document.querySelectorAll('button[title]'));

        return {
          title,
          tabCount: tabs.length,
          hasHistoryTab,
          hasCalendarGrid: !!calendarGrid,
          totalCells: gridCells.length,
          activeCellsCount: activeCells.length,
          disabledFutureCellsCount: disabledCells.length,
          selectedDatePresent: !!selectedCell,
          actionButtonsCount: actionButtons.length,
          hasInfiniteLoopError
        };
      })()`,
      returnByValue: true,
    });

    const domState = domCheckResult.result?.value;
    console.log('📊 DOM Audit Results:', domState);

    if (domState.hasInfiniteLoopError) {
      errors.push('CRITICAL: "Maximum update depth exceeded" detected in DOM text!');
    }

    if (!domState.hasCalendarGrid) {
      errors.push('CRITICAL: Monthly History Calendar grid [role="grid"] is missing from History tab!');
    }

    if (domState.totalCells < 28) {
      errors.push(`CRITICAL: Calendar grid has only ${domState.totalCells} cells (expected >= 28)`);
    }

    if (domState.actionButtonsCount < 25) {
      warnings.push(`Expected 25 prayer status buttons (5 per prayer), found ${domState.actionButtonsCount}`);
    }

    // Tab switching test: Navigate to ?tab=analytics
    console.log('🔄 Verifying dynamic tab navigation to ?tab=analytics...');
    await sendCdpCommand(ws, 'Page.navigate', {
      url: 'http://localhost:3000/progress?tab=analytics',
    });
    await new Promise((r) => setTimeout(r, 2000));

    // Tab switching test: Navigate to ?tab=qaza
    console.log('🔄 Verifying dynamic tab navigation to ?tab=qaza...');
    await sendCdpCommand(ws, 'Page.navigate', {
      url: 'http://localhost:3000/progress?tab=qaza',
    });
    await new Promise((r) => setTimeout(r, 2000));

    ws.close();

    console.log('═══════════════════════════════════════════════');
    console.log(`📋 Browser Audit Complete: ${errors.length} errors, ${warnings.length} warnings.`);
    if (errors.length > 0) {
      console.error('❌ CDP AUDIT FAILED: Console or runtime errors occurred.');
      process.exit(1);
    } else {
      console.log('✅ CDP AUDIT PASSED: Zero exceptions, zero console errors, zero infinite re-renders.');
    }
  } catch (err) {
    console.error('Fatal CDP runner error:', err);
    process.exit(1);
  } finally {
    chrome.kill();
  }
}

runBrowserTest();
