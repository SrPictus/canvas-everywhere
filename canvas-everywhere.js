// Canvas Everywhere: lleva el Canvas de la canción que suena al inicio y a su álbum o playlist.
// Con Vitral entra en el óvalo de la foto; con otros temas va detrás de la cabecera.
// Spotify solo sabe reproducir sus Canvas por su propio reproductor, así que se comparte ese video
(function canvasEverywhere() {
  if (!Spicetify?.Platform?.History || !Spicetify.Player?.data) {
    setTimeout(canvasEverywhere, 300);
    return;
  }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const HOME_ROUTE = /^\/(intl-[a-z-]+\/?)?$/i;
  const PAGE_ROUTE = /\/(album|playlist)\/([^/?]+)/;
  const SYNC_MS = 1000;

  const style = document.createElement("style");
  style.textContent = `
    .ce-video {
      position: absolute;
      object-fit: cover;
      opacity: 0;
      pointer-events: none;
      z-index: -1;
      transition: opacity 0.8s ease;
    }
    /* A todo lo ancho, desvaneciéndose hacia la página, como las fotos grandes de artista */
    .vt-home-hero > .ce-video,
    .vt-hero > .ce-video {
      top: 0;
      left: 0;
      width: 100%;
      object-position: center 12%;
      /* También hacia el título, para que siga leyéndose */
      -webkit-mask-image: linear-gradient(180deg, #000 45%, transparent 100%), linear-gradient(90deg, rgba(0, 0, 0, 0.12) 15%, #000 65%);
      -webkit-mask-composite: source-in;
      mask-composite: intersect;
    }
    .vt-home-hero > .ce-video {
      top: -4px;
      height: 470px;
    }
    .vt-hero > .ce-video {
      height: 100%;
    }
    .vt-home-hero > .ce-video.is-on,
    .vt-hero > .ce-video.is-on { opacity: 0.8; }
    /* Mientras suena el video, la foto y el título gigante de fondo se apartan */
    .vt-home-cover,
    .vt-hero-img,
    .vt-hero-ghost { transition: opacity 0.8s ease; }
    .vt-home-hero:has(> .ce-video.is-on) > .vt-home-cover,
    .vt-hero:has(> .ce-video.is-on) > .vt-hero-img,
    .vt-hero:has(> .ce-video.is-on) > .vt-hero-ghost { opacity: 0 !important; }

    /* Otros temas: detrás de la cabecera, desvanecido hacia el título */
    .ce-host {
      position: relative;
      isolation: isolate;
    }
    .ce-host > .ce-video {
      inset: 0;
      width: 100%;
      height: 100%;
      -webkit-mask-image: linear-gradient(90deg, transparent 15%, #000 70%);
    }
    .ce-host > .ce-video.is-on { opacity: 0.55; }
  `;
  document.head.append(style);

  function createVideo() {
    const video = document.createElement("video");
    video.className = "ce-video";
    video.muted = video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.addEventListener("playing", () => video.classList.add("is-on"));
    return video;
  }

  const homeVideo = createVideo();
  const pageVideo = createVideo();
  const streams = new WeakMap();
  let liveTrack = null;
  let liveStream = null;

  // El Canvas es vertical: así no se confunde con un videoclip en el panel
  function findCanvasStream() {
    for (const source of document.querySelectorAll("video:not(.ce-video)")) {
      if (source.paused || source.readyState < 2 || source.videoHeight <= source.videoWidth) continue;
      if (!streams.has(source)) streams.set(source, source.captureStream());
      // Cada vídeo nuevo añade una pista a la captura y la anterior deja de dar imagen
      const track = streams.get(source).getVideoTracks().at(-1);
      if (!track) return null;
      if (track !== liveTrack) {
        liveTrack = track;
        liveStream = new MediaStream([track]);
      }
      return liveStream;
    }
    return null;
  }

  // Sin lugar donde verse, o con la ventana minimizada, se suelta el video y no gasta tarjeta gráfica
  function show(video, host, stream) {
    const visible = host && stream && !document.hidden;
    if (!visible) {
      video.classList.remove("is-on");
      video.srcObject = null;
      video.remove();
      return;
    }
    if (video.parentElement !== host) host.append(video);
    if (video.srcObject !== stream) {
      video.classList.remove("is-on");
      video.srcObject = stream;
    }
    if (video.paused) video.play().catch(() => {});
  }

  const idOf = (uri) => uri?.split(":").pop();

  // Álbumes y playlists no tienen Canvas propio: sirve el de la canción que suena si es de esa página
  function isPlayingFrom(pageId) {
    const data = Spicetify.Player.data;
    const trackId = idOf(data?.item?.uri);
    if (!trackId) return false;
    if (idOf(data.context?.uri) === pageId || idOf(data.item.album?.uri) === pageId) return true;
    return !!document.querySelector(`#main-view [data-testid="tracklist-row"] a[href*="/track/${trackId}"]`);
  }

  function pageHost(path) {
    const pageId = path.match(PAGE_ROUTE)?.[2];
    const header = document.querySelector('#main-view [data-testid="entity-header"], #main-view .main-entityHeader-container');
    const vitral = document.querySelector("#vitral-backdrop");
    header?.classList.toggle("ce-host", !!pageId && !vitral);
    if (!pageId || !isPlayingFrom(pageId)) return null;
    return vitral ? document.querySelector("#main-view .vt-hero:not(.vt-hero-wide)") : header;
  }

  function sync() {
    const path = Spicetify.Platform.History.location.pathname;
    const stream = findCanvasStream();
    show(homeVideo, HOME_ROUTE.test(path) ? document.querySelector(".vt-home-hero") : null, stream);
    show(pageVideo, pageHost(path), stream);
  }

  Spicetify.Platform.History.listen(sync);
  Spicetify.Player.addEventListener("songchange", sync);
  document.addEventListener("visibilitychange", sync);
  setInterval(sync, SYNC_MS);
  sync();
})();
