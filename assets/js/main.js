/* Site interactions: scroll reveal, section highlighting in the nav,
   figure lightbox, in-view video playback and click-to-load talk embeds.
   Everything here is progressive enhancement: the page works without it. */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasIO = 'IntersectionObserver' in window;

  /* ---------- 1. Reveal on scroll ----------
     Only items that start below the fold are hidden, so nothing visible on
     first paint ever flashes or disappears. */
  if (hasIO && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        el.classList.remove('reveal-pending');
        el.addEventListener('transitionend', () => { el.style.transitionDelay = ''; }, { once: true });
        io.unobserve(el);
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });

    const fold = window.innerHeight * 0.95;
    document.querySelectorAll('[data-reveal]').forEach((el) => {
      if (el.getBoundingClientRect().top < fold) return;
      const siblings = [...el.parentElement.children].filter((c) => c.hasAttribute('data-reveal'));
      const order = Math.min(siblings.indexOf(el), 4);
      if (order > 0 && !el.classList.contains('section-head')) {
        el.style.transitionDelay = `${order * 80}ms`;
      }
      el.classList.add('reveal-pending');
      io.observe(el);
    });
  }

  /* ---------- 2. Highlight the current section in the nav ---------- */
  const navList = document.querySelector('.site-nav ul');
  const navLinks = [...document.querySelectorAll('.site-nav ul a[href^="#"]')];
  if (hasIO && navLinks.length) {
    const byId = new Map(navLinks.map((a) => [a.getAttribute('href').slice(1), a]));
    const setCurrent = (id) => {
      navLinks.forEach((a) => a.removeAttribute('aria-current'));
      const link = byId.get(id);
      if (!link) return;
      link.setAttribute('aria-current', 'true');
      const left = link.offsetLeft - navList.clientWidth / 2 + link.clientWidth / 2;
      navList.scrollTo({ left, behavior: reduceMotion ? 'auto' : 'smooth' });
    };
    const spy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setCurrent(entry.target.id);
      }
    }, { rootMargin: '-40% 0px -55% 0px' });
    byId.forEach((_, id) => {
      const target = document.getElementById(id);
      if (target) spy.observe(target);
    });
    // Clear the highlight when back in the hero.
    const hero = document.querySelector('.hero');
    if (hero) {
      new IntersectionObserver(([e]) => {
        if (e.isIntersecting && e.intersectionRatio > 0.5) setCurrent(null);
      }, { threshold: [0.5] }).observe(hero);
    }
  }

  /* ---------- 3. Figure lightbox (native <dialog>) ----------
     Figure links point at the large image, so without JS they simply open it. */
  const dialog = document.getElementById('lightbox');
  if (dialog && typeof dialog.showModal === 'function') {
    const caption = dialog.querySelector('.lightbox__caption');
    const original = dialog.querySelector('.lightbox__original');
    let img = null;

    const captionFor = (trigger) => {
      const figcaption = trigger.closest('figure')?.querySelector('figcaption');
      if (figcaption) return [...figcaption.cloneNode(true).childNodes];
      const card = trigger.closest('article');
      if (!card) return [];
      const nodes = [];
      const title = card.querySelector('.card__title');
      const detail = card.querySelector('.card__meta, .card__text');
      if (title) {
        const strong = document.createElement('strong');
        strong.textContent = title.textContent.trim();
        nodes.push(strong);
      }
      if (detail) {
        nodes.push(document.createTextNode(' '));
        nodes.push(...detail.cloneNode(true).childNodes);
      }
      return nodes;
    };

    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('a.plate[href], a.tile__media[href]');
      if (!trigger || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();

      const thumb = trigger.querySelector('img');
      img = document.createElement('img');
      img.className = 'lightbox__img';
      img.src = trigger.href;
      img.alt = thumb ? thumb.alt : '';
      img.decoding = 'async';
      dialog.insertBefore(img, caption);

      caption.replaceChildren(...captionFor(trigger));
      const originalHref = trigger.dataset.original;
      original.hidden = !originalHref;
      if (originalHref) original.href = originalHref;

      dialog.showModal();
    });

    // Click on the dimmed area (outside image/caption) closes.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      img?.remove();
      img = null;
    });
  }

  /* ---------- 4. Animations: play muted loops only while on screen ---------- */
  const videos = document.querySelectorAll('video[data-inview-autoplay]');
  if (videos.length && hasIO && !reduceMotion) {
    const vio = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting) {
          if (target.preload === 'none') target.preload = 'auto';
          target.play().catch(() => {});
        } else {
          target.pause();
        }
      }
    }, { threshold: 0.5 });
    videos.forEach((v) => vio.observe(v));
  }

  /* ---------- 5. Talk recording: click-to-load YouTube (privacy-enhanced) ---------- */
  document.querySelectorAll('.video-embed[data-youtube-id]').forEach((wrap) => {
    const id = wrap.dataset.youtubeId.trim();
    if (!/^[\w-]{6,20}$/.test(id)) return;
    const title = wrap.dataset.title || 'Video';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'video-embed__button';
    button.setAttribute('aria-label', `Play: ${title}`);
    const poster = document.createElement('img');
    poster.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    poster.alt = '';
    poster.loading = 'lazy';
    const badge = document.createElement('span');
    badge.className = 'play-badge';
    badge.setAttribute('aria-hidden', 'true');
    button.append(poster, badge);

    button.addEventListener('click', () => {
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      iframe.title = title;
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      wrap.replaceChildren(iframe);
      iframe.focus();
    }, { once: true });

    wrap.replaceChildren(button);
    wrap.closest('article')?.querySelectorAll('.chip--soon').forEach((c) => c.remove());
  });
})();
