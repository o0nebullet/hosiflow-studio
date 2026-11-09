// HosiFlow Companion - Google Flow Music Content Script Adapter v1.5.0
// Tự động hóa nhập prompt, tự động chọn tùy chọn AI Producer & trích xuất cả 2 phiên bản âm thanh từ https://www.flowmusic.app

(() => {
  console.log('[HosiFlow FlowMusic Adapter] 🚀 Khởi động FlowMusic Content Script Adapter v1.5.0 (Dual-Version Capture & Robust Submit)');

  const activeGenerations = new Map();
  const discoveredTracks = new Map(); // uuid -> title

  if (!window.__interceptedAudioUrls) {
    window.__interceptedAudioUrls = new Set();
  }
  const interceptedAudioUrls = window.__interceptedAudioUrls;
  let lastOptionClickTime = 0;
  let lastSecondTrackClickTime = 0;

  // 1. Tiêm script vào Page World (nơi React & FlowMusic app chạy) để hook fetch, XHR, và Audio
  if (!window.__flowMusicInjected) {
    window.__flowMusicInjected = true;
    try {
      const script = document.createElement('script');
      script.textContent = `
        (() => {
          if (window.__flowMusicPageHooked) return;
          window.__flowMusicPageHooked = true;

          function reportClip(url, title) {
            if (!url || typeof url !== 'string') return;
            const m = url.match(/clips\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(m4a|wav|mp3)/i);
            if (m) {
              const fullUrl = url.startsWith('http') ? url : ('https://storage.googleapis.com/producer-app-public/' + url.replace(/^\/+/, ''));
              window.postMessage({
                type: '__FLOWMUSIC_TRACK_DISCOVERED',
                uuid: m[1].toLowerCase(),
                url: fullUrl,
                title: typeof title === 'string' ? title.trim() : ''
              }, '*');
            }
          }

          function scanObject(obj) {
            if (!obj || typeof obj !== 'object') return;
            const visited = new Set();
            function walk(cur) {
              if (!cur || typeof cur !== 'object' || visited.has(cur)) return;
              visited.add(cur);
              if (Array.isArray(cur)) {
                for (const item of cur) walk(item);
                return;
              }
              const audioUrl = cur.audio_url || cur.audioUrl || cur.wav_url || cur.wavUrl || cur.url;
              const title = cur.title || cur.name || '';
              if (audioUrl && typeof audioUrl === 'string' && (audioUrl.includes('producer-app-public/clips/') || audioUrl.includes('clips/'))) {
                reportClip(audioUrl, title);
              }
              for (const [k, v] of Object.entries(cur)) {
                if (typeof v === 'string' && v.includes('clips/')) {
                  reportClip(v, title);
                } else if (typeof v === 'object') {
                  walk(v);
                }
              }
            }
            try { walk(obj); } catch {}
          }

          // Hook window.fetch để bắt dữ liệu API trả về (hỗ trợ cả JSON và text streaming)
          const origFetch = window.fetch;
          window.fetch = async function(...args) {
            const resp = await origFetch.apply(this, args);
            try {
              const clone = resp.clone();
              clone.text().then(text => {
                if (!text) return;
                // 1. Quét JSON nếu có
                try {
                  const data = JSON.parse(text);
                  scanObject(data);
                } catch {}
                // 2. Quét regex trực tiếp mọi chuỗi clips/{uuid}.m4a trong response text
                const clipMatches = text.matchAll(/clips\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(m4a|wav|mp3)/gi);
                for (const cm of clipMatches) {
                  reportClip('https://storage.googleapis.com/producer-app-public/clips/' + cm[1].toLowerCase() + '.' + cm[2].toLowerCase(), '');
                }
                // 3. Quét /song/{uuid} trong response text
                const songMatches = text.matchAll(/\/song\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/gi);
                for (const sm of songMatches) {
                  reportClip('https://storage.googleapis.com/producer-app-public/clips/' + sm[1].toLowerCase() + '.m4a', '');
                }
              }).catch(() => {});
            } catch {}
            return resp;
          };

          // Hook XMLHttpRequest
          const origXhrSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('load', function() {
              try {
                const text = this.responseText;
                if (!text) return;
                const clipMatches = text.matchAll(/clips\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(m4a|wav|mp3)/gi);
                for (const cm of clipMatches) {
                  reportClip('https://storage.googleapis.com/producer-app-public/clips/' + cm[1].toLowerCase() + '.' + cm[2].toLowerCase(), '');
                }
              } catch {}
            });
            return origXhrSend.apply(this, args);
          };

          // Hook Audio playback trong page world
          const origPlay = HTMLMediaElement.prototype.play;
          HTMLMediaElement.prototype.play = function(...args) {
            const src = this.currentSrc || this.src;
            if (src && typeof src === 'string') {
              reportClip(src, '');
            }
            return origPlay.apply(this, args);
          };

          // Hook Audio src setter trong page world
          const origSrcSet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')?.set;
          if (origSrcSet) {
            Object.defineProperty(HTMLMediaElement.prototype, 'src', {
              set(val) {
                if (val && typeof val === 'string') {
                  reportClip(val, '');
                }
                return origSrcSet.call(this, val);
              }
            });
          }
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {
      console.warn('[HosiFlow FlowMusic Adapter] In-page injection notice:', e);
    }
  }

  // Lắng nghe track từ In-Page Engine (flowmusic-inpage.js)
  window.addEventListener('message', (event) => {
    if (event.data?.type === '__FLOWMUSIC_TRACK_DISCOVERED' && event.data.url) {
      const uuid = (event.data.uuid || '').toLowerCase().trim();
      const url = event.data.url.trim();
      const title = event.data.title || '';
      const key = uuid || url;
      if (!discoveredTracks.has(key)) {
        console.log('[HosiFlow FlowMusic Adapter] 📡 Bắt được track từ In-Page Engine:', key, title, url);
        discoveredTracks.set(key, { id: uuid || key, url, title, timestamp: Date.now() });
      }
    }
  });

  // 2. Hook HTMLMediaElement & Audio trong Content Script
  if (!window.__flowMusicAudioHooked) {
    window.__flowMusicAudioHooked = true;
    try {
      const origPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...args) {
        const src = this.currentSrc || this.src;
        if (src && !src.startsWith('data:image')) {
          interceptedAudioUrls.add(src);
          console.log('[HosiFlow FlowMusic Adapter] 🎧 Hooked Audio Playback Src:', src);
        }
        return origPlay.apply(this, args);
      };

      const origSrcSet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')?.set;
      if (origSrcSet) {
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
          set(value) {
            if (
              value &&
              typeof value === 'string' &&
              (value.includes('.mp3') ||
                value.includes('.wav') ||
                value.includes('.m4a') ||
                value.startsWith('blob:') ||
                value.includes('storage.googleapis.com') ||
                value.includes('producer-app-public') ||
                value.includes('audio'))
            ) {
              interceptedAudioUrls.add(value);
              console.log('[HosiFlow FlowMusic Adapter] 🎧 Hooked Audio Src Setter:', value);
            }
            return origSrcSet.call(this, value);
          },
        });
      }
    } catch (hookErr) {
      console.warn('[HosiFlow FlowMusic Adapter] Audio hook notice:', hookErr);
    }
  }

  // 3. Lắng nghe Message từ Background Service Worker
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'FLOWMUSIC_CHECK_SESSION') {
      const composer = findComposerElement();
      sendResponse({
        ok: true,
        composerFound: Boolean(composer),
        title: document.title,
        url: location.href,
      });
      return false;
    }

    if (message?.type === 'FLOWMUSIC_GENERATE') {
      console.log('[HosiFlow FlowMusic Adapter] 📥 Nhận lệnh tạo nhạc mới:', message);

      const controller = new AbortController();
      activeGenerations.set(message.requestId, controller);

      sendResponse({ ok: true, started: true });

      runGenerationTask(message, controller.signal)
        .then((result) => {
          console.log('[HosiFlow FlowMusic Adapter] 🎯 Hoàn tất tạo nhạc thành công:', result);
          chrome.runtime.sendMessage({
            type: 'FLOWMUSIC_JOB_COMPLETED',
            jobId: message.requestId,
            nodeId: message.nodeId,
            ok: true,
            duration: message.duration || 5,
            url: result.url,
            title: result.title,
            versions: result.versions || [],
          });
        })
        .catch((error) => {
          console.error('[HosiFlow FlowMusic Adapter] ❌ Lỗi tạo nhạc:', error);
          chrome.runtime.sendMessage({
            type: 'FLOWMUSIC_JOB_COMPLETED',
            jobId: message.requestId,
            nodeId: message.nodeId,
            ok: false,
            duration: message.duration || 5,
            error: error.message || String(error),
          });
        })
        .finally(() => {
          activeGenerations.delete(message.requestId);
        });

      return false;
    }

    if (message?.type === 'FLOWMUSIC_ABORT') {
      const controller = activeGenerations.get(message.requestId);
      if (controller) {
        controller.abort();
        activeGenerations.delete(message.requestId);
      }
      sendResponse({ ok: true });
      return false;
    }
  });

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new DOMException('Tác vụ bị người dùng hủy.', 'AbortError'));
          },
          { once: true }
        );
      }
    });
  }

  function isInteractive(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      !el.disabled &&
      !el.getAttribute('aria-disabled')
    );
  }

  // TỰ ĐỘNG ĐÓNG CÁC POPUP / MODAL LÀM KHÓA GIAO DIỆN (ví dụ: "Customize Producer", "PRESS TO TALK" Voice Bar)
  function autoDismissBlockingModals() {
    // 1. Đóng modal toàn màn hình
    const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"], div[class*="modal"]');
    dialogs.forEach((dlg) => {
      const heading = dlg.querySelector('h1, h2, h3, div[class*="title"], div[class*="header"]');
      const text = (heading?.innerText || dlg.innerText || '').toLowerCase();
      if (text.includes('customize producer') || text.includes('tiến độ') || text.includes('progress')) {
        const closeBtn =
          dlg.querySelector('button[aria-label*="close" i]') ||
          dlg.querySelector('button[aria-label*="đóng" i]') ||
          dlg.querySelector('button svg path[d*="M19 6.41"]')?.closest('button') ||
          [...dlg.querySelectorAll('button')].find((b) => {
            const t = (b.innerText || b.textContent || '').trim();
            return t === '✕' || t === '×' || t === 'x' || t === 'X';
          });

        if (closeBtn && isInteractive(closeBtn)) {
          console.log('[HosiFlow FlowMusic Adapter] 🛡️ Tự động đóng modal chắn màn hình:', text.slice(0, 30));
          closeBtn.click();
        }
      }
    });

    // 2. Tự động đóng thanh Voice Microphone "PRESS TO TALK" nếu xuất hiện
    const voiceBars = document.querySelectorAll('div, [role="region"], [role="toolbar"]');
    for (const vb of voiceBars) {
      const txt = (vb.innerText || '').toLowerCase();
      if (txt.includes('press to talk') || txt.includes('nhấn để nói')) {
        const redCloseBtn =
          vb.querySelector('button[class*="red"], button[style*="red"], button[style*="#dc2626"]') ||
          [...vb.querySelectorAll('button')].find((b) => {
            const bg = window.getComputedStyle(b).backgroundColor || '';
            const html = b.innerHTML.toLowerCase();
            return bg.includes('rgb(2') || html.includes('x') || html.includes('✕') || html.includes('d*="18 6l6 18"');
          });

        if (redCloseBtn && isInteractive(redCloseBtn)) {
          console.log('[HosiFlow FlowMusic Adapter] 🎙️ Tự động đóng thanh Voice Mic ("PRESS TO TALK"):', redCloseBtn);
          redCloseBtn.click();
          break;
        }
      }
    }
  }

  // TÌM Ô SOẠN THẢO PROMPT
  function findComposerElement() {
    const selectors = [
      'textarea[placeholder*="music" i]',
      'textarea[placeholder*="song" i]',
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="nhạc" i]',
      'textarea[placeholder*="tạo" i]',
      'textarea[placeholder*="describe" i]',
      'div[contenteditable="true"][data-placeholder*="music" i]',
      'div[contenteditable="true"][data-placeholder*="prompt" i]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea',
    ];

    for (const sel of selectors) {
      const candidates = document.querySelectorAll(sel);
      for (const el of candidates) {
        if (!isInteractive(el)) continue;
        if (el.closest('nav, aside, header, div[class*="sidebar"], div[class*="menu"]')) continue;
        const placeholder = (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '').toLowerCase();
        if (placeholder.includes('search') || placeholder.includes('tìm kiếm')) continue;
        return el;
      }
    }
    return null;
  }

  // PHÁT SỰ KIỆN PHÍM ENTER ĐẦY ĐỦ THUỘC TÍNH
  function dispatchEnterKey(el) {
    if (!el) return;
    el.focus();
    const eventParams = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      charCode: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', eventParams));
    el.dispatchEvent(new KeyboardEvent('keypress', eventParams));
    el.dispatchEvent(new KeyboardEvent('keyup', eventParams));
  }

  // KIỂM TRA PHẢI NÚT MICROPHONE / VOICE HAY CÔNG CỤ PHỤ KHÔNG (LOẠI BỎ TRIỆT ĐỂ)
  function isMicOrToolButton(btn) {
    if (!btn) return true;
    const aria = (btn.getAttribute('aria-label') || btn.title || '').toLowerCase();
    const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
    const html = btn.outerHTML.toLowerCase();

    // Loại trừ Microphone / Voice
    if (
      aria.includes('mic') ||
      aria.includes('voice') ||
      aria.includes('talk') ||
      aria.includes('record') ||
      aria.includes('audio') ||
      aria.includes('nói') ||
      aria.includes('thoại') ||
      text.includes('talk') ||
      text.includes('mic') ||
      html.includes('microphone') ||
      html.includes('press to talk') ||
      btn.querySelector('svg path[d*="12 1a3 3 0 0 0-3 3v8"]')
    ) {
      return true;
    }

    // Loại trừ các công cụ khác (đính kèm, cài đặt, menu)
    if (
      aria.includes('attach') ||
      aria.includes('file') ||
      aria.includes('image') ||
      aria.includes('upload') ||
      aria.includes('setting') ||
      aria.includes('cài đặt') ||
      aria.includes('help') ||
      aria.includes('more') ||
      aria.includes('plus') ||
      text === '+' ||
      text === 'p'
    ) {
      return true;
    }

    return false;
  }

  // TÌM CHÍNH XÁC NÚT SUBMIT DUY NHẤT (LOẠI TRỪ 100% NÚT MIC/VOICE/ATTACH)
  function findBestSubmitButton(composer) {
    if (!composer) return null;

    // 1. Kiểm tra trong form
    const form = composer.form || composer.closest('form');
    if (form) {
      const formBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (formBtn && isInteractive(formBtn) && !isMicOrToolButton(formBtn)) return formBtn;
    }

    // 2. Tìm trong container cha của ô soạn thảo (mở rộng lên 5 cấp cha)
    let container = composer.parentElement;
    for (let depth = 0; depth < 5; depth++) {
      if (!container || container === document.body) break;

      const buttons = [...container.querySelectorAll('button, [role="button"]')].filter((btn) => {
        if (!isInteractive(btn)) return false;
        if (btn.closest('nav, aside, header, div[class*="sidebar"], div[class*="menu"]')) return false;
        if (isMicOrToolButton(btn)) return false;
        return true;
      });

      // Ưu tiên 1: Nút có type="submit"
      const submitType = buttons.find((b) => (b.getAttribute('type') || '').toLowerCase() === 'submit');
      if (submitType) return submitType;

      // Ưu tiên 2: Nút có nhãn rõ ràng
      const namedBtn = buttons.find((b) => {
        const aria = (b.getAttribute('aria-label') || b.title || '').toLowerCase();
        const text = (b.innerText || b.textContent || '').trim().toLowerCase();
        return (
          aria.includes('send') ||
          aria.includes('gửi') ||
          aria.includes('submit') ||
          aria.includes('generate') ||
          aria.includes('tạo') ||
          text.includes('send') ||
          text.includes('generate') ||
          text.includes('gửi') ||
          text.includes('tạo')
        );
      });
      if (namedBtn) return namedBtn;

      // Ưu tiên 3: Nút chứa icon mũi tên gửi (ArrowUp / Send)
      const arrowBtn = buttons.find((b) => {
        const svg = b.querySelector('svg');
        if (!svg) return false;
        const html = b.innerHTML.toLowerCase();
        return (
          html.includes('arrow') ||
          html.includes('send') ||
          b.querySelector('svg polygon') ||
          b.querySelector('svg path[d*="M2.01 21L23 12"]') ||
          b.querySelector('svg path[d*="M12 19V5"]') ||
          b.querySelector('svg path[d*="M5 12l7-7 7 7"]')
        );
      });
      if (arrowBtn) return arrowBtn;

      container = container.parentElement;
    }

    return null;
  }

  // ĐIỀN NỘI DUNG PROMPT CHUẨN XÁC ĐỒNG BỘ VỚI REACT STATE
  function injectPromptText(el, text) {
    el.focus();

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // 1. Reset React internal _valueTracker để React không bỏ qua sự kiện input
      if (el._valueTracker) {
        el._valueTracker.setValue('');
      }

      const nativeSetter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(el, text);
      } else {
        el.value = text;
      }

      // 2. Dispatch InputEvent chuẩn W3C
      try {
        el.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: text,
          })
        );
      } catch {}

      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
    }

    // 3. Sử dụng execCommand('insertText') để mô phỏng gõ phím thật từ trình duyệt (React 100% bắt được)
    try {
      if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
      }
    } catch {}

    if (el.isContentEditable) {
      el.innerText = text;
      try {
        el.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: text,
          })
        );
      } catch {}
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
    }

    console.log('[HosiFlow FlowMusic Adapter] ✍️ Đã điền prompt thành công vào composer:', text.slice(0, 60) + '...');
  }

  // TỰ ĐỘNG CHỌN TÙY CHỌN TRẮC NGHIỆM CỦA PRODUCER (1, 2, 3)
  function autoSelectInteractiveChoice() {
    const now = Date.now();
    if (now - lastOptionClickTime < 1800) return false;

    const allButtonsAndDivs = [...document.querySelectorAll('button, [role="button"], li, div[class*="choice"], div[class*="option"]')];

    for (const el of allButtonsAndDivs) {
      if (!isInteractive(el)) continue;
      if (el.tagName === 'A' || el.closest('nav, aside, header, div[class*="sidebar"], div[class*="nav"], div[class*="menu"]')) continue;
      if (el.closest('[role="dialog"], [aria-modal="true"]')) continue;

      const text = (el.innerText || el.textContent || '').trim();
      if (!text || text === 'x' || text === '×') continue;

      if (
        text.startsWith('1\t') ||
        text.startsWith('1\n') ||
        text.startsWith('1 ') ||
        text.startsWith('1.') ||
        /^1\s*[\n\r\t]/.test(text)
      ) {
        console.log('[HosiFlow FlowMusic Adapter] 🎯 Tự động chọn Option 1 của AI Producer:', text.replace(/\n/g, ' '));
        el.click();
        lastOptionClickTime = now;
        return true;
      }
    }

    return false;
  }

  // Helper kiểm tra UUID chuẩn
  function isValidUuid(str) {
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(str);
  }

  // KIỂM TRA XEM FLOWMUSIC CÓ ĐANG TRONG TIẾN TRÌNH GENERATE (% / Generating / Creating) HAY KHÔNG
  function isFlowGenerating() {
    const text = document.body.innerText || '';
    if (/\b\d{1,2}%\b/.test(text)) return true;
    if (/Generating\s+/i.test(text)) return true;
    if (/Creating\s+/i.test(text)) return true;
    const progressEl = document.querySelector('[role="progressbar"], [class*="progress"], div[class*="generating"]');
    if (progressEl) return true;
    return false;
  }

  // TRÍCH XUẤT TẤT CẢ CÁC BÀI HÁT HỢP LỆ TỪ GIAO DIỆN & NETWORK (THỤ ĐỘNG - KHÔNG CLICK GÂY ỒN)
  function extractFlowMusicSongs() {
    const songs = [];
    const seenUuids = new Set();
    const seenUrls = new Set();

    function addSong(uuid, rawUrl, rawTitle) {
      if (!rawUrl && !uuid) return;
      const cleanUuid = uuid ? String(uuid).toLowerCase().trim() : '';
      let cleanUrl = rawUrl ? String(rawUrl).trim() : '';

      if (!cleanUrl && isValidUuid(cleanUuid)) {
        cleanUrl = 'https://storage.googleapis.com/producer-app-public/clips/' + cleanUuid + '.m4a';
      }
      if (!cleanUrl) return;

      const dedupeKey = cleanUuid || cleanUrl;
      if (seenUuids.has(dedupeKey) || seenUrls.has(cleanUrl)) return;
      seenUuids.add(dedupeKey);
      seenUrls.add(cleanUrl);

      const title = rawTitle ? rawTitle.trim() : '';
      songs.push({ id: cleanUuid || `song_${songs.length + 1}`, title, url: cleanUrl });
    }

    // 1. Quét discoveredTracks (từ In-Page Engine: TextDecoder, fetch, audio_play, src_setter)
    for (const [key, item] of discoveredTracks.entries()) {
      if (item && item.url) {
        addSong(item.id || key, item.url, item.title);
      }
    }

    // 2. Quét thẻ <audio> trong DOM
    document.querySelectorAll('audio').forEach((el) => {
      const src = el.src || el.currentSrc || el.getAttribute('src');
      if (src && (src.includes('clips/') || src.startsWith('blob:'))) {
        const m = src.match(/clips\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(m4a|wav|mp3)/i);
        const uuid = m ? m[1].toLowerCase() : '';
        addSong(uuid, src, '');
      }
    });

    // 3. Quét network performance entries
    try {
      const entries = performance.getEntriesByType('resource');
      for (const e of entries) {
        if (e.name && (e.name.includes('producer-app-public/clips/') || e.name.includes('/clips/'))) {
          const m = e.name.match(/clips\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(m4a|wav|mp3)/i);
          if (m) {
            const uuid = m[1].toLowerCase();
            addSong(uuid, 'https://storage.googleapis.com/producer-app-public/clips/' + uuid + '.m4a', '');
          }
        }
      }
    } catch {}

    // 4. Quét link /song/{uuid} trên trang
    document.querySelectorAll('a[href*="/song/"]').forEach((a) => {
      const href = a.getAttribute('href') || a.href || '';
      const m = href.match(/\/song\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
      if (m) {
        const uuid = m[1].toLowerCase();
        const text = (a.innerText || a.textContent || '').trim().split('\n')[0];
        addSong(uuid, 'https://storage.googleapis.com/producer-app-public/clips/' + uuid + '.m4a', text);
      }
    });

    return songs;
  }

  // Quy trình thực thi tạo nhạc (Thuần thụ động, 1 Version duy nhất, không bấm Play/Pause nhạc cũ)
  async function runGenerationTask(params, signal) {
    const { prompt, timeoutSec = 240 } = params;

    console.log('[HosiFlow FlowMusic Adapter] 🔍 Đang tìm ô soạn thảo âm nhạc...');
    let composer = null;
    const findStart = Date.now();
    while (Date.now() - findStart < 15000) {
      if (signal?.aborted) throw new DOMException('Tác vụ bị người dùng hủy.', 'AbortError');
      composer = findComposerElement();
      if (composer) break;
      await delay(400, signal);
    }

    if (!composer) {
      throw new Error(
        'Không tìm thấy ô nhập prompt trên FlowMusic. Vui lòng đảm bảo bạn đang ở trang tạo nhạc và đã đăng nhập FlowMusic (https://www.flowmusic.app).'
      );
    }

    // 2. Ghi nhận trạng thái TRƯỚC KHI gửi prompt
    const beforeSongs = extractFlowMusicSongs();
    const beforeUrls = new Set(beforeSongs.map((s) => s.url));
    const beforeUuids = new Set(beforeSongs.map((s) => s.id));
    console.log(`[HosiFlow FlowMusic Adapter] 📋 Trạng thái trước khi gửi: ${beforeSongs.length} songs đã biết`);

    // 3. Điền prompt
    injectPromptText(composer, prompt);
    await delay(600, signal);

    // 4. Kích hoạt Submit phối hợp đa cơ chế (Submit button, Enter, Form requestSubmit)
    console.log('[HosiFlow FlowMusic Adapter] 🚀 Bắt đầu kích hoạt Submit prompt...');
    let isSubmitted = false;
    const initialText = (composer.value || composer.innerText || '').trim();

    for (let attempt = 1; attempt <= 6; attempt++) {
      if (signal?.aborted) throw new DOMException('Tác vụ bị người dùng hủy.', 'AbortError');
      console.log(`[HosiFlow FlowMusic Adapter] ⚡ Kích hoạt Submit lần ${attempt}...`);

      const submitBtn = findBestSubmitButton(composer);
      if (submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true') {
        console.log('[HosiFlow FlowMusic Adapter] 👉 Click nút submit chính xác:', submitBtn);
        submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        submitBtn.click();
      }

      dispatchEnterKey(composer);

      const form = composer.form || composer.closest('form');
      if (form) {
        try {
          form.requestSubmit();
        } catch {
          try {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          } catch {}
        }
      }

      await delay(600, signal);

      const currentVal = (composer.value || composer.innerText || '').trim();
      if (!currentVal || currentVal !== initialText) {
        console.log('[HosiFlow FlowMusic Adapter] ✅ Prompt đã được gửi thành công vào FlowMusic!');
        isSubmitted = true;
        break;
      }
    }

    // 5. Chờ FlowMusic sinh nhạc hoàn tất (Hoàn toàn thụ động - KHÔNG click play/pause)
    console.log('[HosiFlow FlowMusic Adapter] ⏳ Đang đợi FlowMusic sinh nhạc mới (chế độ thụ động)...');
    const deadline = Date.now() + timeoutSec * 1000;
    let sawGenerating = false;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new DOMException('Tác vụ bị người dùng hủy.', 'AbortError');

      autoDismissBlockingModals();
      autoSelectInteractiveChoice();

      const currentlyGenerating = isFlowGenerating();
      if (currentlyGenerating) {
        sawGenerating = true;
      }

      // Quét các bài hát mới xuất hiện
      const currentSongs = extractFlowMusicSongs();
      const newSongs = currentSongs.filter((s) => !beforeUrls.has(s.url) && !beforeUuids.has(s.id));

      if (newSongs.length >= 1) {
        // Nếu AI đã sinh xong hoặc đã có URL nhạc mới
        const chosen = newSongs[0];

        // Lấy tiêu đề hiển thị nếu có
        let trackTitle = chosen.title;
        if (!trackTitle) {
          const titleEls = [...document.querySelectorAll('h1, h2, h3, div[class*="title"], div[class*="name"]')];
          const lastTitle = titleEls.slice(-3).map((el) => (el.innerText || '').trim()).find((t) => t && t.length < 50 && !t.includes('\n'));
          trackTitle = lastTitle || 'Nhạc Nền FlowMusic';
        }

        console.log('[HosiFlow FlowMusic Adapter] 🎯 ĐÃ LẤY THÀNH CÔNG 1 PHIÊN BẢN NHẠC MỚI:', chosen.url, trackTitle);
        return {
          url: chosen.url,
          title: trackTitle,
          versions: [
            { id: chosen.id, title: trackTitle, url: chosen.url },
          ],
        };
      }

      if (sawGenerating) {
        console.log('[HosiFlow FlowMusic Adapter] ⏳ AI Producer đang tiến hành tạo nhạc... Vui lòng đợi.');
      }

      await delay(1000, signal);
    }

    throw new Error(`Quá thời gian chờ (${timeoutSec}s) khi sinh nhạc trên Google Flow Music.`);
  }
})();
