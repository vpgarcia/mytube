// Utilidades para trabajar con videos de YouTube sin clave de API.

const ID_RE = /^[\w-]{11}$/;

// Acepta un enlace de YouTube (watch, youtu.be, shorts, embed, live),
// un ID suelto o un texto compartido que contenga un enlace.
export function parseVideoId(input) {
  if (!input) return null;
  const text = input.trim();
  if (ID_RE.test(text)) return text;

  const match = text.match(/(https?:\/\/)?[\w.-]*(youtube\.com|youtu\.be|youtube-nocookie\.com)\/\S*/i);
  if (!match) return null;
  let url;
  try {
    url = new URL(match[0].startsWith('http') ? match[0] : 'https://' + match[0]);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v');
    if (!id) {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      if (m) id = m[1];
    }
  }
  return id && ID_RE.test(id) ? id : null;
}

function findYoutubeUrl(text) {
  const match = text.match(/(https?:\/\/)?[\w.-]*(youtube\.com|youtu\.be|youtube-nocookie\.com)\/\S*/i);
  if (!match) return null;
  try {
    const url = new URL(match[0].startsWith('http') ? match[0] : 'https://' + match[0]);
    return { url, host: url.hostname.replace(/^(www\.|m\.|music\.)/, '') };
  } catch {
    return null;
  }
}

// Interpreta lo que pega el padre:
//   { type: 'video', id }
//   { type: 'playlist', list, videoId? }   lista (o video dentro de una lista)
//   { type: 'handle' }                     canal con @nombre (no se puede leer sin API)
//   null                                   no es de YouTube
export function parseInput(input) {
  if (!input) return null;
  const text = input.trim();
  const found = findYoutubeUrl(text);
  if (found && (found.host === 'youtube.com' || found.host === 'youtube-nocookie.com')) {
    const { url } = found;
    const list = url.searchParams.get('list');
    if (list && /^[\w-]{10,}$/.test(list)) return { type: 'playlist', list, videoId: parseVideoId(text) };
    const channel = url.pathname.match(/^\/channel\/(UC[\w-]{22})/);
    // La lista de "subidas" de un canal UCxxxx es UUxxxx.
    if (channel) return { type: 'playlist', list: 'UU' + channel[1].slice(2) };
    if (/^\/(@|c\/|user\/)/.test(url.pathname)) return { type: 'handle' };
  }
  const id = parseVideoId(text);
  return id ? { type: 'video', id } : null;
}

export function thumbnailUrl(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

// Obtiene título y canal mediante oEmbed. Si YouTube responde 401/403 el
// video no permite reproducirse fuera de YouTube.
export async function fetchVideoInfo(id) {
  const watchUrl = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
  const endpoints = [
    `https://www.youtube.com/oembed?format=json&url=${watchUrl}`,
    `https://noembed.com/embed?url=${watchUrl}`,
  ];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint);
      if (res.status === 401 || res.status === 403) return { embeddable: false };
      if (res.status === 404 || res.status === 400) return { exists: false };
      if (!res.ok) continue;
      const data = await res.json();
      if (data.error) continue;
      return { title: data.title, channel: data.author_name, embeddable: true };
    } catch {
      // Sin CORS o sin red: probamos el siguiente.
    }
  }
  return {};
}

// Ejecuta `fn` sobre cada elemento con como mucho `limit` en paralelo.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Lee los IDs de una lista de reproducción usando un reproductor oculto:
// la IFrame API los expone con getPlaylist(), sin necesidad de clave de API.
export async function fetchPlaylistIds(listId) {
  const YT = await loadPlayerApi();
  return new Promise((resolve, reject) => {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;';
    const target = document.createElement('div');
    holder.append(target);
    document.body.append(holder);

    let player = null;
    let poll = null;
    let done = false;
    const finish = (ids, err) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      clearInterval(poll);
      try {
        player?.destroy();
      } catch {
        // ignorar
      }
      holder.remove();
      if (err) reject(err);
      else resolve(ids);
    };
    const timeout = setTimeout(() => finish(null, new Error('timeout')), 20000);

    player = new YT.Player(target, {
      host: 'https://www.youtube-nocookie.com',
      playerVars: { listType: 'playlist', list: listId, autoplay: 0, origin: location.origin },
      events: {
        onReady: () => {
          poll = setInterval(() => {
            const ids = player.getPlaylist?.();
            if (ids && ids.length) finish(ids.filter((id) => ID_RE.test(id)));
          }, 300);
        },
        onError: () => finish(null, new Error('playlist')),
      },
    });
  });
}

let apiPromise = null;

export function loadPlayerApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => {
        apiPromise = null;
        reject(new Error('No se pudo cargar el reproductor de YouTube'));
      };
      document.head.appendChild(script);
    });
  }
  return apiPromise;
}
