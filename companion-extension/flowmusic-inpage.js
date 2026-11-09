// HosiFlow Companion - FlowMusic In-Page Engine v1.5.7
// Chạy trực tiếp trong Page World (MAIN) tại document_start để bắt chính xác 100% audio streams & API data

(() => {
  if (window.__flowMusicInPageEngineLoaded) return;
  window.__flowMusicInPageEngineLoaded = true;

  console.log('[HosiFlow In-Page Engine] 🚀 FlowMusic In-Page Passive Engine v1.5.7 đã nạp trong MAIN world');

  const reportedUuids = new Set();
  const reportedUrls = new Set();

  function isValidUuid(str) {
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(str);
  }

  function reportTrack(uuid, rawUrl, title, source) {
    if (!uuid && !rawUrl) return;
    const cleanUuid = uuid ? String(uuid).toLowerCase().trim() : '';
    let finalUrl = rawUrl ? String(rawUrl).trim() : '';

    if (!finalUrl && isValidUuid(cleanUuid)) {
      finalUrl = 'https://storage.googleapis.com/producer-app-public/clips/' + cleanUuid + '.m4a';
    }

    if (!finalUrl) return;

    // Chỉ nhận URL thực sự là clip âm thanh Google Flow Music hoặc blob
    const isGcsClip = finalUrl.includes('producer-app-public/clips/') || finalUrl.includes('clips/');
    const isBlob = finalUrl.startsWith('blob:');
    if (!isGcsClip && !isBlob) return;

    const dedupeKey = cleanUuid || finalUrl;
    if (reportedUuids.has(dedupeKey) || reportedUrls.has(finalUrl)) return;
    reportedUuids.add(dedupeKey);
    reportedUrls.add(finalUrl);

    console.log(`[HosiFlow In-Page Engine] 🎯 Bắt được track (${source}):`, cleanUuid, title || '', finalUrl);

    window.postMessage({
      type: '__FLOWMUSIC_TRACK_DISCOVERED',
      uuid: cleanUuid,
      url: finalUrl,
      title: typeof title === 'string' ? title.trim() : '',
      source: source || 'unknown',
    }, '*');
  }

  // 1. Hook HTMLMediaElement.prototype.play (Bắt 100% URL khi bài hát phát tự nhiên)
  try {
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function(...args) {
      const src = this.currentSrc || this.src;
      if (src && typeof src === 'string') {
        const m = src.match(/clips\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(m4a|wav|mp3)/i);
        const uuid = m ? m[1].toLowerCase() : '';
        reportTrack(uuid, src, '', 'audio_play');
      }
      return origPlay.apply(this, args);
    };
  } catch (e) {
    console.warn('[HosiFlow In-Page Engine] Play hook error:', e);
  }

  // 2. Hook HTMLMediaElement.prototype.src setter
  try {
    const origSrcSet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')?.set;
    if (origSrcSet) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        set(val) {
          if (val && typeof val === 'string') {
            const m = val.match(/clips\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(m4a|wav|mp3)/i);
            const uuid = m ? m[1].toLowerCase() : '';
            reportTrack(uuid, val, '', 'audio_src_setter');
          }
          return origSrcSet.call(this, val);
        }
      });
    }
  } catch (e) {
    console.warn('[HosiFlow In-Page Engine] Src setter hook error:', e);
  }

  // 3. Hook TextDecoder.prototype.decode (Bắt mọi chunk streaming text từ AI Producer realtime)
  try {
    const origDecode = TextDecoder.prototype.decode;
    TextDecoder.prototype.decode = function(...args) {
      const text = origDecode.apply(this, args);
      if (text && typeof text === 'string') {
        // Quét clips/{uuid}.m4a
        const clipMatches = text.matchAll(/clips\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(m4a|wav|mp3)/gi);
        for (const cm of clipMatches) {
          const uuid = cm[1].toLowerCase();
          const ext = cm[2].toLowerCase();
          reportTrack(uuid, `https://storage.googleapis.com/producer-app-public/clips/${uuid}.${ext}`, '', 'text_decoder_clip');
        }

        // Quét /song/{uuid}
        const songMatches = text.matchAll(/\/song\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/gi);
        for (const sm of songMatches) {
          const uuid = sm[1].toLowerCase();
          reportTrack(uuid, `https://storage.googleapis.com/producer-app-public/clips/${uuid}.m4a`, '', 'text_decoder_song');
        }
      }
      return text;
    };
  } catch (e) {
    console.warn('[HosiFlow In-Page Engine] TextDecoder hook error:', e);
  }

  // 4. Hook window.fetch (Quét responses JSON hoặc streaming)
  try {
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const resp = await origFetch.apply(this, args);
      try {
        const clone = resp.clone();
        clone.text().then((text) => {
          if (!text) return;

          // Thử parse JSON
          try {
            const data = JSON.parse(text);
            const visited = new Set();
            function walk(obj) {
              if (!obj || typeof obj !== 'object' || visited.has(obj)) return;
              visited.add(obj);
              if (Array.isArray(obj)) {
                for (const item of obj) walk(item);
                return;
              }
              const audioUrl = obj.audio_url || obj.audioUrl || obj.wav_url || obj.wavUrl || obj.url;
              const title = obj.title || obj.name || '';
              if (audioUrl && typeof audioUrl === 'string' && audioUrl.includes('clips/')) {
                const m = audioUrl.match(/clips\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(m4a|wav|mp3)/i);
                const uuid = m ? m[1].toLowerCase() : (isValidUuid(obj.id) ? obj.id.toLowerCase() : '');
                reportTrack(uuid, audioUrl, title, 'fetch_json');
              }
              for (const [k, v] of Object.entries(obj)) {
                if (typeof v === 'string' && v.includes('clips/')) {
                  const m = v.match(/clips\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(m4a|wav|mp3)/i);
                  if (m) {
                    reportTrack(m[1].toLowerCase(), v, title, 'fetch_json_prop');
                  }
                } else if (typeof v === 'object') {
                  walk(v);
                }
              }
            }
            walk(data);
          } catch {}

          // Quét regex trực tiếp trên toàn bộ text
          const clipMatches = text.matchAll(/clips\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(m4a|wav|mp3)/gi);
          for (const cm of clipMatches) {
            reportTrack(cm[1].toLowerCase(), `https://storage.googleapis.com/producer-app-public/clips/${cm[1].toLowerCase()}.${cm[2].toLowerCase()}`, '', 'fetch_text_clip');
          }

          const songMatches = text.matchAll(/\/song\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/gi);
          for (const sm of songMatches) {
            reportTrack(sm[1].toLowerCase(), `https://storage.googleapis.com/producer-app-public/clips/${sm[1].toLowerCase()}.m4a`, '', 'fetch_text_song');
          }
        }).catch(() => {});
      } catch {}
      return resp;
    };
  } catch (e) {
    console.warn('[HosiFlow In-Page Engine] Fetch hook error:', e);
  }
})();
