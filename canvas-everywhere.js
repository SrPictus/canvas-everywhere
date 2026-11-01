// Canvas Everywhere: lleva el Canvas de la canción que suena al inicio y a su álbum o playlist, con su nombre.
// Funciona con cualquier tema y usa su tipografía; con Vitral además ocupa el lugar de su foto.
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
    /* En la mitad derecha, fundiéndose con la página hacia abajo y hacia el título */
    .ce-stage {
      position: absolute;
      top: 0;
      right: 0;
      width: 56%;
      height: 100%;
      opacity: 0;
      pointer-events: none;
      z-index: -1;
      transition: opacity 0.8s ease;
    }
    .ce-stage.is-on { opacity: 1; }
    .ce-video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center 14%;
      -webkit-mask-image: linear-gradient(180deg, #000 55%, transparent), linear-gradient(90deg, transparent, #000 45%);
      -webkit-mask-composite: source-in;
      mask-composite: intersect;
    }

    /* Sobre un video de cualquier color: siempre claro y con sombra. La letra es la de títulos del tema */
    .ce-caption {
      position: absolute;
      right: clamp(16px, 3%, 44px);
      bottom: 26%;
      max-width: 60%;
      color: #fff;
      text-align: right;
      text-shadow: 0 2px 14px rgba(0, 0, 0, 0.85);
    }
    .ce-eq {
      display: inline-flex;
      align-items: flex-end;
      gap: 3px;
      height: 11px;
      margin-bottom: 4px;
    }
    .ce-eq i {
      width: 3px;
      height: 100%;
      border-radius: 2px;
      background: currentColor;
      transform-origin: bottom;
      animation: ce-eq 1s steps(8) infinite alternate;
    }
    .ce-eq i:nth-child(2) { animation-delay: -0.35s; }
    .ce-eq i:nth-child(3) { animation-delay: -0.7s; }
    .ce-eq i:nth-child(4) { animation-delay: -0.15s; }
    @keyframes ce-eq {
      from { transform: scaleY(0.25); }
      to { transform: scaleY(1); }
    }
    .ce-title {
      display: -webkit-box;
      overflow: hidden;
      font-family: var(--encore-title-font-stack, inherit);
      font-size: clamp(14px, 1.15vw, 19px);
      line-height: 1.2;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
    }
    .ce-artist {
      display: block;
      margin-top: 2px;
      overflow: hidden;
      font-size: clamp(11px, 0.8vw, 13px);
      font-weight: 600;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    /* Cabecera de álbumes y playlists con cualquier tema */
    .ce-host {
      position: relative;
      isolation: isolate;
    }
    .ce-host > .ce-stage { width: 70%; }
    .ce-host .ce-caption { bottom: 12%; }

    /* Inicio con cualquier tema: una franja arriba, que solo existe mientras hay Canvas */
    .ce-banner {
      position: relative;
      isolation: isolate;
      height: clamp(200px, 32vh, 320px);
      margin-bottom: 16px;
      overflow: hidden;
      border-radius: 12px;
    }
    .ce-banner > .ce-stage { width: 100%; }
    .ce-banner .ce-video {
      -webkit-mask-image: linear-gradient(180deg, #000 60%, transparent), linear-gradient(90deg, transparent 10%, #000 60%);
    }
    .ce-banner .ce-caption { bottom: 14%; }

    /* Vitral: ocupa el sitio de su foto, que se aparta mientras suena el video */
    .vt-home-hero > .ce-stage { height: 470px; }
    .vt-home-hero .ce-title,
    .vt-hero .ce-title { text-transform: uppercase; }
    .vt-home-cover,
    .vt-hero-img,
    .vt-hero-ghost { transition: opacity 0.8s ease; }
    .vt-home-hero:has(> .ce-stage.is-on) > .vt-home-cover,
    .vt-hero:has(> .ce-stage.is-on) > .vt-hero-img,
    .vt-hero:has(> .ce-stage.is-on) > .vt-hero-ghost { opacity: 0 !important; }
    .vt-hero > .ce-stage { z-index: 0; }
  `;
  document.head.append(style);

  function createStage() {
    const stage = document.createElement("div");
    stage.className = "ce-stage";
    stage.setAttribute("aria-hidden", "true");
    const video = document.createElement("video");
    video.className = "ce-video";
    video.muted = video.playsInline = true;
    video.addEventListener("playing", () => stage.classList.add("is-on"));
    const caption = document.createElement("div");
    caption.className = "ce-caption";
    const eq = document.createElement("div");
    eq.className = "ce-eq";
    for (let i = 0; i < 4; i++) eq.append(document.createElement("i"));
    const title = document.createElement("div");
    title.className = "ce-title";
    const artist = document.createElement("span");
    artist.className = "ce-artist";
    caption.append(eq, title, artist);
    stage.append(video, caption);
    return { stage, video, title, artist };
  }

  const home = createStage();
  const page = createStage();
  const banner = document.createElement("div");
  banner.className = "ce-banner";
  const streams = new WeakMap();
  let liveTrack = null;
  let liveStream = null;
  let liveUri = null;

  // El Canvas es vertical: así no se confunde con un videoclip en el panel
  function findCanvasStream() {
    const uri = Spicetify.Player.data?.item?.uri;
    if (uri !== liveUri) {
      liveUri = uri;
      liveTrack = liveStream = null;
    }
    for (const source of document.querySelectorAll("video:not(.ce-video)")) {
      if (source.paused || source.readyState < 2 || source.videoHeight <= source.videoWidth) continue;
      if (!streams.has(source)) streams.set(source, source.captureStream());
      // Cada video nuevo añade una pista a la captura y la anterior deja de dar imagen
      const track = streams.get(source).getVideoTracks().at(-1);
      if (!track) return null;
      if (track !== liveTrack) {
        liveTrack = track;
        liveStream = new MediaStream([track]);
      }
      return liveStream;
    }
    // Spotify puede quitar su video un momento: en la misma canción se mantiene el que había
    return liveTrack?.readyState === "live" ? liveStream : null;
  }

  function setCaption(view) {
    const item = Spicetify.Player.data?.item;
    const name = item?.name ?? "";
    const artists = item?.artists?.map((artist) => artist.name).join(", ") || item?.metadata?.artist_name || "";
    if (view.title.textContent !== name) view.title.textContent = name;
    if (view.artist.textContent !== artists) view.artist.textContent = artists;
  }

  // Sin lugar donde verse, o con la ventana minimizada, se suelta el video y no gasta tarjeta gráfica
  function show(view, host, stream) {
    const { stage, video } = view;
    if (!host || !stream || document.hidden) {
      stage.classList.remove("is-on");
      video.srcObject = null;
      stage.remove();
      return;
    }
    if (stage.parentElement !== host) host.append(stage);
    setCaption(view);
    if (video.srcObject !== stream) {
      stage.classList.remove("is-on");
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

  function homeHost(path, stream) {
    const onHome = HOME_ROUTE.test(path);
    const vitral = onHome ? document.querySelector(".vt-home-hero") : null;
    const homePage = onHome && !vitral && stream && !document.hidden ? document.querySelector('#main-view [data-testid="home-page"]') : null;
    if (!homePage) {
      banner.remove();
      return vitral;
    }
    if (homePage.firstElementChild !== banner) homePage.prepend(banner);
    return banner;
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
    show(home, homeHost(path, stream), stream);
    show(page, pageHost(path), stream);
  }

  Spicetify.Platform.History.listen(sync);
  Spicetify.Player.addEventListener("songchange", sync);
  document.addEventListener("visibilitychange", sync);
  setInterval(sync, SYNC_MS);
  sync();
})();
