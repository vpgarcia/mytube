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
      if (res.status === 404) return { exists: false };
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
