(function () {
  'use strict';
  const fr = document.documentElement.lang === 'fr';
  const names = ['resources','journal','goals','reminders','support','guides','data','about'];
  const links = Array.from(document.querySelectorAll('[data-section]'));
  const sections = names.map(name => document.getElementById('p-'+name)).filter(Boolean);
  const normal = s => s.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  document.documentElement.classList.add('js');
  const menu = document.getElementById('moreMenu');
  const backdrop = document.getElementById('moreBackdrop');
  const menuButtons = [document.getElementById('moreToggle'),document.getElementById('desktopMoreToggle')];
  const background = [document.querySelector('header'),document.querySelector('nav.tabs'),document.getElementById('main'),document.querySelector('footer'),document.querySelector('.mobile-nav')];
  let menuOpener = null;
  menu.hidden = true;
  function closeMenu(restoreFocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    backdrop.hidden = true;
    menu.removeAttribute('role');
    menu.removeAttribute('aria-modal');
    menuButtons.forEach(button => button.setAttribute('aria-expanded','false'));
    background.forEach(node => { if(node) node.inert = false; });
    document.body.classList.remove('menu-open');
    if (restoreFocus && menuOpener) menuOpener.focus({preventScroll:true});
  }
  function openMenu(opener) {
    menuOpener = opener;
    menu.hidden = false;
    backdrop.hidden = false;
    menu.setAttribute('role','dialog');
    menu.setAttribute('aria-modal','true');
    menuButtons.forEach(button => button.setAttribute('aria-expanded','true'));
    background.forEach(node => { if(node) node.inert = true; });
    document.body.classList.add('menu-open');
    document.getElementById('closeMore').focus({preventScroll:true});
  }
  menuButtons.forEach(button => button.addEventListener('click',() => menu.hidden ? openMenu(button) : closeMenu(true)));
  document.getElementById('closeMore').addEventListener('click',() => closeMenu(true));
  backdrop.addEventListener('click',() => closeMenu(true));
  document.addEventListener('keydown',event => {
    if (menu.hidden) return;
    if(event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
    if(event.key !== 'Tab') return;
    const controls = Array.from(menu.querySelectorAll('a[href],button:not([disabled])')).filter(node=>!node.hidden);
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus(); }
    else if(!event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus(); }
  });
  function route(focus) {
    closeMenu(false);
    const name = names.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'resources';
    sections.forEach(section => { section.hidden = section.id !== 'p-'+name; });
    links.forEach(link => {
      const selected = link.dataset.section === name;
      if (selected) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
    menuButtons.forEach(button => {
      if (['support','guides','data','about'].includes(name)) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    });
    if (focus) {
      const heading = document.querySelector('#p-'+name+' h2');
      if (heading) { heading.setAttribute('tabindex','-1'); heading.focus({preventScroll:true}); }
      window.scrollTo({top:0,behavior:'instant'});
    }
    document.getElementById('languageSwitch').href = (fr?'index.html':'fr.html')+'#'+name;
  }
  window.addEventListener('hashchange',() => route(true));
  document.addEventListener('click',event => {
    const anchor=event.target.closest('a[href^="#"]');
    if(!anchor || !names.includes(anchor.getAttribute('href').slice(1))) return;
    closeMenu(false);
    if(location.hash === anchor.getAttribute('href')) { event.preventDefault(); route(true); }
  });
  route(false);
  document.querySelectorAll('#quickExit,.menu-exit').forEach(link=>link.addEventListener('click',event => {
    event.preventDefault();
    document.documentElement.style.visibility='hidden';
    try { if (window.Personal) window.Personal.lock(); }
    finally { location.replace('https://www.google.ca/'); }
  }));
  // Leave the page even if JavaScript is partly unavailable; quick exit is no history eraser.
  document.getElementById('themeBtn').addEventListener('click',() => {
    const root=document.documentElement;
    const dark=root.dataset.theme ? root.dataset.theme==='dark' : matchMedia('(prefers-color-scheme:dark)').matches;
    root.dataset.theme=dark?'light':'dark';
  });
  const cards = Array.from(document.querySelectorAll('#resGrid > .res'));
  const region=document.getElementById('region'),search=document.getElementById('search');
  let category='all';
  const corpus = new Map(cards.map(c => [c,normal(c.querySelector('h3').textContent+' '+c.querySelector('p').textContent)]));
  function filter() {
    const query=normal(search.value.trim());
    let count=0;
    cards.forEach(card => {
      const show=(region.value==='ALL'||card.dataset.region==='CA'||card.dataset.region===region.value) && (category==='all'||card.dataset.category===category) && corpus.get(card).includes(query);
      card.hidden=!show;
      if (show) count++;
    });
    document.getElementById('resultCount').textContent=fr?`${count} ressources affichées`:`${count} resources shown`;
    const selected = document.querySelector('#chips [aria-pressed="true"]');
    document.getElementById('filterSummaryText').textContent=(fr?'Type d’aide : ':'Filter by need: ')+(selected?selected.textContent:(fr?'Tout':'All'));
    document.getElementById('noResults').hidden=count!==0;
  }
  document.querySelectorAll('#chips button').forEach(button => button.addEventListener('click',() => {
    category=button.dataset.category;
    document.querySelectorAll('#chips button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    filter();
  }));
  region.addEventListener('change',filter);
  search.addEventListener('input',filter);
  document.getElementById('resetFilters').addEventListener('click',()=>{
    category='all'; search.value=''; region.value='CA';
    document.querySelectorAll('#chips button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.category==='all')));
    filter();
  });
  filter();
  if (window.Personal) Promise.resolve(window.Personal.init({lang:fr?'fr':'en'})).catch(() => {
    const message=document.createElement('p'); message.className='note field-error';
    message.textContent=fr?'Les outils personnels n’ont pas démarré. Les ressources et le soutien restent accessibles.':'Personal tools could not start. Resources and support are still available.';
    document.getElementById('main').prepend(message);
  });
})();
